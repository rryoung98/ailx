/**
 * Event-derived process insights for the diagnostic report (spec §13:
 * "the diagnostic report is the real reward"). Pure functions over the
 * projected session state.
 */

import type { SessionState, TrackId } from "@ailx/session";
import { TRACK_IDS } from "@ailx/session";

export interface TrackProcessInsight {
  trackId: TrackId;
  eventCount: number;
  verbCounts: Record<string, number>;
  activeSeconds: number;
  budgetSeconds: number;
  timeUsedFrac: number;
  timedOut: boolean;
  /** revised+regenerated per prompted — where iteration was diagnostic vs random. */
  iterationRatio: number | null;
  /**
   * Verified events plus UNIQUE challenged claims (the T3 scorer dedupes
   * stance toggles per claim; counting raw clicks would let a stance-flipper
   * look like a thorough verifier). Every consumer reads this one field.
   */
  verificationEvents: number;
}

export function trackInsights(state: SessionState): TrackProcessInsight[] {
  return TRACK_IDS.map((trackId) => {
    const t = state.tracks[trackId];
    const budget = state.config?.budgets[trackId] ?? 0;
    const verbCounts: Record<string, number> = {};
    for (const e of t.events) verbCounts[e.verb] = (verbCounts[e.verb] ?? 0) + 1;
    const prompted = verbCounts["prompted"] ?? 0;
    const iterations = (verbCounts["revised"] ?? 0) + (verbCounts["regenerated"] ?? 0);
    const challengedClaims = new Set(
      t.events.filter((e) => e.verb === "challenged").map((e) => e.object),
    );
    const activeSeconds = Math.round(t.activeMs / 1000);
    return {
      trackId,
      eventCount: t.events.length,
      verbCounts,
      activeSeconds,
      budgetSeconds: budget,
      timeUsedFrac: budget > 0 ? Math.min(1, activeSeconds / budget) : 0,
      timedOut: t.timedOut === true,
      iterationRatio: prompted > 0 ? Math.round((iterations / prompted) * 100) / 100 : null,
      verificationEvents: (verbCounts["verified"] ?? 0) + challengedClaims.size,
    };
  });
}

export interface AttemptNarrative {
  headline: string;
  detail: string;
}

/** Short, honest narratives from the process data. */
export function narratives(insights: TrackProcessInsight[]): AttemptNarrative[] {
  const out: AttemptNarrative[] = [];
  const totalVerify = insights.reduce((a, i) => a + i.verificationEvents, 0);
  out.push(
    totalVerify > 0
      ? { headline: "You went back to the primary source", detail: `${totalVerify} verification event(s) recorded. Verification behaviour is a scored component of T3 process quality.` }
      : { headline: "No verification behaviour recorded", detail: "Going back to the primary source is a scored component of T3 process quality — its absence is the most common process finding." },
  );
  const iter = insights.filter((i) => i.iterationRatio !== null);
  if (iter.length > 0) {
    const avg = iter.reduce((a, i) => a + (i.iterationRatio ?? 0), 0) / iter.length;
    out.push(
      avg >= 0.5
        ? { headline: "Iteration was deliberate", detail: `Average of ${avg.toFixed(2)} revise/regenerate actions per prompt — the report distinguishes diagnostic iteration from random regeneration.` }
        : { headline: "Little iteration after prompting", detail: `Average of ${avg.toFixed(2)} revise/regenerate actions per prompt. First-output acceptance is the behaviour T3's planted errors are designed to catch.` },
    );
  }
  const rushed = insights.filter((i) => i.timeUsedFrac < 0.25 && i.eventCount > 0);
  const timedOut = insights.filter((i) => i.timedOut);
  if (timedOut.length > 0) {
    out.push({ headline: "Budget exhausted", detail: `${timedOut.map((i) => i.trackId.toUpperCase()).join(", ")} ended on the clock, not on submission.` });
  } else if (rushed.length > 0) {
    out.push({ headline: "Fast submissions", detail: `${rushed.map((i) => i.trackId.toUpperCase()).join(", ")} used under 25% of budget. Speed is deliberately never rewarded with points (spec §13).` });
  }
  return out;
}
