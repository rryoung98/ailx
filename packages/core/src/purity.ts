/**
 * Purity harness — spec §14.
 * Runs a score() function with fetch, Date.now and Math.random replaced by
 * throwing stubs. Used by CI golden-fixture tests to enforce that scoring
 * is deterministic and side-effect free.
 */
export function runPure<T>(fn: () => T): T {
  const g = globalThis as Record<string, unknown>;
  const savedFetch = g.fetch;
  const savedNow = Date.now;
  const savedRandom = Math.random;
  const boom = (name: string) => () => {
    throw new Error(`Purity violation: ${name} called inside score()`);
  };
  g.fetch = boom("fetch");
  Date.now = boom("Date.now") as typeof Date.now;
  Math.random = boom("Math.random") as typeof Math.random;
  try {
    return fn();
  } finally {
    g.fetch = savedFetch;
    Date.now = savedNow;
    Math.random = savedRandom;
  }
}
