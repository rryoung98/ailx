/**
 * Purity harness — spec §14.
 *
 * Runs a score() function with the clock, randomness, network and deferred
 * scheduling replaced by throwing stubs, and rejects a result that escapes
 * into async. Used by CI golden-fixture tests, and by the /validate page, to
 * enforce that scoring is deterministic and side-effect free.
 *
 * WHAT IT ACTUALLY CHECKS (and nothing more — see the blind spots below):
 *  - clock:        zero-arg `new Date()`, `Date()`, `Date.now()`, `performance.now()`
 *                  (`Date.parse`, `Date.UTC` and `new Date(ms)` stay live:
 *                  they convert a value the caller already had, and are exact)
 *  - randomness:   `Math.random`, `crypto.getRandomValues`, `crypto.randomUUID`
 *  - network:      `fetch`, `XMLHttpRequest`, `WebSocket`
 *  - scheduling:   `setTimeout`, `setInterval`, `setImmediate`, `queueMicrotask`
 *  - escaping async: a returned Promise/thenable is a purity violation, because
 *                  work that runs after runPure() returns runs OUTSIDE the traps
 *  - new globals:  a key added to globalThis during the call
 *
 * BLIND SPOTS — this is a trap set on globals, NOT a sandbox or a fresh realm.
 * It cannot see:
 *  - a reference CAPTURED BEFORE the call (`const now = Date.now` at module
 *    load, then `now()` inside score())
 *  - anything imported at module load: `node:fs`, `node:child_process`,
 *    `node:crypto`, a database client
 *  - environment reads (`process.env.X`), and reads of any other ambient state
 *  - MUTATION of existing globals or of the caller's input objects (inputs
 *    arrive through the closure, so the harness never sees them to freeze; the
 *    callers that care compare two runs of the same fixture instead)
 *  - non-determinism with no global entry point: `Intl` / locale-sensitive
 *    `toLocaleString`, unicode case folding whose tables move with the ICU
 *    version (see the T1 scorer), and LOCAL-TIMEZONE date construction
 *    (`new Date(2026, 0, 1)`, `getTimezoneOffset`) — the harness traps the
 *    CLOCK, not the machine's timezone
 * Every one of those blind spots has an executable test in
 * test/purity.test.ts asserting that the harness does NOT catch it, so this
 * list cannot quietly rot into a false claim.
 *
 * Restoration is unconditional (`finally`), so a throwing fn leaves the
 * globals exactly as it found them, and nesting runPure inside runPure works
 * because each level saves and restores its own predecessor's value.
 */

interface Saved {
  target: Record<PropertyKey, unknown>;
  key: PropertyKey;
  desc: PropertyDescriptor | undefined;
}

/**
 * A stub that throws whether it is CALLED or CONSTRUCTED — a plain function
 * expression, never an arrow, because `new (arrow)()` fails with "not a
 * constructor" and that error would not name the violation.
 */
function violation(name: string): () => never {
  return function violate(): never {
    throw new Error(`Purity violation: ${name} called inside score()`);
  };
}

/**
 * Replace `target[key]`, remembering how to put it back. Missing keys are
 * skipped (not every runtime has `setImmediate` or `WebSocket`), and a
 * non-configurable, non-writable property is reported rather than silently
 * left untrapped.
 */
function trap(
  saved: Saved[],
  target: unknown,
  key: PropertyKey,
  replacement: unknown,
): void {
  if (target === null || target === undefined) return;
  const obj = target as Record<PropertyKey, unknown>;
  if (!(key in obj)) return;
  const desc = Object.getOwnPropertyDescriptor(obj, key);
  try {
    Object.defineProperty(obj, key, {
      value: replacement,
      writable: true,
      enumerable: desc?.enumerable ?? true,
      configurable: true,
    });
  } catch {
    throw new Error(
      `Purity harness cannot trap ${String(key)} in this runtime (property is locked)`,
    );
  }
  saved.push({ target: obj, key, desc });
}

function restore(saved: Saved[]): void {
  // Reverse order, so a key trapped twice (nested runPure) unwinds correctly.
  for (let i = saved.length - 1; i >= 0; i--) {
    const { target, key, desc } = saved[i]!;
    if (desc) Object.defineProperty(target, key, desc);
    else delete target[key];
  }
}

function isThenable(v: unknown): boolean {
  return (
    (typeof v === "object" || typeof v === "function") &&
    v !== null &&
    typeof (v as { then?: unknown }).then === "function"
  );
}

export function runPure<T>(fn: () => T): T {
  const g = globalThis as unknown as Record<PropertyKey, unknown>;
  const saved: Saved[] = [];
  const RealDate = Date;

  let result: T;
  let seenKeys: PropertyKey[];
  try {
    // Clock. Date.now is trapped on the real constructor (so a captured
    // `Date` object is covered too); construction is trapped with a Proxy, so
    // `instanceof Date` and Date.prototype keep working for real dates that
    // were built before the call.
    trap(saved, RealDate, "now", violation("Date.now"));
    trap(
      saved,
      g,
      "Date",
      new Proxy(RealDate, {
        // ZERO-ARG construction reads the clock. `new Date(ms)` does not: it
        // is an exact conversion of a stored epoch value, and real scorers
        // legitimately use it to format a stored timestamp, so trapping it
        // would make the harness cry wolf.
        construct(target, args, newTarget) {
          if (args.length === 0) violation("new Date()")();
          return Reflect.construct(target, args, newTarget) as object;
        },
        // `Date(...)` as a plain call ignores its arguments and returns the
        // current time as a string, whatever you pass it.
        apply: violation("Date()"),
      }),
    );
    trap(saved, g.performance, "now", violation("performance.now"));

    // Randomness.
    trap(saved, Math, "random", violation("Math.random"));
    trap(saved, g.crypto, "getRandomValues", violation("crypto.getRandomValues"));
    trap(saved, g.crypto, "randomUUID", violation("crypto.randomUUID"));

    // Network.
    trap(saved, g, "fetch", violation("fetch"));
    trap(saved, g, "XMLHttpRequest", violation("XMLHttpRequest"));
    trap(saved, g, "WebSocket", violation("WebSocket"));

    // Deferred scheduling — work that would run after the traps come down.
    trap(saved, g, "setTimeout", violation("setTimeout"));
    trap(saved, g, "setInterval", violation("setInterval"));
    trap(saved, g, "setImmediate", violation("setImmediate"));
    trap(saved, g, "queueMicrotask", violation("queueMicrotask"));

    seenKeys = Reflect.ownKeys(g);
    result = fn();
    const added = Reflect.ownKeys(g).filter((k) => !seenKeys.includes(k));
    if (added.length > 0) {
      throw new Error(
        `Purity violation: score() created global(s) ${added.map(String).join(", ")}`,
      );
    }
  } finally {
    restore(saved);
  }

  if (isThenable(result)) {
    throw new Error(
      "Purity violation: score() returned a Promise — deferred work runs after the harness restores the globals, so it is unchecked",
    );
  }
  return result;
}
