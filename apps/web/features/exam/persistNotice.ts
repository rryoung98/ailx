/**
 * What the candidate is told when a stored run log does not load cleanly.
 *
 * There are two different things that can happen here, and until TEN-160 the
 * exam page said the same sentence for both:
 *
 *  - the log DISAGREES WITH ITS OWN EVIDENCE. Some entry failed to replay, so
 *    it and everything after it is gone. That is the tamper case, and it is
 *    the one worth alarming about.
 *  - the log was WRITTEN BY AN OLDER BUILD, before a score had to attest the
 *    judgment rows it was computed from. Nothing is wrong with the run. Foray
 *    just cannot present an unattested score as a score of record.
 *
 * A candidate deserves to know which of those happened, so this module makes
 * the two sentences share no wording. It is pure and framework-free, which is
 * how the copy can be pinned by a test that never mounts a page.
 */
import type { ValidatedLog } from "@ailx/session";

export interface PersistNotice {
  /** Banner heading. */
  label: string;
  /** Body sentence(s). */
  message: string;
  /** Which case this is, for tests and for anything that styles by severity. */
  kind: "tamper" | "legacy" | "both";
}

const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many);

/** "T2", or "T2 and T3", or "T1, T2 and T3". */
function listTracks(tracks: readonly string[]): string {
  const names = tracks.map((t) => t.toUpperCase());
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

function legacySentence(v: ValidatedLog): string {
  const n = v.legacyTracks.length;
  const which = listTracks(v.legacyTracks);
  const scores = plural(n, "score", "scores");
  const they = plural(n, "It carries", "They carry");
  const predate = plural(n, "predates", "predate");
  return (
    `This run was recorded by an older version of Foray. Its saved ${scores} for ` +
    `${which} ${predate} the rule that a score must name the evidence it came from. ` +
    `${they} no evidence trail, so Foray will not show ${plural(n, "it", "them")} as a ` +
    `score of record. The rest of your run was kept. Sit ${which} again to be scored.`
  );
}

function tamperSentence(v: ValidatedLog): string {
  const n = v.dropped;
  /**
   * NOTHING survived. Saying "everything before that point is intact" here
   * would be false — there is no before. This is the case that used to be
   * reported as no stored run at all (TEN-220).
   */
  if (v.log.length === 0) {
    return (
      "This saved run does not match its evidence. None of it replayed, so none of it could be "
      + `restored and this run starts from the beginning. Technical reason: ${v.reason ?? "unknown"}.`
    );
  }
  return (
    `This log does not match its evidence. The last ${n} ${plural(n, "entry", "entries")} ` +
    `did not replay and ${plural(n, "was", "were")} dropped. Everything before that point ` +
    `is intact. Technical reason: ${v.reason ?? "unknown"}.`
  );
}

/**
 * The banner for a loaded log, or null when it loaded clean.
 *
 * When BOTH happened, both sentences are shown, in that order, under the
 * louder heading. They stay separate sentences on purpose: merging them would
 * put the reader back where they started.
 */
export function persistNotice(v: ValidatedLog | null | undefined): PersistNotice | null {
  if (!v) return null;
  const tampered = v.dropped > 0;
  const legacy = v.legacyTracks.length > 0;
  if (tampered && legacy) {
    return {
      kind: "both",
      label: "Saved run damaged",
      message: `${tamperSentence(v)} ${legacySentence(v)}`,
    };
  }
  if (tampered) {
    return { kind: "tamper", label: "Saved run damaged", message: tamperSentence(v) };
  }
  if (legacy) {
    return { kind: "legacy", label: "Older version of Foray", message: legacySentence(v) };
  }
  return null;
}
