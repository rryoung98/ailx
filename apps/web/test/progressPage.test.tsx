// @vitest-environment jsdom
/**
 * /progress — one person's trajectory.
 *
 * The derivation is proven pure in @ailx/report and against real Postgres in
 * @ailx/backend. What is asserted HERE is the page's half of the contract:
 * it draws only what the service gave it, it says WHY a figure is missing
 * instead of drawing an empty chart, it never renders anything score-shaped
 * that we cannot back, it renders nothing personal to a caller the server did
 * not recognise, and its charts are hand-rolled accessible SVG.
 *
 * Since the page moved off the in-process handler it also has to prove the
 * IDENTITY story: the `ailx_dev_user` cookie is `SameSite=Lax` and never
 * reaches another origin, so this page must send the header on every read,
 * and must say something honest when the read fails outright.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import {
  CLAIMED_DAYS_BASIS,
  CLAIM_PROMISE,
  PROGRESS_BASIS,
  progressReport,
  type PracticeDayCounts,
  type ProgressReport,
  type SittingPoint,
} from "@ailx/report";
import { TRACK_IDS, type TrackRawScores } from "@ailx/session";
import { DEV_USER_HEADER } from "@ailx/contract";
import {
  installMemoryStorage,
  renderClient,
  renderClientPending,
  stubFailingFetch,
  stubHangingFetch,
  stubJsonFetch,
  type StubbedCall,
} from "./helpers/clientPage";
import { setAuthTokenSource } from "../lib/authHeaders";
import { ProgressView } from "../lib/ProgressView";
import { metadata } from "../app/progress/page.api";

installMemoryStorage();

const shape = (n: number): TrackRawScores =>
  Object.fromEntries(TRACK_IDS.map((t, i) => [t, n + i])) as TrackRawScores;

const TODAY = "2026-03-10";
const back = (n: number): string =>
  new Date(Date.parse(`${TODAY}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);

function report(over: {
  days?: PracticeDayCounts[];
  sittings?: SittingPoint[];
} = {}): ProgressReport {
  return progressReport({
    days: over.days ?? [],
    sittings: over.sittings ?? [],
    today: TODAY,
    trackName: (t) => `Track ${t}`,
  });
}

const busyDays: PracticeDayCounts[] = [4, 3, 2, 1, 0].map((n) => ({
  day: back(n),
  sessions: 1,
  answered: 6,
  correct: n >= 3 ? 2 : 5,
}));

let status = 200;
let payload: ProgressReport;
/** Days this account claimed from a browser, as the service reports them. */
let claimedDays: string[] = [];
let calls: StubbedCall[] = [];

const markup = async (): Promise<string> => renderClient(createElement(ProgressView));

beforeEach(() => {
  status = 200;
  payload = report({
    days: busyDays,
    sittings: [
      { attemptId: "a", startedOn: "2026-01-05", scores: shape(40) },
      { attemptId: "b", startedOn: "2026-02-20", scores: shape(60) },
    ],
  });
  window.localStorage.setItem("ailx:dev-user", "player-1");
  claimedDays = [];
  calls = stubJsonFetch(() => ({
    status,
    body:
      status === 200
        ? { progress: payload, claimedDays }
        : { error: { code: "unauthorized", message: "authentication required" } },
  }));
});
afterEach(() => {
  setAuthTokenSource(null);
  vi.unstubAllGlobals();
});

describe("who it is for", () => {
  it("asks the seam for /progress", async () => {
    await markup();
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toMatch(/\/api\/progress$/);
  });

  it("sends identity as a HEADER — the Lax cookie never crosses an origin", async () => {
    await markup();
    expect(calls[0].headers[DEV_USER_HEADER]).toBe("player-1");
  });

  it("sends a proven token instead of the asserted id when one is mounted", async () => {
    setAuthTokenSource(async () => "jwt-123");
    await markup();
    expect(calls[0].headers.authorization).toBe("Bearer jwt-123");
    // Never both: the server must not be able to choose which one it reads.
    expect(calls[0].headers[DEV_USER_HEADER]).toBeUndefined();
  });

  it("renders nothing personal when the server did not recognise the caller", async () => {
    status = 401;
    const html = await markup();
    expect(html).not.toContain("day streak");
    expect(html).not.toContain("2026-01-05");
    expect(html).not.toContain("<svg");
    // ...and still offers the drill, which works without an identity.
    expect(html).toContain("/practice");
  });

  it("does not tell a dev-auth deployment to sign in — there is nowhere to do it", async () => {
    // No token source is mounted, and a dev deployment answers 200 to any
    // asserted id, so the only non-200 it can produce is a refusal of a
    // malformed one. Either way there is no sign-in to point at.
    status = 400;
    const html = await markup();
    expect(html).not.toMatch(/[Ss]ign in/);
    expect(html).toContain("Nothing has been played in this browser");
    expect(html).toContain("no accounts");
  });

  it("does offer sign-in when the deployment actually has accounts", async () => {
    // A 401 can only come from a provider that VERIFIES, so it is the honest
    // signal that accounts exist on this deployment.
    status = 401;
    const html = await markup();
    expect(html).toContain("We do not know who you are");
    expect(html).toContain("Sign in and come back");
  });

  it("offers to forget the browser only where identity IS the browser", async () => {
    expect(await markup()).toContain("Forget this browser");
    setAuthTokenSource(async () => "jwt-123");
    expect(await markup()).not.toContain("Forget this browser");
  });

  it("is never indexed — it is one person's history", () => {
    expect(metadata.robots).toMatchObject({ index: false });
  });
});

describe("when the service cannot be reached", () => {
  it("says it is loading first, and shows no figure it does not have", async () => {
    stubHangingFetch();
    const html = await renderClientPending(createElement(ProgressView));
    expect(html).toContain("Loading");
    expect(html).not.toContain("day streak");
  });

  it("says so honestly instead of rendering an empty history", async () => {
    stubFailingFetch();
    const html = await markup();
    expect(html).toContain("could not reach the AILX service");
    // Crucially NOT the "nothing has been played" copy: an outage must never
    // be reported to a player as "you did nothing".
    expect(html).not.toContain("Nothing has been played in this browser");
    expect(html).not.toContain("day streak");
  });
});

describe("the streak", () => {
  it("shows current, best and lifetime days", async () => {
    const html = await markup();
    expect(html).toContain("day streak");
    expect(html).toContain("your best");
    expect(html).toContain("days practised");
  });

  it("frames a lapsed streak as a record kept, not a loss", async () => {
    payload = report({
      days: [40, 39, 38].map((n) => ({ day: back(n), sessions: 1, answered: 6, correct: 4 })),
    });
    const html = await markup();
    expect(payload.streak.current).toBe(0);
    expect(payload.streak.best).toBe(3);
    expect(html).toContain("a break costs the run, never the record");
    expect(html).not.toMatch(/lost|failed|penalt/i);
  });

  it("states the rule it is applying, including the rest day", async () => {
    const html = await markup();
    expect(html).toMatch(/survives one missed day/i);
    expect(html).toMatch(/your own\s*local day/i);
    expect(html).toMatch(/reward a habit/i);
  });

  it("tells a player with nothing yet what one round is worth", async () => {
    payload = report();
    const html = await markup();
    expect(html).toContain("is a day, and the first one starts the streak");
  });

  it("draws no counters at all before the first practice day", async () => {
    payload = report();
    const html = await markup();
    // "0 day streak / 0 your best / 0 days practised" reads as a broken page
    // and as a record nobody has failed to set. Nothing to count, so nothing
    // is counted.
    expect(html).not.toContain("your best");
    expect(html).not.toContain("days practised");
    expect(html).not.toContain(">0<");
  });

  it("gives the empty page one thing to actually press", async () => {
    payload = report();
    const html = await markup();
    expect(html).toContain('class="btn primary" href="/practice"');
  });
});

describe("what it draws", () => {
  it("draws hand-rolled SVG with an accessible label, and no canvas or chart library", async () => {
    const html = await markup();
    expect(html).toContain("<svg");
    expect(html).toMatch(/role="img" aria-label="Practice accuracy per day\./);
    expect(html).toMatch(/role="img" aria-label="Each track across your sittings/);
    expect(html).not.toContain("<canvas");
    expect(html).not.toMatch(/recharts|chart\.js|d3/i);
  });

  it("backs every chart with a real table or legend, not pixels alone", async () => {
    const html = await markup();
    expect(html).toContain("<caption");
    expect(html).toContain('scope="row"');
    for (const day of busyDays) expect(html).toContain(day.day);
  });

  it("says why the accuracy trend is missing instead of drawing an empty one", async () => {
    payload = report({ days: [{ day: back(0), sessions: 1, answered: 6, correct: 3 }] });
    const html = await markup();
    expect(html).toContain("Not enough yet");
    expect(html).not.toMatch(/aria-label="Practice accuracy per day/);
  });

  it("says why the sitting comparison is missing, for zero and for one run", async () => {
    payload = report({ days: busyDays });
    expect(await markup()).toContain("no completed run yet");
    payload = report({ days: busyDays, sittings: [{ attemptId: "a", startedOn: "2026-01-05", scores: shape(40) }] });
    expect(await markup()).toContain("One sitting so far");
  });

  it("reports what moved, in both directions, with the raw numbers", async () => {
    const html = await markup();
    expect(html).toContain("What moved");
    expect(html).toContain("+20");
    expect(html).toContain("40 → 60");
  });

  it("says nothing moved rather than inventing a figure", async () => {
    payload = report();
    const html = await markup();
    expect(html).toContain("Nothing has moved enough to report");
  });
});

describe("honesty", () => {
  it("carries the one basis sentence verbatim from @ailx/report", async () => {
    const html = await markup();
    // Rendered through JSX, so apostrophes/dashes survive; check the claims.
    expect(PROGRESS_BASIS).toMatch(/No percentile, no composite/);
    expect(html).toContain("No percentile, no composite");
    expect(html).toContain("judging pipeline is not built");
  });

  it("labels sitting values as the run's own scorers, not a judged result", async () => {
    const html = await markup();
    expect(html).toMatch(/own scorers over its stored event log/);
    expect(html).toMatch(/not a judged result/);
  });

  it("never publishes a percentile, a composite, a rank or a cohort comparison", async () => {
    const html = await markup();
    expect(html).not.toMatch(/percentile of|you rank|top \d+%|composite score|out of \d+ players/i);
    expect(html).not.toMatch(/leaderboard|compared to others|better than \d+%/i);
  });

  it("is not a game economy: no currency, no unlocks, no leaderboard", async () => {
    const html = await markup();
    expect(html).not.toMatch(/\bcoins?\b|\bgems?\b|\bXP\b|\bpoints? earned\b|unlock|badge|level up/i);
  });
});

/**
 * Days a signed-out browser handed over at sign-in. They are the browser's
 * word, not a server stamp, and the page says which is which rather than
 * blending them invisibly into days we measured ourselves.
 */
describe("claimed practice days", () => {
  it("labels a claimed day in words, and explains what a claimed day is", async () => {
    claimedDays = [back(4), back(3)];
    const html = await markup();
    expect(html).toContain("brought from a browser");
    expect(html).toContain(CLAIMED_DAYS_BASIS);
  });

  it("labels only the days the service named", async () => {
    claimedDays = [back(4)];
    const html = await markup();
    expect(html.match(/brought from a browser/g)).toHaveLength(1);
  });

  it("says nothing about claimed days when there are none", async () => {
    const html = await markup();
    expect(html).not.toContain("brought from a browser");
    expect(html).not.toContain(CLAIMED_DAYS_BASIS);
  });

  it("survives a service that sends no claimedDays field at all", async () => {
    claimedDays = undefined as never;
    const html = await markup();
    expect(html).toContain("day streak");
    expect(html).not.toContain("brought from a browser");
  });

  it("promises the anonymous visitor their days will move, on the page that asks", async () => {
    status = 401;
    const html = await markup();
    expect(html).toContain(CLAIM_PROMISE);
  });
});
