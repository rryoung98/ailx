/**
 * TEN-64 defect 4: `updateKey` was captured by the PKCE effect from the line
 * BELOW it, and the exhaustive-deps lint rule was switched off so nothing
 * said so. It worked only because effects run after render, which is the kind
 * of thing a refactor breaks silently.
 *
 * The rule is now on for this file. This test reads the source because the
 * defect is invisible at runtime today; there is no behaviour to assert.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const RUNNER = fileURLToPath(new URL("../src/Runner.tsx", import.meta.url));

describe("the T1 runner's hooks", () => {
  it("hides no dependency behind a lint disable", () => {
    expect(readFileSync(RUNNER, "utf8")).not.toContain("eslint-disable");
  });

  it("defines updateKey before the effect that depends on it", () => {
    const src = readFileSync(RUNNER, "utf8");
    expect(src.indexOf("const updateKey = useCallback(")).toBeGreaterThan(-1);
    expect(src.indexOf("const updateKey = useCallback(")).toBeLessThan(src.indexOf("claimPkceCallback()"));
  });
});
