// @vitest-environment jsdom
/**
 * /progress — one person's trajectory.
 *
 * The derivation is proven pure in @ailx/report and against real Postgres in
 * @ailx/backend. What is asserted HERE is the page's half of the contract:
 * it draws only what the handler gave it, it says WHY a figure is missing
 * instead of drawing an empty chart, it never renders anything score-shaped
 * that we cannot back, it renders nothing personal to a caller the server did
 * not recognise, and its charts are hand-rolled accessible SVG.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  PROGRESS_BASIS,
  progressReport,
  type PracticeDayCounts,
  type ProgressReport,
  type SittingPoint,
} from "@ailx/report";
import { TRACK_IDS, type TrackRawScores } from "@ailx/session";
import { DevAuthProvider } from "@ailx/backend";

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
const seenHeaders: Record<string, string>[] = [];
/** What the deployment's AuthProvider is — the anonymous copy depends on it. */
let authMode = "dev";
/** What the browser actually sent. A navigation carries cookies, not headers. */
let requestHeaders: Record<string, string> = { "x-ailx-dev-user": "player-1" };

vi.mock("../lib/server/api", async () => {
  const { DevAuthProvider } = await vi.importActual<typeof import("@ailx/backend")>("@ailx/backend");
  return {
    withApiContext: async (fn: (ctx: unknown) => Promise<unknown>) =>
      fn({ db: {}, auth: new DevAuthProvider() }),
    requestHeaderMap: async () => ({ ...requestHeaders }),
    authProviderName: async () => authMode,
  };
});
vi.mock("next/headers", () => ({
  headers: async () => new Headers(requestHeaders),
}));
vi.mock("@ailx/backend", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("@ailx/backend");
  return {
    ...actual,
    handleProgress: async (_ctx: unknown, headers: Record<string, string>) => {
      seenHeaders.push(headers);
      return status === 200
        ? { status, body: { progress: payload } }
        : { status, body: { error: { code: "unauthorized", message: "authentication required" } } };
    },
  };
});

const { default: ProgressPage, metadata } = await import("../app/progress/page.api");

const markup = async (): Promise<string> => renderToStaticMarkup(await ProgressPage());

beforeEach(() => {
  seenHeaders.length = 0;
  status = 200;
  authMode = "dev";
  requestHeaders = { "x-ailx-dev-user": "player-1" };
  payload = report({
    days: busyDays,
    sittings: [
      { attemptId: "a", startedOn: "2026-01-05", scores: shape(40) },
      { attemptId: "b", startedOn: "2026-02-20", scores: shape(60) },
    ],
  });
});

describe("who it is for", () => {
  it("forwards the real request headers to the handler rather than trusting a prop", async () => {
    await markup();
    expect(seenHeaders[0]["x-ailx-dev-user"]).toBe("player-1");
  });

  it("forwards the COOKIE too — a navigation carries no header at all", async () => {
    requestHeaders = { cookie: "other=1; ailx_dev_user=web-abc" };
    await markup();
    expect(seenHeaders[0]["cookie"]).toBe("other=1; ailx_dev_user=web-abc");
    // ...and that map is enough for the real provider to name the caller,
    // which is the whole reason /progress was unreachable in a browser.
    expect(await new DevAuthProvider().verify(seenHeaders[0])).toEqual({ authRef: "dev:web-abc" });
  });

  it("lets an explicit header win over the cookie the browser is carrying", async () => {
    requestHeaders = { "x-ailx-dev-user": "player-1", cookie: "ailx_dev_user=web-abc" };
    await markup();
    expect(await new DevAuthProvider().verify(seenHeaders[0])).toEqual({ authRef: "dev:player-1" });
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
    status = 401;
    const html = await markup();
    expect(html).not.toMatch(/[Ss]ign in/);
    expect(html).toContain("Nothing has been played in this browser");
    expect(html).toContain("no accounts");
  });

  it("does offer sign-in when the deployment actually has accounts", async () => {
    status = 401;
    authMode = "clerk";
    const html = await markup();
    expect(html).toContain("We do not know who you are");
    expect(html).toContain("Sign in and come back");
  });

  it("offers to forget the browser only where identity IS the browser", async () => {
    expect(await markup()).toContain("Forget this browser");
    authMode = "clerk";
    expect(await markup()).not.toContain("Forget this browser");
  });

  it("is never indexed — it is one person's history", () => {
    expect(metadata.robots).toMatchObject({ index: false });
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
