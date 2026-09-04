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
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { BROWSER_REQUEST_HEADERS, DEV_USER_HEADER, isAllowedRequestHeader } from "@ailx/contract";
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

  it("REFUSES the all-zero id a collector drops, and does not rely on luck", () => {
    // Real randomness would pass this test with the check deleted, so the
    // randomness is the thing under control: a source that returns zeroes
    // must produce no header at all.
    vi.stubGlobal("crypto", { getRandomValues: (b: Uint8Array) => b.fill(0) });
    expect(newTraceparent()).toBeNull();
    expect(traceHeaders()).toEqual({});
    vi.unstubAllGlobals();
    // And the real source keeps producing usable ones.
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

/**
 * The CODE of a file, with comments removed. Without this the seam checks
 * below match prose — several modules explain `authHeaders()` in a comment
 * without calling it, and a doc comment is not a call site.
 */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function codeOf(file: string): string {
  return stripComments(readFileSync(file, "utf8"));
}

describe("no call site opts out", () => {
  /** Files allowed to name `authHeaders` at all: the definition, the
   * composition that wraps it, and the two modules that only register or
   * query the token SOURCE (`setAuthTokenSource`, `hasAuthTokenSource`). */
  const IDENTITY_OWNERS = [
    "lib/data/authHeaders.ts",
    "lib/data/traceparent.ts",
    "lib/auth/ClerkTokenBridge.tsx",
    "features/progress/ProgressView.tsx",
  ];

  it("no module outside the identity seam CALLS authHeaders()", () => {
    // Not `await authHeaders(` — a call without `await`, behind a promise
    // chain, or with different whitespace would slip through that.
    const offenders = sourceFiles(APP_ROOT)
      .filter((f) => !f.includes("/test/"))
      .filter((f) => !IDENTITY_OWNERS.some((owner) => f.endsWith(owner)))
      .filter((f) => /(?<![A-Za-z0-9_.])authHeaders\s*\(/.test(codeOf(f)))
      .map((f) => f.slice(APP_ROOT.length + 1));
    // `authHeaders()` answers "who"; a request also needs "which trace", and
    // the composition is `serviceHeaders()`. A call site that reaches past it
    // is a request nobody can follow into the service.
    expect(offenders).toEqual([]);
  });

  it("every module that builds a service URL sends a trace with it", () => {
    // The stronger half of the same claim, from the other direction: find the
    // modules that spell `apiBase()` into a request, and require each one to
    // reach the trace seam. `funnel.ts` is the ONE deliberate exception —
    // it posts with `credentials: "omit"` and no identity header, and a
    // one-span trace with nothing else in it buys nothing (docs/KPI.md).
    const TRACE_EXEMPT = ["lib/data/funnel.ts", "lib/mode.ts", "lib/server/page.ts"];
    const callers = sourceFiles(APP_ROOT)
      .filter((f) => !f.includes("/test/"))
      .filter((f) => !TRACE_EXEMPT.some((exempt) => f.endsWith(exempt)))
      .filter((f) => {
        const src = codeOf(f);
        // Built in pieces so this file does not itself contain the literal
        // a linter reads as an unintended template placeholder.
        const seam = ["$", "{apiBase()}"].join("");
        return src.includes(seam) && /\bfetch(Fn)?\s*\(/.test(src);
      });
    // A check that found nothing to check would pass forever. Five modules
    // spell `${apiBase()}` straight into a fetch today; the rest take a base
    // as a parameter and are covered by the `authHeaders` check above. If
    // this number collapses, the pattern stopped matching and the test is
    // lying, not the code.
    expect(callers.length).toBeGreaterThanOrEqual(5);
    const offenders = callers
      .filter((f) => !/serviceHeaders\s*\(|traceHeaders\s*\(/.test(codeOf(f)))
      .map((f) => f.slice(APP_ROOT.length + 1));
    expect(offenders).toEqual([]);
  });

  /**
   * WHY `/world` ESCAPED (TEN-107). The two checks above prove a request goes
   * THROUGH the seam; neither can see WHICH identity a call site asked the
   * seam for, because that was an optional boolean and its default was "send
   * none". `/world` simply never passed it, so a public page asked a route
   * that is entirely behind auth with no identity at all, and got a 401 that
   * the page then reported as a network outage.
   *
   * So the third check is on the DECISION, not the transport: every module
   * that reads the service names the identity it wants. "anonymous" is a fine
   * answer — an unsaid one is not.
   */
  it("every service read NAMES the identity it wants", () => {
    const readers = sourceFiles(APP_ROOT)
      .filter((f) => !f.includes("/test/"))
      .filter((f) => !f.endsWith("lib/data/serviceFetch.ts"))
      .filter((f) => /\b(useService|serviceFetch)\s*[<(]/.test(codeOf(f)));
    // Seven views and one panel read the service today. A collapse here means
    // the pattern stopped matching and the check is lying, not the code.
    expect(readers.length).toBeGreaterThanOrEqual(7);
    const offenders = readers
      .filter((f) => !/identity:\s*"(anonymous|optional|required)"/.test(codeOf(f)))
      .map((f) => f.slice(APP_ROOT.length + 1));
    expect(offenders).toEqual([]);
  });

  /**
   * And the two PUBLIC pages ask with `optional`: they forward the identity
   * the browser already has, so they work while every /v1 route is behind
   * auth, and they mint none, so they cannot pass by inventing a caller a
   * real first-time visitor will not have.
   */
  it("the public pages ask with an OPTIONAL identity, never a minted one", () => {
    for (const page of ["features/world/WorldView.tsx", "features/gallery/GalleryView.tsx"]) {
      expect([page, /identity:\s*"optional"/.test(readFileSync(join(APP_ROOT, page), "utf8"))]).toEqual([
        page,
        true,
      ]);
    }
  });

  it("ships no OpenTelemetry SDK — propagation is a header, not a library", () => {
    // Every workspace package the app can reach, not just its own manifest:
    // a dependency added to `@ailx/session` would ship in the bundle exactly
    // like one added here. This is a check on what WE declare — a package
    // that pulls an SDK in transitively is beyond a source-text test, and
    // `apps/web/test/bundleSecrecy.test.ts` greps the built output.
    const manifests = [join(APP_ROOT, "package.json")];
    const packagesRoot = join(APP_ROOT, "..", "..", "packages");
    for (const entry of readdirSync(packagesRoot)) {
      const manifest = join(packagesRoot, entry, "package.json");
      if (statSync(join(packagesRoot, entry)).isDirectory() && existsSync(manifest)) {
        manifests.push(manifest);
      }
    }
    const named = manifests.flatMap((file) => {
      const pkg = JSON.parse(readFileSync(file, "utf8")) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      return [
        ...Object.keys(pkg.dependencies ?? {}),
        ...Object.keys(pkg.devDependencies ?? {}),
      ]
        .filter((d) => d.startsWith("@opentelemetry/"))
        .map((d) => `${file}: ${d}`);
    });
    expect(named).toEqual([]);
    const imports = sourceFiles(APP_ROOT)
      .filter((f) => /from "@opentelemetry\/|require\("@opentelemetry\//.test(codeOf(f)))
      .map((f) => f.slice(APP_ROOT.length + 1));
    expect(imports).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The preflight
// ---------------------------------------------------------------------------

/**
 * OUR header names, as string literals in a file's CODE. Narrow on purpose:
 * `x-ailx-*` and `traceparent` are the names this app INVENTS and puts on a
 * preflighted request. A platform header it reads rather than sends
 * (`x-forwarded-proto`) or writes on a RESPONSE (`x-robots-tag`) crosses no
 * preflight and is none of this rule's business.
 */
function headerLiterals(text: string): string[] {
  return Array.from(text.matchAll(/["'`](x-ailx-[a-z0-9-]+|traceparent)["'`]/gi), (m) => m[1]!.toLowerCase());
}

describe("every header we send survives the preflight", () => {
  /**
   * The browser and the exam service sit on different origins, so EVERY call
   * this app makes is preflighted. A header the service does not list in
   * `Access-Control-Allow-Headers` is not dropped — the request is never
   * sent, and the app sees a bare "Failed to fetch".
   *
   * That is not hypothetical. Adding `traceparent` here on 2026-09-03 broke
   * every hosted call — no deck, no sync, no published T1 site — because the
   * service's allow-list was four strings typed out in the private repo. The
   * list is `BROWSER_REQUEST_HEADERS` now, and this is the assertion from the
   * sending side.
   */
  it("the trace and identity headers are both on the agreed list", async () => {
    const dev = await serviceHeaders(storage);
    for (const name of Object.keys(dev)) expect({ name, allowed: isAllowedRequestHeader(name) }).toEqual({ name, allowed: true });
    expect(Object.keys(dev)).toContain(TRACEPARENT_HEADER);

    setAuthTokenSource(async () => "jwt-abc");
    const clerk = await serviceHeaders(storage);
    for (const name of Object.keys(clerk)) expect({ name, allowed: isAllowedRequestHeader(name) }).toEqual({ name, allowed: true });
    expect(Object.keys(clerk)).toContain("authorization");
  });

  it("no module types a header name the service has not agreed to", () => {
    const offenders = sourceFiles(APP_ROOT)
      .filter((f) => !f.includes("/test/") && !f.includes("/e2e/"))
      .flatMap((f) =>
        headerLiterals(codeOf(f))
          .filter((name) => !isAllowedRequestHeader(name))
          .map((name) => `${f.slice(APP_ROOT.length + 1)}: ${name}`),
      );
    expect(offenders).toEqual([]);
  });

  it("that scan really reads a header name — it is not matching nothing forever", () => {
    // The check above passes today with zero literals to look at, because the
    // seam composes them. Prove the scanner still bites, or it would go on
    // passing after `fetch(url, { headers: { "x-ailx-whatever": … } })` came
    // back, and comments about a header are not a header.
    expect(headerLiterals('headers: { "x-ailx-new-idea": v }')).toEqual(["x-ailx-new-idea"]);
    expect(headerLiterals('headers: { "traceparent": v }')).toEqual(["traceparent"]);
    expect(headerLiterals(stripComments('// sends "x-ailx-new-idea" one day'))).toEqual([]);
    expect(headerLiterals('const s = "x-ailx-new-idea";').every(isAllowedRequestHeader)).toBe(false);
    expect(BROWSER_REQUEST_HEADERS.every(isAllowedRequestHeader)).toBe(true);
  });
});
