#!/usr/bin/env node
/**
 * Live link check for every provenance.source_url and provenance.references
 * URL in a T2 bank. Writes a committed manifest (link-check.json) beside the
 * bank so CI can verify freshness/coverage WITHOUT touching the network:
 *   node dist/cli/check-links.js <path/to/bank.jsonl> --write
 * The CI-safe test (link-manifest.test.ts) validates the committed manifest
 * against the committed bank (coverage + matching bank sha256 + all ok).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";

const args = process.argv.slice(2);
const write = args.includes("--write");
const bankPath = args.find((a) => !a.startsWith("--"));
if (!bankPath) {
  console.error("usage: check-links <bank.jsonl> [--write]");
  process.exit(1);
}

interface Prov {
  source_url?: string;
  references?: string[];
}

const raw = readFileSync(bankPath, "utf8");
const sha256 = createHash("sha256").update(raw).digest("hex");
const urls = new Map<string, string[]>(); // url -> item ids
for (const line of raw.split("\n")) {
  if (!line) continue;
  const item = JSON.parse(line) as { id: string; provenance?: Prov };
  const p = item.provenance ?? {};
  const found = [p.source_url, ...(p.references ?? [])].filter(
    (u): u is string => typeof u === "string",
  );
  for (const u of found) {
    const ids = urls.get(u) ?? [];
    ids.push(item.id);
    urls.set(u, ids);
  }
}

async function probe(url: string): Promise<number> {
  for (const method of ["HEAD", "GET"] as const) {
    try {
      const res = await fetch(url, {
        method,
        redirect: "follow",
        headers: { "User-Agent": "Mozilla/5.0 (ailx-link-check)" },
        signal: AbortSignal.timeout(45_000),
      });
      if (res.ok) return res.status;
      if (method === "GET") return res.status;
    } catch {
      if (method === "GET") return 0;
    }
  }
  return 0;
}

const results: Array<{ url: string; status: number; ok: boolean; item_ids: string[] }> = [];
for (const [url, ids] of [...urls.entries()].sort()) {
  const status = await probe(url);
  const ok = status >= 200 && status < 400;
  results.push({ url, status, ok, item_ids: ids.sort() });
  console.log(`${ok ? "ok " : "FAIL"} ${status} ${url}`);
  await new Promise((r) => setTimeout(r, 300));
}

const manifest = {
  bank_sha256: sha256,
  checked_at: new Date().toISOString().slice(0, 10),
  url_count: results.length,
  all_ok: results.every((r) => r.ok),
  results,
};
if (write) {
  const out = join(dirname(bankPath), "link-check.json");
  writeFileSync(out, JSON.stringify(manifest, null, 2) + "\n");
  console.log(`wrote ${out} (${results.length} urls, all_ok=${manifest.all_ok})`);
}
if (!manifest.all_ok) process.exit(2);
