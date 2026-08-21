/**
 * Paper-design regression: the track runners inherit the app's paper CSS
 * tokens. No runner may reintroduce the old dark-theme inline palette
 * (dark var overrides or the #4ade80/#f87171 dark-theme status colors) —
 * status colors must ride var(--good)/var(--bad).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const TRACKS = join(__dirname, "..", "..", "..", "packages", "tracks");
const FILES = [
  "t1-creative-build/src/Runner.tsx",
  "t2-discrimination/src/Runner.tsx",
  "t2-discrimination/src/SwipeDeck.tsx",
  "t3-reasoning/src/Runner.tsx",
  "t4-generative/src/Runner.tsx",
];

// Old dark-theme literals that must never come back in runner styling.
// (T1's STARTER_HTML is candidate content, not runner chrome — its dark
// page colors are allowed and excluded below.)
const BANNED = ["#4ade80", "#f87171", "#0b0d12", "#121622", "#232a3d", "#0a0c11", "#0a0f1e", "#8b93a7", "#e6e9f0"];

function runnerChrome(src: string): string {
  // Strip the T1 starter-document template literal (candidate content).
  return src.replace(/const STARTER_HTML = `[\s\S]*?`;/, "");
}

describe("runners read as paper", () => {
  for (const f of FILES) {
    it(`${f} contains no dark-theme inline hexes`, () => {
      const src = runnerChrome(readFileSync(join(TRACKS, f), "utf8"));
      for (const hex of BANNED) {
        expect(src.includes(hex), `${f} still contains ${hex}`).toBe(false);
      }
    });
  }
});
