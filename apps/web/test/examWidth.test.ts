/**
 * While a track is LIVE the runner needs the room of a full-width
 * workspace (~1400px), not the 820px reading column (T1/T4 are two-pane
 * environments). Source-pinned: the in-track branch of /exam.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("exam workspace width", () => {
  it("the in-track container widens to 1400px", () => {
    const src = readFileSync(join(__dirname, "..", "app", "exam", "page.tsx"), "utf8");
    expect(src).toContain('className="container" style={{ maxWidth: 1400 }}');
  });
});
