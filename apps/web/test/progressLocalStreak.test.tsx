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
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import {
  LOCAL_PRACTICE_BASIS,
  LOCAL_PRACTICE_KEY,
  LOCAL_PRACTICE_PARTLY_CLAIMED,
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

/**
 * The part of the page that speaks for this browser alone. Asserted by
 * SLICE, not against the whole document: a bare `toContain("3")` over the
 * markup matches an id, a class or a server figure, so it passed before the
 * count it was meant to check existed.
 */
function sectionAfter(html: string, marker: string): string {
  const start = html.indexOf(marker);
  if (start === -1) return "";
  const end = html.indexOf("</section>", start);
  return html.slice(start, end === -1 ? undefined : end);
}

/** The service's own figures, at the top of the page. */
function serverSection(html: string): string {
  return sectionAfter(html, 'aria-labelledby="streak"');
}

function localSection(html: string): string {
  return sectionAfter(html, 'aria-labelledby="local-streak"');
}


/** The ledger the drill writes, in the shape it writes it. */
function seedLedger(days: readonly (string | { day: string; claimed: boolean })[]): void {
  window.localStorage.setItem(
    LOCAL_PRACTICE_KEY,
    serializeLocalLedger({
      days: days.map((entry) => {
        const { day, claimed } = typeof entry === "string" ? { day: entry, claimed: false } : entry;
        return { day, sessions: 1, answered: 6, correct: 4, claimed };
      }),
    }),
  );
}

const report = (days: PracticeDayCounts[] = []): ProgressReport =>
  progressReport({ days, sittings: [], today: TODAY, trackName: (t) => `Track ${t}` });

let status = 200;
let payload: ProgressReport;
/** What the SERVICE says it holds that came from a browser (`claimedDays`). */
let claimedOnAccount: string[] = [];

const markup = async (): Promise<string> => renderClient(createElement(ProgressView));

beforeEach(() => {
  status = 200;
  payload = report();
  claimedOnAccount = [];
  window.localStorage.clear();
  window.localStorage.setItem("foray:dev-user", "player-1");
  stubJsonFetch(() => ({
    status,
    body:
      status === 200
        ? { progress: payload, claimedDays: claimedOnAccount }
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
    expect(localSection(html)).toMatch(/>3<\/span>\s*<span class="label">days practised/);
    expect(html).not.toContain("No practice days behind you yet");
  });

  it("says where those days live and what they are worth", async () => {
    seedLedger([back(0)]);
    const html = await markup();
    expect(html).toContain(LOCAL_PRACTICE_BASIS);
  });

  it("says plainly that no figure on the page counts them", async () => {
    seedLedger([back(0)]);
    const html = await markup();
    expect(localSection(html)).toMatch(/No figure above counts these days/i);
    expect(localSection(html)).toMatch(/this browser is the only place they are held/i);
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

  it("does not show a claimed day here — the account already holds it", async () => {
    // The taster deals in the browser and claims the day the moment the
    // service can identify the visitor (`PracticeDrill.tsx`, `recordLocally`).
    // The day comes back in `progress.practice`. Repeating it under "on no
    // account" is the TEN-132 contradiction again, one size smaller.
    payload = report([{ day: back(0), sessions: 1, answered: 6, correct: 4 }]);
    claimedOnAccount = [back(0)];
    seedLedger([{ day: back(0), claimed: true }]);
    const html = await markup();
    expect(html).not.toContain("In this browser");
  });

  it("still draws the one claimed day, in the streak the service returned", async () => {
    // The practice TABLE is gated on three days (`MIN_TREND_DAYS`), so at one
    // day it draws nothing. "It is in the table above" is therefore not why
    // the day may be dropped from this block: the streak counters are, and
    // they are on the page at any count. A day drawn nowhere would be the
    // original bug with the sign reversed.
    payload = report([{ day: back(0), sessions: 1, answered: 6, correct: 4 }]);
    claimedOnAccount = [back(0)];
    seedLedger([{ day: back(0), claimed: true }]);
    const html = await markup();
    expect(serverSection(html)).toMatch(/>1<\/span>\s*<span class="label">days practised/);
    // Once, and only once: one "days practised" counter on the page means the
    // day is neither dropped nor drawn twice. The fixture supplies the server
    // half, so this is the assertion that pins the PAGE.
    expect(html.match(/days practised/g)).toHaveLength(1);
    expect(html).not.toContain("In this browser");
  });

  it("drops a day the SERVICE says it holds, even when this browser never heard so", async () => {
    // A claim whose response was lost leaves the day stored on the account
    // and unflagged here. The browser's own flag cannot see that; the
    // service's `claimedDays` can, so it is what the page subtracts.
    payload = report([{ day: back(0), sessions: 1, answered: 6, correct: 4 }]);
    claimedOnAccount = [back(0)];
    seedLedger([back(0)]);
    const html = await markup();
    expect(html).not.toContain("In this browser");
  });

  it("counts only the days no account has taken when the ledger holds both", async () => {
    payload = report([{ day: back(2), sessions: 1, answered: 6, correct: 4 }]);
    claimedOnAccount = [back(2)];
    seedLedger([{ day: back(2), claimed: true }, back(1), back(0)]);
    const html = await markup();
    expect(html).toContain("In this browser");
    expect(localSection(html)).toMatch(/>2<\/span>\s*<span class="label">days practised/);
  });

  it("prints no streak over a run with a hole in it, and says why", async () => {
    // Days 2 and 0 held, day 1 on the account: "best streak 1" would be a run
    // that never happened. Only the count survives a subsequence.
    payload = report([{ day: back(1), sessions: 1, answered: 6, correct: 4 }]);
    claimedOnAccount = [back(1)];
    seedLedger([back(2), { day: back(1), claimed: true }, back(0)]);
    const html = await markup();
    expect(localSection(html)).not.toContain("your best");
    expect(localSection(html)).not.toContain("day streak");
    expect(localSection(html)).toMatch(/what is left, not a streak/);
  });

  it("keeps the full counters when nothing was left out", async () => {
    seedLedger([back(1), back(0)]);
    const html = await markup();
    expect(localSection(html)).toContain("your best");
    expect(localSection(html)).not.toMatch(/what is left, not a streak/);
  });

  it("does not call a handed-over day browser-only when the service refused", async () => {
    // Nothing is subtracted on a refusal, which is right — but then the block
    // drew a CLAIMED day under "this browser is the only place they are held"
    // and `LOCAL_PRACTICE_BASIS` ("not on our servers. No account"). That is
    // the sentence this issue exists to remove, on the branch that skipped
    // the subtraction.
    status = 500;
    seedLedger([{ day: back(0), claimed: true }]);
    const html = await markup();
    expect(html).toContain("In this browser");
    expect(html).toContain(LOCAL_PRACTICE_PARTLY_CLAIMED);
    expect(html).not.toContain(LOCAL_PRACTICE_BASIS);
    expect(localSection(html)).not.toMatch(/the only place they are held/);
  });

  it("keeps the plain sentence when nothing in the ledger was ever handed over", async () => {
    status = 500;
    seedLedger([back(0)]);
    const html = await markup();
    expect(html).toContain(LOCAL_PRACTICE_BASIS);
    expect(html).not.toContain(LOCAL_PRACTICE_PARTLY_CLAIMED);
  });

  it("subtracts the days the figures above actually count, not the claim list", async () => {
    // The page's own header says the streak is recomputed from server-stamped
    // sessions. `progress.practice` IS that set, so it is what a day must be
    // absent from to be drawn here — no dependence on `claimedDays`, which
    // labels provenance and nothing else.
    payload = report([{ day: back(0), sessions: 1, answered: 6, correct: 4 }]);
    claimedOnAccount = [];
    seedLedger([back(0)]);
    const html = await markup();
    expect(html).not.toContain("In this browser");
  });

  it("shows every day it holds when the service REFUSED — a refusal is not a claim", async () => {
    // `missing` is any non-200. A 400 or a 500 says nothing about which days
    // an account holds, so subtracting the browser's claimed flag there hid
    // the whole ledger and headlined "Nothing has been played in this
    // browser" — false, and the exact sentence this issue is about.
    status = 400;
    seedLedger([{ day: back(0), claimed: true }]);
    const html = await markup();
    expect(html).toContain("In this browser");
    expect(html).not.toContain("Nothing has been played in this browser");
  });

  it("shows them after a 500 too, when nothing of the account is on the page", async () => {
    status = 500;
    seedLedger([{ day: back(1), claimed: true }, { day: back(0), claimed: true }]);
    const html = await markup();
    expect(localSection(html)).toMatch(/>2<\/span>\s*<span class="label">days practised/);
    // Nothing was subtracted, so nothing is a subsequence: the streak stands.
    expect(localSection(html)).toContain("your best");
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
    expect(PROGRESS_BASIS).toMatch(/exam service/i);
    expect(PROGRESS_BASIS).toMatch(/browser/i);
  });

  it("does not make signing in the rule when the code asks a wider question", async () => {
    // The drill records a round for ANY identity the service accepts, which
    // on a dev-auth deployment is nobody's account. Copy that says "while
    // signed in" describes a rule this code does not apply.
    const webDir = join(dirname(fileURLToPath(import.meta.url)), "..");
    const drill = readFileSync(join(webDir, "features", "practice", "PracticeDrill.tsx"), "utf8");
    expect(drill).toMatch(/const recorded =[^;]*hasIdentity\(identity\.status\)/);
    expect(PROGRESS_BASIS).not.toMatch(/signed in/i);
  });

  it("prints its own basis, so a stale service cannot re-assert server grading", async () => {
    // `basis` is no longer a field of `ProgressReport`; a service still
    // sending one must change nothing here, so it is sent as the extra
    // property a stale deployment would put on the wire.
    payload = { ...report(), basis: "practice answers graded on the server" } as ProgressReport;
    const html = await markup();
    expect(html).not.toMatch(/graded on the server/);
    expect(html).toContain("No percentile, no composite");
  });
});
