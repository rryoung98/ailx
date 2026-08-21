import { describe, expect, it } from "vitest";
import { project } from "@ailx/session";
import { narratives, trackInsights } from "../lib/insights";
import { buildSampleAttemptLog } from "../lib/sampleAttempt";

describe("event-derived process insights", () => {
  const state = project(buildSampleAttemptLog());
  const insights = trackInsights(state);

  it("counts events and verbs per track", () => {
    const t3 = insights.find((i) => i.trackId === "t3")!;
    expect(t3.eventCount).toBe(6);
    expect(t3.verbCounts).toEqual({ prompted: 2, assisted: 1, challenged: 1, verified: 1, accepted: 1 });
    expect(t3.iterationRatio).toBe(0);
    expect(t3.verificationEvents).toBe(1);
  });

  it("excludes paused time from active seconds", () => {
    const t3 = insights.find((i) => i.trackId === "t3")!;
    expect(t3.activeSeconds).toBe(210);
    expect(t3.timeUsedFrac).toBeCloseTo(210 / 600, 6);
  });

  it("produces honest narratives from the process data", () => {
    const n = narratives(insights);
    expect(n.length).toBeGreaterThanOrEqual(2);
    expect(n[0].headline).toBe("You went back to the primary source");
  });
});
