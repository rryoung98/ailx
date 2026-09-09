/**
 * TEN-160 — the two sentences a candidate can see when a stored run log does
 * not load clean, and the promise that they are never the same sentence.
 *
 * Before this, both cases printed "stored run log had N corrupt trailing
 * entries truncated". One of them was a lie: a log written by an older build
 * is not corrupt, and telling a candidate their run was corrupted when it was
 * merely OLD is the kind of thing that makes people stop trusting the number
 * at the end.
 */
import { describe, expect, it } from "vitest";
import type { ValidatedLog } from "@ailx/session";
import { persistNotice } from "../features/exam/persistNotice";

const clean: ValidatedLog = { log: [], dropped: 0, legacyScores: 0, legacyTracks: [] };
const legacy: ValidatedLog = { ...clean, legacyScores: 1, legacyTracks: ["t2"] };
/**
 * A TRUNCATION keeps a prefix — that is what "everything before that point is
 * intact" refers to. A dropped log with NO prefix is a different sentence
 * (TEN-220), so these fixtures carry the entry that survived.
 */
const survivor = [{ type: "attempt_started", seq: 0 }] as unknown as ValidatedLog["log"];
const tampered: ValidatedLog = {
  ...clean,
  log: survivor,
  dropped: 4,
  reason: "entry 4 rejected: Error: track_scored rejected: judgmentIds[0] claims x but the stored row content-addresses to y",
};

describe("persistNotice", () => {
  it("says nothing about a log that loaded clean", () => {
    expect(persistNotice(clean)).toBeNull();
    expect(persistNotice(null)).toBeNull();
    expect(persistNotice(undefined)).toBeNull();
  });

  it("names the OLDER BUILD case, and does not call it damage", () => {
    const n = persistNotice(legacy)!;
    expect(n.kind).toBe("legacy");
    expect(n.message).toContain("recorded by an older version of Foray");
    expect(n.message).toContain("T2");
    expect(n.message).toContain("The rest of your run was kept.");
    expect(n.message).not.toMatch(/corrupt|damaged|tamper/i);
    expect(n.label).toBe("Older version of Foray");
  });

  it("names the TAMPER case, and says the log disagrees with its evidence", () => {
    const n = persistNotice(tampered)!;
    expect(n.kind).toBe("tamper");
    expect(n.message).toContain("does not match its evidence");
    expect(n.message).toContain("The last 4 entries");
    expect(n.message).toContain(tampered.reason!);
    expect(n.label).toBe("Saved run damaged");
  });

  it("THE TWO ARE NEVER CONFUSABLE — neither message contains the other's claim", () => {
    const l = persistNotice(legacy)!.message;
    const t = persistNotice(tampered)!.message;
    expect(l).not.toContain("does not match its evidence");
    expect(t).not.toContain("older version of Foray");
    expect(l).not.toEqual(t);
    expect(persistNotice(legacy)!.label).not.toEqual(persistNotice(tampered)!.label);
  });

  it("shows BOTH sentences, whole, when both happened", () => {
    const n = persistNotice({ ...tampered, legacyScores: 1, legacyTracks: ["t2"] })!;
    expect(n.kind).toBe("both");
    expect(n.message).toContain("does not match its evidence");
    expect(n.message).toContain("older version of Foray");
    // The louder heading wins.
    expect(n.label).toBe("Saved run damaged");
  });

  it("reads correctly for one track and for several", () => {
    const one = persistNotice(legacy)!.message;
    expect(one).toContain("Its saved score for T2 predates the rule");
    expect(one).toContain("It carries no evidence trail");
    expect(one).toContain("Sit T2 again");
    const many = persistNotice({ ...clean, legacyScores: 2, legacyTracks: ["t2", "t3"] })!.message;
    expect(many).toContain("Its saved scores for T2 and T3 predate the rule");
    expect(many).toContain("They carry no evidence trail");
    const three = persistNotice({ ...clean, legacyScores: 3, legacyTracks: ["t1", "t2", "t3"] })!.message;
    expect(three).toContain("T1, T2 and T3");
  });

  it("counts one dropped entry in the singular", () => {
    const n = persistNotice({ ...clean, log: survivor, dropped: 1, reason: "entry 1 rejected: x" })!;
    expect(n.message).toContain("The last 1 entry did not replay and was dropped");
  });

  /**
   * A log that dropped EVERYTHING says so, and never claims a prefix that
   * does not exist. Returning null for this case is what let the candidate
   * start over in silence (TEN-220).
   */
  it("says nothing was restored when nothing survived the replay", () => {
    const n = persistNotice({ ...clean, dropped: 3, reason: "entry 0 rejected: x" })!;
    expect(n.kind).toBe("tamper");
    expect(n.label).toBe("Saved run damaged");
    expect(n.message).toContain("None of it replayed");
    expect(n.message).toContain("starts from the beginning");
    expect(n.message).not.toContain("Everything before that point is intact");
    expect(n.message).toContain("entry 0 rejected: x");
  });

  it("does not print 'undefined' when a truncation carries no reason", () => {
    const n = persistNotice({ ...clean, log: survivor, dropped: 2 })!;
    expect(n.message).toContain("Technical reason: unknown.");
  });

  it("carries no em dashes — house copy rule", () => {
    for (const v of [legacy, tampered]) {
      expect(persistNotice(v)!.message).not.toContain("\u2014");
    }
  });
});
