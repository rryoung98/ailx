/**
 * The four response schemas TEN-216 added, checked against bodies built by
 * the SAME pure derivations the exam service builds them with. A schema that
 * only ever sees hand-spelled fixtures is a second guess at the wire, not a
 * contract.
 */
import { describe, expect, it } from "vitest";
import {
  credentialDocument,
  progressReport,
  sharePayloadFrom,
  worldAggregates,
  type CredentialClaim,
} from "@ailx/report";
import { API_RESPONSE_SCHEMAS } from "../src/index.js";

const report = progressReport({
  days: [{ day: "2026-03-01", sessions: 1, answered: 8, correct: 5 }],
  sittings: [{ attemptId: "att-1", startedOn: "2026-02-20", scores: { t1: 40, t2: 41, t3: 42, t4: 43 } }],
  today: "2026-03-02",
  trackName: (t) => `Track ${t}`,
});

const aggregates = worldAggregates({
  counts: { participants: 12, attemptsStarted: 14, attemptsFinalized: 12 },
  shapes: Array.from({ length: 12 }, (_, i) => ({ t1: 10 + i, t2: 20 + i, t3: 30 + i, t4: 40 + i })),
  exposure: {
    decksRecorded: 12,
    distinctItems: 120,
    totalExposures: 480,
    meanExposuresPerItem: 4,
    maxExposuresPerItem: 9,
  },
  trend: [{ period: "2026-02-02", started: 14, finalized: 12 }],
});

const share = {
  status: "unlisted",
  createdAt: "2026-02-03T10:00:00.000Z",
  views: 7,
  payload: sharePayloadFrom({ t1: 88.2, t2: 79.5, t3: 71.1, t4: 66.9 }, "Distinction", {
    instrument: "ailx 2026.1",
  }),
};

/**
 * A claim as `buildCredentialClaim` writes one. Spelled here rather than
 * derived, because this package does not depend on `@ailx/session` and a test
 * is not a reason to make it.
 */
const claim: CredentialClaim = {
  v: 1,
  instrument: "ailx 2026.1",
  instrumentVersion: "2026.1",
  completedOn: "2026-02-03",
  tracksAttempted: ["T1", "T2", "T3", "T4"],
  playerType: { code: "MSVD", name: "The Maker" },
  artifact: "/api/site/sha256:abc/index.html",
  claims: ["completed_sitting"],
};

const document_ = credentialDocument(
  claim,
  {
    code: "AILX-2026.1-AB12-CD34-EF56-GH78",
    status: "valid" as const,
    issuedAt: "2026-02-04T09:30:00.000Z",
    revokedAt: null,
    revokeReason: null,
  },
  "https://ailx.example",
);

describe("the bodies the four rendering pages read", () => {
  it("accepts what @ailx/report actually builds", () => {
    expect(API_RESPONSE_SCHEMAS.progress.safeParse({ progress: report }).success).toBe(true);
    expect(API_RESPONSE_SCHEMAS.progress.safeParse({ progress: report, claimedDays: ["2026-03-01"] }).success).toBe(true);
    expect(API_RESPONSE_SCHEMAS.aggregates.safeParse({ aggregates }).success).toBe(true);
    expect(API_RESPONSE_SCHEMAS.shareView.safeParse({ share }).success).toBe(true);
    expect(API_RESPONSE_SCHEMAS.credentialView.safeParse(document_).success).toBe(true);
  });

  /** One missing key is all a deploy skew needs to be. */
  it("refuses a body with a key missing, rather than handing on a hole", () => {
    const { streak: _s, ...noStreak } = report;
    expect(API_RESPONSE_SCHEMAS.progress.safeParse({ progress: noStreak }).success).toBe(false);
    const { participation: _p, ...noParticipation } = aggregates;
    expect(API_RESPONSE_SCHEMAS.aggregates.safeParse({ aggregates: noParticipation }).success).toBe(false);
    const { payload: _pl, ...noPayload } = share;
    expect(API_RESPONSE_SCHEMAS.shareView.safeParse({ share: noPayload }).success).toBe(false);
    expect(API_RESPONSE_SCHEMAS.credentialView.safeParse({ hello: "world" }).success).toBe(false);
  });

  /** And a key we do not know: the two sides disagree, and that is not silent. */
  it("refuses an unknown key", () => {
    expect(API_RESPONSE_SCHEMAS.progress.safeParse({ progress: report, surprise: 1 }).success).toBe(false);
    expect(API_RESPONSE_SCHEMAS.aggregates.safeParse({ aggregates, surprise: 1 }).success).toBe(false);
    expect(API_RESPONSE_SCHEMAS.shareView.safeParse({ share, surprise: 1 }).success).toBe(false);
  });
});
