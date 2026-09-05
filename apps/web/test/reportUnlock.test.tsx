// @vitest-environment jsdom
/**
 * THE REPORT AFTER A FINALIZED HOSTED SITTING (TEN-128).
 *
 * Run 856b850c… finished on 2026-09-04 at 07:39:30Z: 48 responses, four
 * tracks sat, finalized, and the exam service issued T2 (30.83) and T3
 * (103.333). The report said "3 of 4 tracks scored. Finish the run to unlock
 * it." for ever, because the unlock gate counted the LOCAL event log and a
 * server-issued score never lands there. "Continue →" went back to /exam,
 * which said the run was complete and linked back to the locked report.
 *
 * The gate now reads the same answer the Scores of record panel reads, from
 * one request. It still does NOT copy a server score into the local log:
 * TEN-92 is that decision, and the log is what this browser can replay.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { append, saveAttempt, type SequencedEntry, type TrackId } from "@ailx/session";
import { buildSampleAttemptLog } from "../lib/instrument/sampleAttempt";
import { scoreTrack, trackScoredEntry } from "../lib/instrument/registry";
import { memoryStorage } from "./helpers/completedAttempt";
import { renderClient } from "./helpers/clientPage";

const ATTEMPT = "856b850c-51ac-4a1a-82a5-24deb8df66ae";

/** A hosted sitting: T1 and T4 scored here, T2 and T3 the service's. */
function hostedLog(): SequencedEntry[] {
  let log = buildSampleAttemptLog();
  let t = log[log.length - 1].ts;
  for (const c of log.filter(
    (e): e is Extract<SequencedEntry, { type: "track_completed" }> => e.type === "track_completed",
  )) {
    const trackId = c.trackId as TrackId;
    if (trackId === "t2" || trackId === "t3") continue;
    t += 1_000;
    log = append(log, trackScoredEntry(trackId, scoreTrack(trackId, c.artifact), t));
  }
  return append(log, { type: "attempt_completed", ts: t + 1_000 });
}

const scored = (trackId: string, scaled: number) => ({
  trackId,
  state: "scored",
  score: { raw: {}, scaled },
  rubricVersion: "rubric-2026.1-abcdef",
  scoringDigest: "0123456789abcdef",
  issuedBy: "finalize",
  computedAt: "2026-09-04T07:39:31.000Z",
});

function serviceAnswers(scores: unknown): void {
  vi.stubGlobal("fetch", async (url: unknown) =>
    new Response(
      JSON.stringify(
        String(url).includes("/attempts/")
          ? { attempt: { id: ATTEMPT }, scores }
          : {},
      ),
      { status: 200, headers: { "content-type": "application/json" } },
    ),
  );
}

async function reportHtml(): Promise<string> {
  const ReportPage = (await import("../app/report/page")).default;
  return renderClient(createElement(ReportPage));
}

beforeEach(() => {
  Object.defineProperty(window, "localStorage", { value: memoryStorage(), configurable: true });
  vi.stubEnv("NEXT_PUBLIC_AILX_BACKEND", "1");
  vi.stubEnv("NEXT_PUBLIC_BASE_PATH", "");
  window.localStorage.setItem("ailx:dev-user", "player-9");
  saveAttempt(window.localStorage, hostedLog());
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("a finalized sitting the service has scored", () => {
  const FINALIZED = {
    finalized: true,
    pending: false,
    pollAfterMs: 5000,
    tracks: [scored("t2", 30.83), scored("t3", 103.333)],
  };

  it("stops telling a finished candidate to finish their run", async () => {
    serviceAnswers(FINALIZED);
    const html = await reportHtml();
    expect(html).not.toContain("Finish the run to see it");
    expect(html).toContain("Your sitting is finished");
  });

  it("offers no Continue back into the loop it came from", async () => {
    serviceAnswers(FINALIZED);
    expect(await reportHtml()).not.toContain("Continue →");
  });

  it("shows the numbers the service issued, and says who issued them", async () => {
    serviceAnswers(FINALIZED);
    const html = await reportHtml();
    expect(html).toContain("Scores of record");
    expect(html).toContain("issued by finalize");
  });

  it("says why there is no composite instead of leaving a hole", async () => {
    serviceAnswers(FINALIZED);
    expect(await reportHtml()).toMatch(/no composite/i);
  });
});

describe("a sitting the service still calls open", () => {
  it("keeps the lock and the way back into the run", async () => {
    serviceAnswers({ finalized: false, pending: false, pollAfterMs: null, tracks: [] });
    const html = await reportHtml();
    expect(html).toContain("Finish the run to see it");
    expect(html).toContain("Continue →");
  });
});
