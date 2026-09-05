// @vitest-environment jsdom
/**
 * /progress and the practice days a signed-out browser is holding.
 *
 * TEN-132. Finish a round of practice signed out and the summary says "1 day
 * streak". Open /progress and it said "No practice days behind you yet", and
 * its method line said practice answers are "graded on the server". Both were
 * false at once: anonymous practice is recorded only in localStorage
 * (`apps/web/features/practice/PracticeDrill.tsx:135`, `recorded = server &&
 * identity.status === "signed-in"`), so the service has nothing to grade and
 * nothing to return.
 *
 * What is asserted here: the page reads the SAME ledger the drill writes,
 * labels it as this browser's own record, never claims a server grading step
 * that did not happen, and survives a browser with no storage, junk in the
 * key, or no service at all.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import {
  LOCAL_PRACTICE_BASIS,
  LOCAL_PRACTICE_KEY,
  PROGRESS_BASIS,
  progressReport,
  serializeLocalLedger,
  type PracticeDayCounts,
  type ProgressReport,
} from "@ailx/report";
import { localDay } from "@ailx/report";
import { utcOffsetMinutes } from "../lib/data/localPractice";
import {
  installMemoryStorage,
  renderClient,
  stubFailingFetch,
  stubJsonFetch,
} from "./helpers/clientPage";
import { setAuthTokenSource } from "../lib/data/authHeaders";
import { ProgressView } from "../features/progress/ProgressView";

const store = installMemoryStorage();

/**
 * Real clocks, not fake ones: the page mounts and flushes through
 * `setTimeout`, so freezing time hangs the render. The days are therefore
 * counted back from the browser's OWN local day, which is the day the ledger
 * is written against.
 */
const TODAY = localDay(Date.now(), utcOffsetMinutes());
const back = (n: number): string =>
  new Date(Date.parse(`${TODAY}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);

/** The ledger the drill writes, in the shape it writes it. */
function seedLedger(days: readonly string[], claimed = false): void {
  window.localStorage.setItem(
    LOCAL_PRACTICE_KEY,
    serializeLocalLedger({
      days: days.map((day) => ({ day, sessions: 1, answered: 6, correct: 4, claimed })),
    }),
  );
}

const report = (days: PracticeDayCounts[] = []): ProgressReport =>
  progressReport({ days, sittings: [], today: TODAY, trackName: (t) => `Track ${t}` });

let status = 200;
let payload: ProgressReport;

const markup = async (): Promise<string> => renderClient(createElement(ProgressView));

beforeEach(() => {
  status = 200;
  payload = report();
  window.localStorage.clear();
  window.localStorage.setItem("foray:dev-user", "player-1");
  stubJsonFetch(() => ({
    status,
    body:
      status === 200
        ? { progress: payload }
        : { error: { code: "unauthorized", message: "authentication required" } },
  }));
});
afterEach(() => {
  setAuthTokenSource(null);
  vi.unstubAllGlobals();
});

describe("the days this browser is holding", () => {
  it("shows them when the service has none — the two pages must not contradict", async () => {
    seedLedger([back(2), back(1), back(0)]);
    const html = await markup();
    expect(html).toContain("In this browser");
    expect(html).toContain("3");
    expect(html).not.toContain("No practice days behind you yet");
  });

  it("says where those days live and what they are worth", async () => {
    seedLedger([back(0)]);
    const html = await markup();
    expect(html).toContain(LOCAL_PRACTICE_BASIS);
  });

  it("says plainly why the service has no record of them", async () => {
    seedLedger([back(0)]);
    const html = await markup();
    expect(html).toMatch(/signed out/i);
    expect(html).toMatch(/never reached the exam service|the service never saw/i);
  });

  it("keeps the empty copy when the browser is holding nothing", async () => {
    const html = await markup();
    expect(html).toContain("No practice days behind you yet");
    expect(html).not.toContain("In this browser");
  });

  it("shows both records when the account has days and the browser has days too", async () => {
    payload = report([{ day: back(1), sessions: 1, answered: 6, correct: 4 }]);
    seedLedger([back(0)]);
    const html = await markup();
    expect(html).toContain("day streak");
    expect(html).toContain("In this browser");
  });

  it("treats junk in the key as no days rather than failing the page", async () => {
    window.localStorage.setItem(LOCAL_PRACTICE_KEY, "{not json");
    const html = await markup();
    expect(html).toContain("No practice days behind you yet");
    expect(html).not.toContain("In this browser");
  });

  it("treats a well-formed ledger with no days as no days", async () => {
    seedLedger([]);
    const html = await markup();
    expect(html).toContain("No practice days behind you yet");
  });

  it("survives a browser whose storage throws on every read", async () => {
    const broken = {
      getItem: () => {
        throw new Error("storage disabled");
      },
      setItem: () => {},
      removeItem: () => {},
      clear: () => {},
      key: () => null,
      length: 0,
    };
    Object.defineProperty(window, "localStorage", { value: broken, configurable: true });
    try {
      // The page still renders. It cannot read a ledger and does not pretend
      // to have one — identity is read from the same storage, so this browser
      // gets the honest "service did not answer" page, never a crash.
      const html = await markup();
      expect(html).toContain("<main");
      expect(html).not.toContain("In this browser");
    } finally {
      installMemoryStorage();
      store.clear();
    }
  });

  it("does not claim a browser is empty when the service did not recognise it", async () => {
    status = 400;
    seedLedger([back(0)]);
    const html = await markup();
    expect(html).not.toContain("Nothing has been played in this browser");
    expect(html).toContain("In this browser");
  });

  it("still says the service is down rather than drawing a local streak as an account", async () => {
    stubFailingFetch();
    seedLedger([back(0)]);
    const html = await markup();
    expect(html).toContain("did not answer");
  });
});

describe("what the method line may claim", () => {
  it("never says practice answers are graded on the server, full stop", async () => {
    payload = report([{ day: back(1), sessions: 1, answered: 6, correct: 4 }]);
    const html = await markup();
    expect(html).not.toMatch(/graded on the server/);
    expect(PROGRESS_BASIS).not.toMatch(/graded on the server/);
  });

  it("names the two places a practice day can live", async () => {
    expect(PROGRESS_BASIS).toMatch(/signed in/i);
    expect(PROGRESS_BASIS).toMatch(/browser/i);
  });

  it("prints its own basis, so a stale service cannot re-assert server grading", async () => {
    payload = { ...report(), basis: "practice answers graded on the server" };
    const html = await markup();
    expect(html).not.toMatch(/graded on the server/);
    expect(html).toContain("No percentile, no composite");
  });
});
