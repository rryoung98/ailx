// @vitest-environment jsdom
/**
 * The trace seam: what the browser puts on the wire so that a request and the
 * server work it caused land in ONE trace, and what it must never put there.
 *
 * There is no OpenTelemetry SDK in this app and there must not be one — the
 * default build is a static export with no exam service to trace, and the web
 * SDK costs tens of kB before it sends a span (docs/ADR-otel.md). So the
 * property under test is narrow and checkable: a well-formed W3C
 * `traceparent`, on every service call, carrying nothing about the person.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { DEV_USER_HEADER } from "@ailx/contract";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setAuthTokenSource } from "../lib/data/authHeaders";
import {
  TRACEPARENT_HEADER,
  newTraceparent,
  serviceHeaders,
  traceHeaders,
} from "../lib/data/traceparent";

/** W3C Trace Context §3.2: version 00, 32 hex trace-id, 16 hex span-id, flags. */
const TRACEPARENT_RE = /^00-[0-9a-f]{32}-[0-9a-f]{16}-0[01]$/;

const storage = {
  map: new Map<string, string>(),
  getItem: (k: string) => storage.map.get(k) ?? null,
  setItem: (k: string, v: string) => void storage.map.set(k, v),
  removeItem: (k: string) => void storage.map.delete(k),
};

beforeEach(() => {
  storage.map.clear();
  setAuthTokenSource(null);
});
afterEach(() => {
  setAuthTokenSource(null);
  vi.unstubAllGlobals();
});

describe("the value on the wire", () => {
  it("is a well-formed W3C traceparent", () => {
    expect(newTraceparent()).toMatch(TRACEPARENT_RE);
  });

  it("is a NEW trace every call — the browser holds no parent span", () => {
    const ids = new Set(Array.from({ length: 64 }, () => newTraceparent()));
    expect(ids.size).toBe(64);
  });

  it("never mints the all-zero trace-id or span-id a collector would drop", () => {
    for (let i = 0; i < 64; i += 1) {
      const [, traceId, spanId] = newTraceparent()!.split("-");
      expect(traceId).not.toMatch(/^0+$/);
      expect(spanId).not.toMatch(/^0+$/);
    }
  });

  it("sends NO header rather than a fake id where there is no randomness", () => {
    vi.stubGlobal("crypto", {});
    expect(newTraceparent()).toBeNull();
    expect(traceHeaders()).toEqual({});
  });

  it("survives a browser with no crypto at all", () => {
    vi.stubGlobal("crypto", undefined);
    expect(traceHeaders()).toEqual({});
  });
});

describe("what travels with a service call", () => {
  it("carries the trace AND the identity, and nothing else", async () => {
    const h = await serviceHeaders(storage);
    expect(Object.keys(h).sort()).toEqual([DEV_USER_HEADER, TRACEPARENT_HEADER].sort());
    expect(h[TRACEPARENT_HEADER]).toMatch(TRACEPARENT_RE);
  });

  it("says nothing about WHO asked — the id is random hex, not a person", async () => {
    const h = await serviceHeaders(storage);
    const identity = h[DEV_USER_HEADER]!;
    expect(h[TRACEPARENT_HEADER]).not.toContain(identity);
    // Two calls by the SAME browser share an identity and share no trace id,
    // so a trace cannot become a second, quieter identifier.
    const second = await serviceHeaders(storage);
    expect(second[DEV_USER_HEADER]).toBe(identity);
    expect(second[TRACEPARENT_HEADER]).not.toBe(h[TRACEPARENT_HEADER]);
  });

  it("still sends the identity when there is no randomness to trace with", async () => {
    vi.stubGlobal("crypto", {});
    const h = await serviceHeaders(storage);
    expect(Object.keys(h)).toEqual([DEV_USER_HEADER]);
  });

  it("cannot overwrite the identity header", async () => {
    setAuthTokenSource(async () => "jwt-abc");
    const h = await serviceHeaders(storage);
    expect(h.authorization).toBe("Bearer jwt-abc");
    expect(h[TRACEPARENT_HEADER]).toMatch(TRACEPARENT_RE);
  });
});

// ---------------------------------------------------------------------------
// The seam, enforced rather than asserted
// ---------------------------------------------------------------------------

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next" || entry === "out") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

const APP_ROOT = join(__dirname, "..");

describe("no call site opts out", () => {
  it("every service call builds its headers with serviceHeaders(), not authHeaders()", () => {
    const offenders = sourceFiles(APP_ROOT)
      .filter((f) => !f.includes("/test/") && !f.endsWith("lib/data/authHeaders.ts"))
      .filter((f) => !f.endsWith("lib/data/traceparent.ts"))
      .filter((f) => readFileSync(f, "utf8").includes("await authHeaders("))
      .map((f) => f.slice(APP_ROOT.length + 1));
    // `authHeaders()` answers "who"; a request also needs "which trace", and
    // the composition is `serviceHeaders()`. A call site that reaches past it
    // is a request nobody can follow into the service.
    expect(offenders).toEqual([]);
  });

  it("ships no OpenTelemetry SDK — propagation is a header, not a library", () => {
    const pkg = JSON.parse(readFileSync(join(APP_ROOT, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const named = [
      ...Object.keys(pkg.dependencies ?? {}),
      ...Object.keys(pkg.devDependencies ?? {}),
    ].filter((d) => d.startsWith("@opentelemetry/"));
    expect(named).toEqual([]);
    const imports = sourceFiles(APP_ROOT)
      .filter((f) => /from "@opentelemetry\/|require\("@opentelemetry\//.test(readFileSync(f, "utf8")))
      .map((f) => f.slice(APP_ROOT.length + 1));
    expect(imports).toEqual([]);
  });
});
