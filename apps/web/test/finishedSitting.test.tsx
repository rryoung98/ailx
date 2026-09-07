// @vitest-environment jsdom
/**
 * WHAT A FINISHED SITTING IS OFFERED (dogfood 2026-09-06, D2/D4).
 *
 * The first real signed-in sitting finished, was scored, and was offered
 * NOTHING: `GET /v1/attempts/:id/credential` answered 404, the report drew no
 * credential section and no share control, and a hand-rolled POST from the
 * console got a correctly named credential back in one call. `share_created`
 * had still never fired for the same reason — nothing asked.
 *
 * The panels existed. They were rendered only on the FULL local report, and a
 * hosted or partial sitting lands on the finished-sitting screen instead. So
 * these tests pin the offer where the candidate actually stands, and pin the
 * two things a partial sitting must never be told: that it was a full one, or
 * that a composite is still coming for it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import {
  append, saveAttempt,
  type SequencedEntry, type SessionConfig, type TrackId,
} from "@ailx/session";
import { WITHHELD_LEDE } from "../features/report/compositeView";
import { BOUND_COPY } from "../features/report/scoresOfRecord";
import { ScoresOfRecordView } from "../features/report/ScoresOfRecordPanel";
import { CredentialPanel } from "../features/report/CredentialPanel";
import { ShareLink } from "../features/report/ShareLink";
import { completedLog, memoryStorage } from "./helpers/completedAttempt";
import { renderClient } from "./helpers/clientPage";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const ATTEMPT = "1e4bd309-2f8a-4d21-9a37-1c0f0a2b3c4d";
const CODE = "FORAY-2026.1-AB12-CD34-EF56-GH78";

const config: SessionConfig = {
  instrument: "ailx", version: "2026.1", locale: "en",
  budgets: { t1: 600, t2: 600, t3: 600, t4: 600 }, demo: true,
};

/** The dogfooded run: T2 and T3 sat with no model connected, then finished. */
function partialLog(sat: readonly TrackId[]): SequencedEntry[] {
  let ts = Date.UTC(2026, 8, 6, 5, 33, 29);
  let log = append([], { type: "attempt_started", attemptId: ATTEMPT, config, ts });
  for (const t of sat) {
    ts += 1_000;
    log = append(log, { type: "track_started", trackId: t, ts });
    ts += 1_000;
    log = append(log, { type: "track_completed", trackId: t, artifact: {}, timedOut: false, ts });
  }
  return append(log, { type: "attempt_completed", ts: ts + 1_000 });
}

const scored = (trackId: string, scaled: number) => ({
  trackId,
  state: "scored",
  score: { raw: {}, scaled },
  rubricVersion: "rubric-2026.1-abcdef",
  scoringDigest: "0123456789abcdef",
  issuedBy: "finalize",
  computedAt: "2026-09-06T05:38:07.000Z",
});

/** The `scores` object the service returned for that sitting, D1 and all. */
const PARTIAL_SCORES = {
  finalized: true,
  pending: true,
  pollAfterMs: 5000,
  tracks: [
    { trackId: "t1", state: "not_sat", reason: "incomplete", detail: "" },
    scored("t2", 30.884),
    { trackId: "t3", state: "pending_judging", detail: "with the jury" },
    { trackId: "t4", state: "not_sat", reason: "incomplete", detail: "" },
  ],
  composite: {
    state: "withheld",
    reason: "awaiting_track",
    detail: "no composite is issued while a scored track has no score of record: T1, T3.",
    awaiting: [
      { trackId: "t1", trackState: "not_sat" },
      { trackId: "t3", trackState: "pending_judging" },
    ],
  },
};

const FULL_SCORES = {
  finalized: true,
  pending: false,
  pollAfterMs: null,
  tracks: [scored("t1", 70), scored("t2", 60), scored("t3", 80), scored("t4", 50)],
};

const claim = (tracksAttempted: string[], playerType: { code: string; name: string }) => ({
  v: 1,
  instrument: "foray 2026.1",
  instrumentVersion: "2026.1",
  completedOn: "2026-09-06",
  tracksAttempted,
  playerType,
  artifact: null,
  claims: ["sitting-completed"],
});

const owner = (tracksAttempted: string[], playerType: { code: string; name: string }, name: string) => ({
  id: "cred-1",
  code: CODE,
  status: "valid",
  issuedAt: "2026-09-06T05:40:00.000Z",
  revokedAt: null,
  revokeReason: null,
  claim: claim(tracksAttempted, playerType),
  verifyPath: `/verify/${CODE}`,
  linkedIn: {
    name,
    organizationName: "Foray",
    issueYear: 2026,
    issueMonth: 9,
    credentialId: CODE,
    credentialUrl: `https://foray.example/verify/${CODE}`,
  },
});

const PARTIAL_CREDENTIAL = owner(
  ["T2", "T3"],
  { code: "", name: "" },
  "Foray 2026.1 — Partial Sitting (T2, T3)",
);

/** Every request the report makes, answered the way the service answered. */
function serviceAnswers(scores: unknown): { url: string; method: string }[] {
  const calls: { url: string; method: string }[] = [];
  vi.stubGlobal("fetch", async (url: unknown, init?: { method?: string }) => {
    const u = String(url);
    const method = init?.method ?? "GET";
    calls.push({ url: u, method });
    const json = (body: unknown, status: number) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      });
    // No credential and no share exist yet — the state the offer is for.
    if (u.includes("/credential")) {
      return method === "GET" ? json({ error: "no live credential" }, 404) : json({ credential: PARTIAL_CREDENTIAL }, 201);
    }
    if (u.includes("/share")) return json({ error: "not found" }, 404);
    if (u.includes("/attempts/")) return json({ attempt: { id: ATTEMPT }, scores }, 200);
    return json({}, 200);
  });
  return calls;
}

async function reportHtml(): Promise<string> {
  const ReportPage = (await import("../app/report/page")).default;
  return renderClient(createElement(ReportPage));
}

beforeEach(() => {
  Object.defineProperty(window, "localStorage", { value: memoryStorage(), configurable: true });
  vi.stubEnv("NEXT_PUBLIC_AILX_BACKEND", "1");
  vi.stubEnv("NEXT_PUBLIC_BASE_PATH", "");
  window.localStorage.setItem("foray:dev-user", "player-9");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("a finished PARTIAL sitting", () => {
  beforeEach(() => {
    saveAttempt(window.localStorage, partialLog(["t2", "t3"]));
  });

  it("offers the credential and the share the service was willing to issue", async () => {
    serviceAnswers(PARTIAL_SCORES);
    const html = await reportHtml();
    expect(html).toContain("Issue my credential");
    expect(html).toContain("Create a share link");
  });

  it("treats the 404 as 'none yet' and never as an error", async () => {
    const calls = serviceAnswers(PARTIAL_SCORES);
    const html = await reportHtml();
    expect(calls.some((c) => c.url.includes("/credential") && c.method === "GET")).toBe(true);
    // Nothing was issued by loading the page: the ask is the candidate's.
    expect(calls.some((c) => c.url.includes("/credential") && c.method === "POST")).toBe(false);
    expect(html).toContain('data-testid="credential-offer"');
    expect(html).not.toContain("did not reach the exam service");
  });

  it("reads as partial, and never as a full sitting", async () => {
    serviceAnswers(PARTIAL_SCORES);
    const html = await reportHtml();
    expect(html).toContain("covers part of the instrument");
    expect(html).toContain("partial sitting");
    expect(html).toContain("no four-letter type");
  });

  it("keeps the composite's withheld reason on the screen", async () => {
    serviceAnswers(PARTIAL_SCORES);
    const html = await reportHtml();
    expect(html).toContain(WITHHELD_LEDE.awaiting_track.slice(0, 60));
    expect(html).toContain("no composite is issued while a scored track has no score of record");
  });

  it("does not promise a composite the jury cannot deliver", async () => {
    serviceAnswers(PARTIAL_SCORES);
    const html = await reportHtml();
    expect(html).toContain("no composite follows it");
    expect(html).not.toContain("The composite is issued when it does");
  });

  it("says a judged track is still with the jury, without hiding it", async () => {
    serviceAnswers(PARTIAL_SCORES);
    const html = await reportHtml();
    expect(html).toContain("being judged");
  });
});

describe("a finished FULL sitting", () => {
  beforeEach(() => {
    saveAttempt(window.localStorage, completedLog());
  });

  it("offers the credential and the share", async () => {
    serviceAnswers(FULL_SCORES);
    const html = await reportHtml();
    expect(html).toContain("Issue my credential");
    expect(html).toContain("Create a share link");
  });

  it("says nothing about a partial sitting", async () => {
    serviceAnswers(FULL_SCORES);
    const html = await reportHtml();
    expect(html).not.toContain("partial sitting");
    expect(html).not.toContain("covers part of the instrument");
  });
});

describe("an UNFINISHED run", () => {
  it("is offered neither: there is no completed sitting to assert", async () => {
    saveAttempt(window.localStorage, partialLog(["t2"]).filter((e) => e.type !== "attempt_completed"));
    serviceAnswers({ finalized: false, pending: false, pollAfterMs: null, tracks: [] });
    const html = await reportHtml();
    expect(html).not.toContain("Issue my credential");
    expect(html).not.toContain("Create a share link");
    expect(html).toContain("Finish the run to see it");
  });
});

/* The panels on their own, where a click is cheap. */
let container: HTMLDivElement;

async function mount(element: ReturnType<typeof createElement>): Promise<void> {
  await act(async () => {
    createRoot(container).render(element);
  });
}

const button = (name: RegExp): HTMLButtonElement | undefined =>
  [...container.querySelectorAll("button")].find((b) => name.test(b.textContent ?? ""));

describe("the credential panel for a partial sitting", () => {
  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
  });
  afterEach(() => container.remove());

  it("issues only when asked, then names the sitting partial", async () => {
    serviceAnswers(PARTIAL_SCORES);
    await mount(createElement(CredentialPanel, { attemptId: ATTEMPT, sat: ["t2", "t3"] }));
    expect(container.textContent).toContain("partial sitting");
    await act(async () => {
      button(/Issue my credential/)!.click();
    });
    expect(container.textContent).toContain("Foray 2026.1 — Partial Sitting (T2, T3)");
    expect(container.querySelector('[data-testid="credential-tracks"]')!.textContent).toBe("T2 · T3");
  });

  it("shows no four-letter code and no character for a partial claim", async () => {
    serviceAnswers(PARTIAL_SCORES);
    await mount(createElement(CredentialPanel, { attemptId: ATTEMPT, sat: ["t2", "t3"] }));
    await act(async () => {
      button(/Issue my credential/)!.click();
    });
    const type = container.querySelector('[data-testid="credential-player-type"]')!;
    expect(type.textContent).toContain("Not derived");
    // The empty pair the row carries is never printed as a blank code.
    expect(type.querySelector(".mono")).toBeNull();
  });

  it("never says the credential carries a score", async () => {
    serviceAnswers(PARTIAL_SCORES);
    await mount(createElement(CredentialPanel, { attemptId: ATTEMPT, sat: ["t2", "t3"] }));
    const text = container.textContent ?? "";
    expect(text).toContain("carries no score");
    expect(button(/Issue my credential/)!.textContent).not.toMatch(/score|result|pass/i);
  });
});

describe("the share panel for a partial sitting", () => {
  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
  });
  afterEach(() => container.remove());

  it("promises no type, character or band it does not have", async () => {
    serviceAnswers(PARTIAL_SCORES);
    await mount(createElement(ShareLink, { attemptId: ATTEMPT, sat: ["t2", "t3"] }));
    const text = container.textContent ?? "";
    expect(text).toContain("Send someone this sitting");
    expect(text).toContain("no four-letter type, no character and no band");
    expect(container.querySelector('[data-testid="share-card-copy"]')!.textContent).toContain(
      "the tracks you sat (T2 · T3)",
    );
  });

  it("keeps the type wording for a full sitting", async () => {
    serviceAnswers(FULL_SCORES);
    await mount(createElement(ShareLink, { attemptId: ATTEMPT, sat: ["t1", "t2", "t3", "t4"] }));
    expect(container.textContent).toContain("Send someone your player type");
    expect(container.querySelector('[data-testid="share-partial-notice"]')).toBeNull();
  });
});

describe("a track that is still awaiting judgment", () => {
  it("stops saying a score is coming, and offers a way to look again", () => {
    const view = {
      scores: {
        finalized: true,
        pending: true,
        pollAfterMs: 5000,
        tracks: [{ trackId: "t3" as TrackId, state: "pending_judging" as const, detail: "" }],
        composite: null,
      },
      failure: null,
      bounded: true,
      reading: false,
      arrived: [],
      checkAgain: () => undefined,
    };
    const host = document.createElement("div");
    document.body.append(host);
    act(() => {
      createRoot(host).render(createElement(ScoresOfRecordView, { view }));
    });
    expect(host.textContent).toContain(BOUND_COPY);
    expect(host.textContent).toContain("Check again");
    // The end state replaces the promise; it is never both.
    expect(host.textContent).not.toContain("Checking again in");
    host.remove();
  });
});
