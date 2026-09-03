/**
 * Two source-level rules for the T1 runner, both invisible at runtime.
 *
 * The first is TEN-64 defect 4: `updateKey` was captured by the PKCE effect
 * from the line BELOW it, and the exhaustive-deps lint rule was switched off
 * so nothing said so. The rule is now on for this file.
 *
 * The second is TEN-62, and it outlived the first: there is no `updateKey`
 * any more, no PKCE effect, and no key. The runner holds an ENDPOINT and the
 * host's fetch. This reads the source because "the browser never receives a
 * provider credential" is a claim about code that does not exist, and no
 * assertion about behaviour can catch the day somebody adds it back.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const RUNNER = fileURLToPath(new URL("../src/Runner.tsx", import.meta.url));
const src = readFileSync(RUNNER, "utf8");

describe("the T1 runner's hooks", () => {
  it("hides no dependency behind a lint disable", () => {
    expect(src).not.toContain("eslint-disable");
  });
});

describe("the T1 runner cannot put a provider credential in this browser", () => {
  it.each([
    ["the old key slot", "ailx:openrouter-key"],
    ["a key slot constant", "OPENROUTER_KEY_STORAGE"],
    ["the PKCE verifier slot", "PKCE_VERIFIER_STORAGE"],
    ["the browser-side code exchange", "exchangeCodeForKey"],
    ["the one-shot PKCE claim", "claimPkceCallback"],
    ["an Authorization header", "Authorization"],
    ["a bearer token", "Bearer "],
  ])("names %s nowhere", (_what, spelling) => {
    expect(src).not.toContain(spelling);
  });

  it("still reads the shared ENDPOINT slot, which is a URL and not a credential", () => {
    expect(src).toContain("LLM_BASE_URL_STORAGE");
  });
});
