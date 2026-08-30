/**
 * Shared report-test fixture: a COMPLETE, really-scored attempt plus a
 * spec-shaped in-memory Storage. Several report suites need the same page
 * state (visual polish, honesty labelling), and a second private copy of the
 * scoring walk would drift from this one.
 */
import { append, project, type SequencedEntry, type TrackId } from "@ailx/session";
import { buildSampleAttemptLog } from "../../lib/sampleAttempt";
import { scoreTrack } from "../../lib/registry";

/**
 * The sample fixture stops at between_tracks (validate scores it itself);
 * the report needs a SCORED, completed attempt — extend the fixture through
 * the same real scoring path the exam page uses (registry → plugin.score).
 */
export function completedLog(): SequencedEntry[] {
  let log = buildSampleAttemptLog();
  const lastTs = log[log.length - 1].ts;
  const completions = log.filter(
    (e): e is Extract<SequencedEntry, { type: "track_completed" }> => e.type === "track_completed",
  );
  let t = lastTs;
  for (const c of completions) {
    t += 1_000;
    const rec = scoreTrack(c.trackId as TrackId, c.artifact);
    log = append(log, {
      type: "track_scored", trackId: c.trackId, score: rec.score,
      judgments: rec.judgments, rubricVersion: rec.rubricVersion,
      scoringDigest: rec.scoringDigest, modelManifest: rec.modelManifest, ts: t,
    });
  }
  log = append(log, { type: "attempt_completed", ts: t + 1_000 });
  return log;
}

/** The projected state of {@link completedLog}. */
export function completedState() {
  return project(completedLog());
}

/**
 * jsdom in this environment does not always expose window.localStorage;
 * install a spec-shaped in-memory Storage so the page's persistence path runs.
 */
export function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() { return m.size; },
    clear: () => m.clear(),
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    key: (i: number) => Array.from(m.keys())[i] ?? null,
    removeItem: (k: string) => { m.delete(k); },
    setItem: (k: string, v: string) => { m.set(k, String(v)); },
  } as Storage;
}
