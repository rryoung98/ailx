/**
 * The funnel schema, as the exam service will meet it: an anonymous POST from
 * a browser nobody controls.
 *
 * Two properties are worth a test each. The parser accepts exactly the eight
 * steps and their declared fields, and it refuses anything else — a metrics
 * row is written without auth, so "a client would not send that" is not a
 * check. And nothing here carries a share token, an account id or exam
 * evidence, which is asserted over the SHAPE rather than trusted to review.
 */
import { describe, expect, it } from "vitest";
import {
  FUNNEL_BATCH_MAX,
  FUNNEL_EVENTS_PATH,
  FUNNEL_MAX_ANSWERED,
  FUNNEL_MAX_DAY_INDEX,
  FUNNEL_SCHEMA_VERSION,
  FUNNEL_STEPS,
  parseFunnelBatch,
  parseFunnelEvent,
  type FunnelEvent,
} from "../src/funnel.js";

const CLIENT = "3f1a2b4c-5d6e-4f70-8901-abcdef123456";
const SESSION = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const PLAY = "11111111-2222-4333-8444-555555555555";

function envelope(step: string): Record<string, unknown> {
  return {
    v: FUNNEL_SCHEMA_VERSION,
    step,
    clientId: CLIENT,
    sessionId: SESSION,
    ts: 1772000000000,
    monotonicMs: 1234.5,
    day: "2026-03-17",
    firstSeenDay: "2026-03-10",
    dayIndex: 7,
  };
}

/** One valid event per step, so every branch of the parser is exercised. */
const VALID: Record<string, Record<string, unknown>> = {
  visit_started: { ...envelope("visit_started"), newClient: false },
  landing_viewed: envelope("landing_viewed"),
  play_started: { ...envelope("play_started"), mode: "practice", playId: PLAY },
  play_completed: { ...envelope("play_completed"), mode: "daily", playId: PLAY, answered: 5 },
  signed_in: envelope("signed_in"),
  sitting_started: envelope("sitting_started"),
  share_created: envelope("share_created"),
  share_opened: envelope("share_opened"),
};

describe("the eight steps", () => {
  it("is the funnel the KPI doc describes, in order", () => {
    expect([...FUNNEL_STEPS]).toEqual([
      "visit_started",
      "landing_viewed",
      "play_started",
      "play_completed",
      "signed_in",
      "sitting_started",
      "share_created",
      "share_opened",
    ]);
  });

  it("has a valid fixture for every step", () => {
    expect(Object.keys(VALID).sort()).toEqual([...FUNNEL_STEPS].sort());
  });

  it.each(FUNNEL_STEPS)("parses a well-formed %s", (step) => {
    const parsed = parseFunnelEvent(VALID[step]);
    expect(parsed).not.toBeNull();
    expect(parsed!.step).toBe(step);
    expect(parsed!.dayIndex).toBe(7);
  });

  it("posts to one frozen path", () => {
    expect(FUNNEL_EVENTS_PATH).toBe("/events");
  });
});

describe("the parser refuses what it did not declare", () => {
  it.each([
    ["a step nobody declared", { ...envelope("play_abandoned") }],
    ["another schema version", { ...envelope("landing_viewed"), v: 2 }],
    ["a client id that is not one", { ...envelope("landing_viewed"), clientId: "user@example.com" }],
    ["a session id that is not one", { ...envelope("landing_viewed"), sessionId: "abc" }],
    ["a day that is not a date", { ...envelope("landing_viewed"), day: "2026-13-45" }],
    // Date.parse rolls this one over to 2 March rather than refusing it.
    ["a day that does not exist", { ...envelope("landing_viewed"), day: "2026-02-30" }],
    ["a first-seen day that does not exist", { ...envelope("landing_viewed"), firstSeenDay: "2025-02-29" }],
    ["a first-seen day that is not a date", { ...envelope("landing_viewed"), firstSeenDay: "" }],
    ["a negative monotonic stamp", { ...envelope("landing_viewed"), monotonicMs: -1 }],
    ["a wall clock at zero", { ...envelope("landing_viewed"), ts: 0 }],
    ["a day index past the rotation horizon", { ...envelope("landing_viewed"), dayIndex: FUNNEL_MAX_DAY_INDEX + 1 }],
    ["a fractional day index", { ...envelope("landing_viewed"), dayIndex: 1.5 }],
    ["a play mode that is not a loop", { ...envelope("play_started"), mode: "exam", playId: PLAY }],
    ["a play with no id", { ...envelope("play_started"), mode: "practice" }],
    ["more answers than a deck holds", { ...VALID.play_completed, answered: FUNNEL_MAX_ANSWERED + 1 }],
    ["a visit that will not say if it is new", { ...envelope("visit_started") }],
    ["not an object", "landing_viewed"],
    ["null", null],
  ])("refuses %s", (_label, value) => {
    expect(parseFunnelEvent(value)).toBeNull();
  });

  it("drops a field the schema does not declare rather than storing it", () => {
    const parsed = parseFunnelEvent({
      ...envelope("share_opened"),
      token: "s3cr3t-share-token",
      email: "a@b.example",
    });
    expect(parsed).not.toBeNull();
    expect(JSON.stringify(parsed)).not.toContain("s3cr3t");
    expect(JSON.stringify(parsed)).not.toContain("a@b.example");
  });

  it("keeps exam evidence out of the sitting step", () => {
    const parsed = parseFunnelEvent({ ...envelope("sitting_started"), attemptId: "att-123", responses: [1, 2] });
    expect(Object.keys(parsed as FunnelEvent).sort()).toEqual(
      ["clientId", "day", "dayIndex", "firstSeenDay", "monotonicMs", "sessionId", "step", "ts", "v"],
    );
  });
});

describe("a batch is all or nothing", () => {
  it("parses a batch of valid events", () => {
    const batch = parseFunnelBatch({ events: [VALID.visit_started, VALID.landing_viewed] });
    expect(batch?.map((e) => e.step)).toEqual(["visit_started", "landing_viewed"]);
  });

  it("refuses the whole batch when one row is malformed", () => {
    // Half-storing this batch would put a hole in one step's numerator and
    // leave the others looking healthy.
    expect(parseFunnelBatch({ events: [VALID.landing_viewed, { ...envelope("landing_viewed"), day: "nope" }] })).toBeNull();
  });

  it("refuses an empty batch and one longer than the cap", () => {
    expect(parseFunnelBatch({ events: [] })).toBeNull();
    const long = Array.from({ length: FUNNEL_BATCH_MAX + 1 }, () => VALID.landing_viewed);
    expect(parseFunnelBatch({ events: long })).toBeNull();
  });

  it("refuses a body that is not a batch", () => {
    expect(parseFunnelBatch(null)).toBeNull();
    expect(parseFunnelBatch({ events: "landing_viewed" })).toBeNull();
  });
});
