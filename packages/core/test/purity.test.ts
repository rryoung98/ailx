import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { runPure } from "../src/purity.js";

/**
 * The purity harness is a trap set on globals, not a sandbox. These tests come
 * in two halves, and BOTH halves are the specification:
 *  - "traps" pins every non-determinism source the harness claims to catch;
 *  - "documented blind spots" pins what it CANNOT catch, so the honest,
 *    narrow claim in src/purity.ts is executable rather than prose.
 */

const g = globalThis as unknown as Record<string, unknown>;

describe("runPure — a pure function", () => {
  it("runs and returns its value", () => {
    expect(runPure(() => 2 + 2)).toBe(4);
    expect(runPure(() => ({ a: [1, 2] }))).toEqual({ a: [1, 2] });
  });

  it("leaves pure clock statics usable (Date.parse / Date.UTC are pure)", () => {
    expect(runPure(() => Date.UTC(2026, 0, 1))).toBe(Date.UTC(2026, 0, 1));
    expect(runPure(() => Date.parse("2026-01-01T00:00:00.000Z"))).toBe(1767225600000);
  });

  it("leaves an ALREADY-CONSTRUCTED date working, including instanceof", () => {
    const d = new Date(0);
    expect(runPure(() => d instanceof Date)).toBe(true);
    expect(runPure(() => d.toISOString())).toBe("1970-01-01T00:00:00.000Z");
  });

  it("allows new Date(ms) — converting a STORED epoch value is exact, not a clock read", () => {
    expect(runPure(() => new Date(86_400_000).toISOString())).toBe("1970-01-02T00:00:00.000Z");
    expect(runPure(() => new Date(86_400_000) instanceof Date)).toBe(true);
  });
});

describe("runPure — traps", () => {
  const traps: ReadonlyArray<readonly [string, () => unknown]> = [
    ["Date.now", () => Date.now()],
    ["new Date()", () => new Date()], // zero-arg only: that is the clock read
    ["Date()", () => (Date as unknown as () => string)()],
    ["performance.now", () => performance.now()],
    ["Math.random", () => Math.random()],
    ["crypto.getRandomValues", () => crypto.getRandomValues(new Uint8Array(4))],
    ["crypto.randomUUID", () => crypto.randomUUID()],
    ["fetch", () => fetch("https://example.invalid")],
    ["setTimeout", () => setTimeout(() => {}, 0)],
    ["setInterval", () => setInterval(() => {}, 1000)],
    ["setImmediate", () => setImmediate(() => {})],
    ["queueMicrotask", () => queueMicrotask(() => {})],
  ];

  for (const [name, call] of traps) {
    it(`throws naming ${name}`, () => {
      expect(() => runPure(call)).toThrow(
        new RegExp(`^Purity violation: ${name.replace(/[.()]/g, "\\$&")} called inside score\\(\\)$`),
      );
    });
  }

  it("traps WebSocket where the runtime has one", () => {
    if (typeof g.WebSocket !== "function") return; // older node: nothing to trap
    expect(() => runPure(() => new (g.WebSocket as new (u: string) => unknown)("wss://x.invalid")))
      .toThrow(/Purity violation: WebSocket/);
  });

  it("traps XMLHttpRequest where the runtime has one", () => {
    const had = "XMLHttpRequest" in g;
    if (!had) g.XMLHttpRequest = function () {} as unknown;
    try {
      expect(() => runPure(() => new (g.XMLHttpRequest as new () => unknown)()))
        .toThrow(/Purity violation: XMLHttpRequest/);
    } finally {
      if (!had) delete g.XMLHttpRequest;
    }
  });

  it("rejects a Promise return — deferred work escapes the traps", () => {
    expect(() => runPure(() => Promise.resolve(1))).toThrow(/returned a Promise/);
    // biome-ignore lint/suspicious/noThenProperty: the thenable is the input under test.
    expect(() => runPure(() => ({ then: () => {} }))).toThrow(/returned a Promise/);
  });

  it("rejects a new global created by score()", () => {
    let err: unknown;
    try {
      runPure(() => {
        g.__ailxLeak = 1;
      });
    } catch (e) {
      err = e;
    } finally {
      delete g.__ailxLeak;
    }
    expect(String(err)).toMatch(/Purity violation: score\(\) created global\(s\) __ailxLeak/);
  });

  it("does not fire on a runtime that lacks a trapped global", () => {
    const saved = Object.getOwnPropertyDescriptor(g, "setImmediate");
    delete g.setImmediate;
    try {
      expect(runPure(() => 1)).toBe(1);
      expect("setImmediate" in g).toBe(false); // restore must not resurrect it
    } finally {
      if (saved) Object.defineProperty(g, "setImmediate", saved);
    }
  });
});

describe("runPure — restoration", () => {
  const live = () => {
    expect(typeof Math.random()).toBe("number");
    expect(typeof Date.now()).toBe("number");
    expect(new Date(0).getTime()).toBe(0);
    expect(typeof performance.now()).toBe("number");
    expect(typeof crypto.randomUUID()).toBe("string");
    expect(typeof g.fetch).toBe("function");
    expect(typeof setTimeout).toBe("function");
    expect(typeof queueMicrotask).toBe("function");
  };

  it("restores every global after a violation", () => {
    expect(() => runPure(() => Math.random())).toThrow();
    live();
  });

  it("restores every global after an unrelated throw from fn", () => {
    expect(() => runPure(() => { throw new Error("scorer bug"); })).toThrow("scorer bug");
    live();
  });

  it("restores every global after a clean run", () => {
    expect(runPure(() => "ok")).toBe("ok");
    live();
  });

  it("restores Date itself, not a proxy of it", () => {
    const real = Date;
    runPure(() => 1);
    expect(Date).toBe(real);
  });

  it("is re-entrant: nesting unwinds to the real globals", () => {
    expect(runPure(() => runPure(() => 7))).toBe(7);
    live();
    expect(() => runPure(() => runPure(() => Date.now()))).toThrow(/Date.now/);
    live();
  });
});

// ---------------------------------------------------------------------------
// The claim in src/purity.ts is narrow ON PURPOSE. These tests fail if anyone
// widens the prose without widening the harness — each one asserts the harness
// stays QUIET on a real non-determinism source it cannot see.
// ---------------------------------------------------------------------------

describe("runPure — documented blind spots (asserted, not merely claimed)", () => {
  it("cannot see a reference captured BEFORE the call", () => {
    const capturedNow = Date.now;
    const capturedRandom = Math.random;
    expect(typeof runPure(() => capturedNow())).toBe("number");
    expect(typeof runPure(() => capturedRandom())).toBe("number");
  });

  it("cannot see node I/O imported at module load", () => {
    const bytes = runPure(() => readFileSync(new URL("../package.json", import.meta.url)));
    expect(bytes.length).toBeGreaterThan(0);
  });

  it("cannot see environment reads", () => {
    process.env.AILX_PURITY_BLIND_SPOT = "1";
    try {
      expect(runPure(() => process.env.AILX_PURITY_BLIND_SPOT)).toBe("1");
    } finally {
      delete process.env.AILX_PURITY_BLIND_SPOT;
    }
  });

  it("cannot see mutation of the caller's input", () => {
    const input = { n: 1 };
    runPure(() => { input.n = 2; });
    expect(input.n).toBe(2);
  });

  it("cannot see mutation of an EXISTING global (only newly added keys)", () => {
    const saved = g.__ailxExisting;
    g.__ailxExisting = 1;
    try {
      runPure(() => { g.__ailxExisting = 2; });
      expect(g.__ailxExisting).toBe(2);
    } finally {
      if (saved === undefined) delete g.__ailxExisting;
      else g.__ailxExisting = saved;
    }
  });

  it("cannot see LOCAL-TIMEZONE date construction (it traps the clock, not the timezone)", () => {
    expect(runPure(() => new Date(2026, 0, 1).getTime())).toBe(new Date(2026, 0, 1).getTime());
    expect(runPure(() => new Date(0).getTimezoneOffset())).toBe(new Date(0).getTimezoneOffset());
  });

  it("cannot see locale- and ICU-version-sensitive text operations", () => {
    // Case folding tables move with the ICU version, so this is real
    // cross-version replay risk that the harness does NOT flag. See the T1
    // scorer's toLowerCase() on prompt text.
    expect(runPure(() => "İSTANBUL".toLowerCase())).toBe("İSTANBUL".toLowerCase());
    expect(runPure(() => (1234.5).toLocaleString("de-DE"))).toBe((1234.5).toLocaleString("de-DE"));
  });
});
