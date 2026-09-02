/**
 * Cloud Run concurrency and the pg pool are ONE setting written in two places,
 * and until now nothing compared them.
 *
 * `AILX_PG_POOL_MAX` defaults to 3 (`DEFAULT_POOL_MAX`,
 * `services/api/src/context.ts` in the private repo) and `withApiContext`
 * checks out one pool client per request and holds it for the whole handler.
 * Cloud Run was told it may put 80 requests on that instance (`concurrency`,
 * `infra/terraform/variables.tf` default, which is also Cloud Run's own
 * default). So an instance serves 3 database requests at once, the 4th waits on
 * `connectionTimeoutMillis` and 500s after 10 seconds, and the autoscaler does
 * not ask for a second instance until average concurrency reaches 60% of 80.
 * The instance fails requests 4 to about 48 before help arrives.
 *
 * The two numbers live in different repositories, so neither repository could
 * see the gap. This file is the smallest thing that can. It reads the sizing
 * table in `docs/LOAD-TEST.md` section 8.3 — the one place both numbers are
 * written down together — and does the arithmetic that nobody did.
 *
 * SCOPE, said plainly: this checks a decision THIS repository wrote down. It
 * cannot read Terraform, which is in the private repo, so it cannot know what
 * is deployed. The other half of the check is a `variable "concurrency"`
 * validation block, quoted verbatim in section 8.4 so it is a copy rather than
 * a second derivation of the same rule.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const DOC = fileURLToPath(new URL("../../../docs/LOAD-TEST.md", import.meta.url));

/**
 * Neon's published `max_connections` by compute size
 * (neon.com/docs/connect/connection-pooling, read 2026-09-02). The pooler's
 * `default_pool_size` — how many clients may hold a transaction at once — is
 * 0.9 times this, per (user, database) pool.
 *
 * The compute size matters, and section 1 originally read 377 as a constant.
 * Neon's Free and Launch plans autoscale UP from a floor, so the floor is what
 * a cold database offers a spike: 93 slots at 0.25 CU, not 377.
 */
const NEON_MAX_CONNECTIONS: Readonly<Record<string, number>> = {
  "0.25": 104,
  "0.5": 209,
  "1": 419,
  "2": 839,
  "4": 1678,
};

/**
 * Estimated live buffers for ONE maximum-size T1 upload: a 25 MiB ZIP body,
 * buffered, copied into one contiguous array, then every entry inflated and
 * held at once (section 2.4). Arithmetic over the buffer sizes in the code, not
 * a reading from a running instance; the load test replaces it. It is here
 * because it is the biggest per-request memory number in the service, and a
 * Cloud Run OOM kills the instance and every request on it.
 */
const PEAK_T1_UPLOAD_MIB = 75;

/** Budget to 80% of the limit: the Node baseline has never been measured. */
const MEMORY_BUDGET = 0.8;

/** 1 vCPU is allowed 512 MiB to 4 GiB (Cloud Run memory limits). */
const MIN_MEMORY_MIB = 512;
const MAX_MEMORY_MIB = 4096;

const KEYS = ["AILX_PG_POOL_MAX", "concurrency", "max_instances", "memory", "neon_min_compute_cu"] as const;

/**
 * Section 8.3 ONLY. Not 8.4, which quotes the same numbers inside a Terraform
 * block, and not a future 8.6: a check that silently reads a second table is a
 * check that can be satisfied by the wrong one.
 */
function sizingTable(): Map<string, string> {
  const doc = readFileSync(DOC, "utf8");
  const start = doc.indexOf("\n### 8.3 ");
  if (start < 0) throw new Error("docs/LOAD-TEST.md has no section 8.3");
  const rest = doc.slice(start + 1);
  const end = rest.indexOf("\n### ");
  const section = end < 0 ? rest : rest.slice(0, end);

  const rows = new Map<string, string>();
  for (const line of section.split("\n")) {
    const match = /^\| `([A-Za-z_]+)` \| (\S+) \|/.exec(line);
    if (match === null) continue;
    const [, key, value] = match;
    if (rows.has(key)) throw new Error(`section 8.3 sets ${key} twice`);
    rows.set(key, value);
  }
  return rows;
}

function mebibytes(limit: string): number {
  const match = /^(\d+)(Mi|Gi)$/.exec(limit);
  if (match === null) throw new Error(`memory is not a Cloud Run limit: ${limit}`);
  return Number(match[1]) * (match[2] === "Gi" ? 1024 : 1);
}

describe("the sizing this repository has agreed (docs/LOAD-TEST.md section 8.3)", () => {
  const table = sizingTable();

  /** Counts of requests, clients and instances. Fractions are a typo, not a setting. */
  const count = (key: string): number => {
    const raw = table.get(key);
    if (raw === undefined) throw new Error(`section 8.3 does not set ${key}`);
    if (!/^[1-9][0-9]*$/.test(raw)) throw new Error(`${key} is not a positive integer: ${raw}`);
    return Number(raw);
  };

  it("writes all five numbers down, so none of them is a platform default nobody chose", () => {
    expect([...table.keys()].sort()).toEqual([...KEYS].sort());
  });

  it("does not hand an instance more requests than its pool can serve", () => {
    // Google's own rule: "set the Cloud Run concurrency to a value equal to or
    // less than" the code-level concurrency limit
    // (cloud.google.com/run/docs/tips/general, read 2026-09-02). Here the pool
    // IS that limit, because every route holds a client for the whole handler.
    //
    // No slack for the routes that never take a client (/livez, the startup
    // probe, a CORS preflight): Cloud Run cannot tell them apart, so slack
    // sized for them is slack a burst of database requests can use instead.
    expect(count("concurrency")).toBeLessThanOrEqual(count("AILX_PG_POOL_MAX"));
  });

  it("keeps the cluster's Postgres connections inside a COLD Neon compute", () => {
    const cu = table.get("neon_min_compute_cu");
    if (cu === undefined) throw new Error("section 8.3 does not record neon_min_compute_cu");
    const maxConnections = NEON_MAX_CONNECTIONS[cu];
    if (maxConnections === undefined) {
      throw new Error(`neon_min_compute_cu ${cu} is not a size Neon publishes a limit for`);
    }
    // Past `default_pool_size` the pooler QUEUES rather than refuses, then gives
    // up after two minutes with `query_wait_timeout`. That is a worse failure
    // than the ten-second one this file exists for, so it gets its own check.
    expect(count("AILX_PG_POOL_MAX") * count("max_instances")).toBeLessThanOrEqual(
      Math.floor(0.9 * maxConnections),
    );
  });

  it("has the memory to hold a full instance of the heaviest request", () => {
    // Cloud Run's guidance alongside the concurrency setting: "match memory to
    // concurrency" (cloud.google.com/run/docs/tips/general). The heaviest
    // request is the T1 upload, not anything on the sitting path.
    expect(count("concurrency") * PEAK_T1_UPLOAD_MIB).toBeLessThanOrEqual(
      MEMORY_BUDGET * mebibytes(table.get("memory") ?? ""),
    );
  });

  it("asks Cloud Run for a memory limit 1 vCPU is allowed to have", () => {
    const mib = mebibytes(table.get("memory") ?? "");
    expect(mib).toBeGreaterThanOrEqual(MIN_MEMORY_MIB);
    expect(mib).toBeLessThanOrEqual(MAX_MEMORY_MIB);
  });
});
