// @vitest-environment jsdom
/**
 * The practice drill component.
 *
 * What is asserted here is what only a rendered drill can show:
 *  - it deals and displays PRACTICE material and never a scored bank item;
 *  - a call produces immediate right/wrong feedback with the teaching;
 *  - it asserts NOTHING to the server — it posts choices, never a grade, an
 *    elapsed time or a streak, and it renders the streak the server returns;
 *  - in the static export it plays and says plainly that nothing is recorded.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  CLAIM_PROMISE,
  FAMILY_META,
  LOCAL_PRACTICE_KEY,
  PRACTICE_BANK,
  PRACTICE_DECK_SIZE,
  PRACTICE_MIN_ELAPSED_MS,
  SIGN_IN_VALUE_SHORT,
  localDay,
  parseLocalLedger,
} from "@ailx/report";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

/** Vite rewrites a literal `new URL(..., import.meta.url)`; resolve by path. */
const WEB_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const repoFile = (rel: string): string => join(WEB_ROOT, rel);

const store = new Map<string, string>();
Object.defineProperty(window, "localStorage", {
  value: {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => void store.clear(),
  },
  configurable: true,
});

const SESSION_ID = "11111111-2222-3333-4444-555555555555";
const posted: Array<{ url: string; body: unknown }> = [];
let dealt: string[] = [];
let streak = { current: 3, best: 7, totalDays: 12, lastDay: "2026-03-10", practisedToday: true, restDayAvailable: false };
let qualification = { counted: true, reason: "ok" };

/** Set to make the SUBMIT (never the deal) fail the way an offline tab does. */
let submitOffline = false;

function installFetch(): void {
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    const body = init?.body === undefined ? undefined : JSON.parse(String(init.body));
    posted.push({ url: String(url), body });
    if (String(url).endsWith("/api/practice")) {
      return new Response(JSON.stringify({ session: { id: SESSION_ID, itemIds: dealt } }), { status: 201 });
    }
    if (String(url).endsWith("/api/practice/claim")) {
      const days = (body as { days?: Array<{ day: string }> } | undefined)?.days ?? [];
      return new Response(JSON.stringify({ claimed: days.map((d) => d.day) }), { status: 200 });
    }
    // Exactly what a browser with no network throws: a TypeError whose
    // message is the string "Failed to fetch".
    if (submitOffline) throw new TypeError("Failed to fetch");
    return new Response(
      JSON.stringify({
        result: { answered: dealt.length, correct: dealt.length, qualification },
        progress: { streak },
      }),
      { status: 200 },
    );
  });
}

let root: Root | null = null;
let host: HTMLElement;

async function mount(serverMode: boolean, clerk = false, props: { taster?: boolean } = {}): Promise<void> {
  vi.resetModules();
  process.env.NEXT_PUBLIC_AILX_BACKEND = serverMode ? "1" : "";
  // Clerk is mounted iff a publishable key is present (lib/mode.ts). Without
  // one, a hosted build runs on the asserted dev id — which IS an identity
  // the API accepts, so the drill records against it exactly as before.
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = clerk ? "pk_test_stub" : "";
  const { PracticeDrill } = await import("../features/practice/PracticeDrill");
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(createElement(PracticeDrill, props));
  });
}

/** A hosted build with Clerk mounted and its session not yet resolved. */
async function mountWithClerk(): Promise<void> {
  await mount(true, true);
}

/**
 * Publish what the Clerk bridge would publish. The bridge is the only module
 * that talks to the SDK; everything downstream reads this state, so a test
 * needs no provider and no network to put the app in either identity.
 */
async function publish(status: "anonymous" | "signed-in", userId: string | null): Promise<void> {
  const { publishIdentity } = await import("../lib/auth/identityState");
  await act(async () => {
    publishIdentity({ status, userId });
  });
}

const signedOut = () => publish("anonymous", null);
const signedIn = (userId: string) => publish("signed-in", userId);

function buttons(): HTMLButtonElement[] {
  return [...host.querySelectorAll("button")];
}

async function click(match: RegExp): Promise<void> {
  const btn = buttons().find((b) => match.test(b.textContent ?? ""));
  expect(btn, `button ${match}`).toBeTruthy();
  await act(async () => {
    btn!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

/**
 * Break the current card's picture the way the network does. `"error"` is a
 * request that never arrived; `"load"` is jsdom's zero-pixel image, which is
 * what a truncated or empty response looks like to `naturalWidth`.
 */
async function breakStimulus(kind: "error" | "load" = "error"): Promise<void> {
  const img = host.querySelector("img");
  expect(img, "an image to break").toBeTruthy();
  await act(async () => {
    img!.dispatchEvent(new Event(kind));
  });
}

/** Play the whole deck, always calling "AI-generated". */
async function playThrough(): Promise<void> {
  for (let i = 0; i < PRACTICE_DECK_SIZE; i++) {
    await click(/AI-generated/);
    await click(/Next card|Finish the round/);
  }
}

/**
 * The same round, played slowly enough to have been read.
 *
 * A local day is earned under the SAME rule the server applies — the whole
 * deck, and `PRACTICE_MIN_ELAPSED_MS` on the clock — so a test that wants a
 * day has to spend the time, and `playThrough` on its own proves the floor
 * still bites.
 */
async function playSlowly(): Promise<void> {
  advance(PRACTICE_MIN_ELAPSED_MS + 1_000);
  await playThrough();
}

/**
 * The clock is ours, because a streak day is a clock decision. `Date.now` is
 * the only thing stubbed: `new Date()` still works, so the client timestamps
 * the drill stamps on an answer stay real ISO strings.
 */
const NOW = Date.parse("2026-03-11T12:00:00.000Z");
let clock = NOW;
// biome-ignore lint/suspicious/noAssignInExpressions: advancing the test clock IS the expression; a block body says nothing extra.
const advance = (ms: number) => void (clock += ms);
const daysAgo = (n: number) => localDay(clock - n * 86_400_000, -new Date().getTimezoneOffset());

beforeEach(() => {
  posted.length = 0;
  store.clear();
  clock = NOW;
  vi.spyOn(Date, "now").mockImplementation(() => clock);
  submitOffline = false;
  dealt = PRACTICE_BANK.slice(0, PRACTICE_DECK_SIZE).map((i) => i.id);
  qualification = { counted: true, reason: "ok" };
  streak = { current: 3, best: 7, totalDays: 12, lastDay: "2026-03-10", practisedToday: true, restDayAvailable: false };
  // jsdom has no crypto.randomUUID in this combo; the static path needs one.
  if (typeof crypto.randomUUID !== "function") {
    Object.defineProperty(crypto, "randomUUID", { value: () => SESSION_ID, configurable: true });
  }
  installFetch();
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("hosted build", () => {
  it("shows the deck the SERVER dealt, in order, one card at a time", async () => {
    await mount(true);
    expect(posted[0].url).toMatch(/\/api\/practice$/);
    const first = PRACTICE_BANK.find((i) => i.id === dealt[0])!;
    const shown = host.querySelectorAll("img");
    expect(shown).toHaveLength(1);
    expect(shown[0].getAttribute("src")).toContain(first.material.src);
    // Alt text is the screen-reader's copy of the card, so it must be there.
    expect(shown[0].getAttribute("alt")).toBe(first.material.alt);
    // Attribution is NOT on the unanswered card: a Commons author is often
    // called "midjourney", and a generated item's credit names the model, so
    // a caption before the call would hand over the answer.
    expect(host.textContent).not.toContain(first.credit.author);
    // The next card is not on screen yet — exposure is one card at a time.
    const second = PRACTICE_BANK.find((i) => i.id === dealt[1])!;
    expect(shown[0].getAttribute("src")).not.toContain(second.material.src);
    // And the family is NOT named before the call, or it would prime it.
    expect(host.textContent).not.toContain(FAMILY_META[first.family].name);
  });

  it("credits the image only AFTER the call, and never leaks the model", async () => {
    // The credit is a licence condition and an answer key at the same time.
    // It arrives with the teaching, and the prompt never arrives at all.
    await mount(true);
    const first = PRACTICE_BANK.find((i) => i.id === dealt[0])!;
    expect(host.textContent).not.toContain(first.credit.author);
    if (first.credit.model) expect(host.textContent).not.toContain(first.credit.model);
    await click(/AI-generated/);
    expect(host.textContent).toContain(first.credit.author);
    expect(host.textContent).toContain(first.credit.license);
    if (first.credit.model) expect(host.textContent).toContain(first.credit.model);
    if (first.credit.prompt) expect(host.textContent).not.toContain(first.credit.prompt);
  });

  it("gives immediate right/wrong feedback with the teaching", async () => {
    await mount(true);
    const first = PRACTICE_BANK.find((i) => i.id === dealt[0])!;
    await click(first.key === 0 ? /AI-generated/ : /Real photograph/);
    expect(host.textContent).toContain("Right.");
    expect(host.textContent).toContain(first.tell);
    // The family arrives WITH the teaching, not before the call.
    expect(host.textContent).toContain(FAMILY_META[first.family].name.toUpperCase());
    expect(host.querySelector('[role="status"]')).toBeTruthy();
  });

  it("writes the answer as a sentence, not as a lower-cased button label", async () => {
    await mount(true);
    const first = PRACTICE_BANK.find((i) => i.id === dealt[0])!;
    await click(/AI-generated/);
    // The old copy did `PRACTICE_OPTIONS[key].toLowerCase()`, which rendered
    // "It was ai-generated." mid-sentence.
    expect(host.textContent).not.toContain("ai-generated");
    expect(host.textContent).toContain(
      first.key === 0 ? "It was an AI-generated image." : "It was a real photograph.",
    );
  });

  it("keeps a visible running count of the round, and colours the pips by outcome", async () => {
    await mount(true);
    // An `aria-label` on a <p> is not reliably exposed, so the position is
    // visible text.
    expect(host.textContent).toContain(`Card 1 of ${PRACTICE_DECK_SIZE}`);
    expect(host.textContent).not.toContain("right so far");
    const first = PRACTICE_BANK.find((i) => i.id === dealt[0])!;
    await click(first.key === 0 ? /AI-generated/ : /Real photograph/);
    expect(host.textContent).toContain(`Card 1 of ${PRACTICE_DECK_SIZE}`);
    expect(host.textContent).toContain("1 right so far");
    // The strip is decoration: the same two facts are in the text beside it.
    const strip = host.querySelector('[class*="pips"]')!;
    expect(strip.getAttribute("aria-hidden")).toBe("true");
    expect(strip.children).toHaveLength(PRACTICE_DECK_SIZE);
    expect(strip.children[0].className).toMatch(/pipRight/);
    await click(/Next card/);
    expect(host.textContent).toContain(`Card 2 of ${PRACTICE_DECK_SIZE}`);
  });

  it("marks a missed card red rather than done", async () => {
    await mount(true);
    const first = PRACTICE_BANK.find((i) => i.id === dealt[0])!;
    await click(first.key === 0 ? /Real photograph/ : /AI-generated/);
    const strip = host.querySelector('[class*="pips"]')!;
    expect(strip.children[0].className).toMatch(/pipWrong/);
    expect(host.textContent).toContain("0 right so far");
  });

  it("ends the round with its shape and a way onwards", async () => {
    await mount(true);
    await playThrough();
    expect(host.textContent).toMatch(/\d+ right, \d+ missed/);
    const strip = host.querySelector('[class*="pips"]')!;
    expect(strip.children).toHaveLength(PRACTICE_DECK_SIZE);
    // The end of a round is where somebody wants the trend.
    expect(host.querySelector('a[href="/progress"]')).toBeTruthy();
  });

  it("names a miss as a miss and still teaches the tell", async () => {
    await mount(true);
    const first = PRACTICE_BANK.find((i) => i.id === dealt[0])!;
    await click(first.key === 0 ? /Real photograph/ : /AI-generated/);
    expect(host.textContent).toContain("Missed it.");
    expect(host.textContent).toContain(first.tell);
  });

  it("submits choices and a UTC offset — never a grade, a streak or an elapsed time", async () => {
    await mount(true);
    await playThrough();
    const submit = posted[posted.length - 1];
    expect(submit.url).toContain(`/api/practice/${SESSION_ID}`);
    const body = submit.body as { answers: Array<Record<string, unknown>>; tzOffsetMinutes: number };
    expect(body.answers).toHaveLength(PRACTICE_DECK_SIZE);
    expect(typeof body.tzOffsetMinutes).toBe("number");
    const sent = JSON.stringify(body);
    expect(sent).not.toMatch(/"correct"|"streak"|"elapsed"|"counted"|"score"/);
    for (const a of body.answers) {
      expect(Object.keys(a).sort()).toEqual(["choice", "clientTs", "itemId", "latencyMs", "seq"]);
    }
  });

  it("renders the streak the SERVER returned, not one it worked out", async () => {
    await mount(true);
    await playThrough();
    expect(host.textContent).toContain("day streak");
    expect(host.textContent).toContain("7"); // best
    expect(host.textContent).toContain("12"); // days practised
  });

  it("explains kindly when a round did not earn its day", async () => {
    qualification = { counted: false, reason: "too_fast" };
    await mount(true);
    await playThrough();
    expect(host.textContent).toMatch(/too fast to count/i);
    expect(host.textContent).not.toMatch(/cheat|banned|violation/i);
  });

  it("surfaces a failed start as a retryable alert rather than a blank screen", async () => {
    vi.stubGlobal("fetch", async () => new Response("nope", { status: 500 }));
    await mount(true);
    expect(host.querySelector('[role="alert"]')).toBeTruthy();
    expect(buttons().some((b) => /Try again/.test(b.textContent ?? ""))).toBe(true);
  });
});


/**
 * Offline behaviour. Two things must never happen when the network drops:
 * a card whose picture never arrived must not be graded (that would record a
 * network failure as a miss against the candidate), and a failed submit must
 * not show the browser's own exception text or take the round away.
 */
describe("when the network fails under it", () => {
  const calls = /AI-generated|Real photograph/;

  it("does not offer a call on a card whose picture never loaded", async () => {
    await mount(true);
    await breakStimulus();
    expect(buttons().some((b) => calls.test(b.textContent ?? ""))).toBe(false);
    expect(host.textContent).toMatch(/did not load/i);
    expect(host.textContent).toMatch(/not been counted/i);
    // The half-drawn <img> is gone; the plate keeps its space.
    expect(host.querySelector("img")).toBeNull();
    expect(host.querySelector('[class*="plateEmpty"]')).toBeTruthy();
    expect(host.querySelector('[role="status"]')).toBeTruthy();
    expect(buttons().some((b) => /Try loading it again/.test(b.textContent ?? ""))).toBe(true);
    expect(buttons().some((b) => /Skip this card/.test(b.textContent ?? ""))).toBe(true);
  });

  it("treats a picture that loaded with no pixels as one that did not load", async () => {
    // A truncated or empty response fires `load` with naturalWidth 0 — it
    // paints a blank grey box, which is not a stimulus.
    await mount(true);
    await breakStimulus("load");
    expect(buttons().some((b) => calls.test(b.textContent ?? ""))).toBe(false);
    expect(host.textContent).toMatch(/did not load/i);
  });

  it("asks for the picture again, and restores the calls, on retry", async () => {
    await mount(true);
    await breakStimulus();
    await click(/Try loading it again/);
    const img = host.querySelector("img");
    expect(img).toBeTruthy();
    const first = PRACTICE_BANK.find((i) => i.id === dealt[0])!;
    expect(img!.getAttribute("src")).toContain(first.material.src);
    expect(buttons().some((b) => calls.test(b.textContent ?? ""))).toBe(true);
  });

  it("keeps a skipped card out of the tally, the pips and the submit", async () => {
    await mount(true);
    const skipped = PRACTICE_BANK.find((i) => i.id === dealt[0])!;
    await breakStimulus();
    await click(/Skip this card/);
    expect(host.textContent).toContain(`Card 2 of ${PRACTICE_DECK_SIZE}`);
    const strip = host.querySelector('[class*="pips"]')!;
    expect(strip.children[0].className).toMatch(/pipDropped/);
    expect(strip.children[0].className).not.toMatch(/pipWrong/);
    // Play the rest of the deck, always calling "AI-generated".
    const rest = dealt.slice(1).map((id) => PRACTICE_BANK.find((i) => i.id === id)!);
    for (let i = 0; i < rest.length; i++) {
      await click(/AI-generated/);
      await click(/Next card|Finish the round/);
    }
    const right = rest.filter((i) => i.key === 0).length;
    expect(host.textContent).toContain(`${right} of ${rest.length}`);
    expect(host.textContent).toContain(`${right} right, ${rest.length - right} missed`);
    expect(host.textContent).toMatch(/One card never loaded/);
    const body = posted[posted.length - 1].body as { answers: Array<{ seq: number; itemId: string }> };
    expect(body.answers).toHaveLength(rest.length);
    expect(body.answers.map((a) => a.itemId)).not.toContain(skipped.id);
    expect(body.answers.map((a) => a.seq)).toEqual(rest.map((_, i) => i));
  });

  it("does not drop focus on <body> when the skipped card is unmounted", async () => {
    await mount(true);
    await breakStimulus();
    await click(/Skip this card/);
    expect(document.activeElement?.tagName).toBe("BUTTON");
    expect(host.contains(document.activeElement)).toBe(true);
  });

  it("explains a failed send in human words and keeps the round on screen", async () => {
    submitOffline = true;
    await mount(true);
    await playThrough();
    // Never the exception: offline, `err.message` is literally this.
    expect(host.textContent).not.toContain("Failed to fetch");
    const alert = host.querySelector('[role="alert"]')!;
    expect(alert).toBeTruthy();
    expect(alert.textContent).toMatch(/was not sent/i);
    expect(alert.textContent).toMatch(/not recorded yet/i);
    // The round itself survives the failure.
    expect(host.textContent).toMatch(/\d+ right, \d+ missed/);
    expect(host.querySelector('[class*="pips"]')!.children).toHaveLength(PRACTICE_DECK_SIZE);
    expect(buttons().some((b) => /Try sending it again/.test(b.textContent ?? ""))).toBe(true);
  });

  it("re-sends the same round when the retry is pressed", async () => {
    submitOffline = true;
    await mount(true);
    await playThrough();
    expect(host.textContent).not.toContain("day streak");
    submitOffline = false;
    await click(/Try sending it again/);
    const submits = posted.filter((p) => p.url.includes(`/api/practice/${SESSION_ID}`));
    expect(submits).toHaveLength(2);
    expect(submits[1].body).toEqual(submits[0].body);
    expect(host.textContent).toContain("day streak");
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });

  it("keeps the streak panel a failed send would otherwise have wiped out", async () => {
    await mount(true);
    await playThrough();
    expect(host.textContent).toContain("day streak");
    await click(/Another round/);
    submitOffline = true;
    await playThrough();
    expect(host.textContent).toContain("day streak");
    expect(host.textContent).toContain("7"); // best, still from the server
    expect(host.textContent).toMatch(/last recorded round/i);
  });

  it("never shows a raw exception when the deal itself fails", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("Failed to fetch");
    });
    await mount(true);
    expect(host.textContent).not.toContain("Failed to fetch");
    expect(host.querySelector('[role="alert"]')!.textContent).toMatch(/could not deal a round/i);
    expect(buttons().some((b) => /Try again/.test(b.textContent ?? ""))).toBe(true);
  });
});

describe("static export build", () => {
  it("plays with no server at all and calls nothing", async () => {
    await mount(false);
    expect(posted).toEqual([]);
    expect(host.textContent).toMatch(/Is this a photograph, or an AI-generated image\?/);
  });

  it("offers no /progress link, because the static export has no such page", async () => {
    await mount(false);
    await playThrough();
    expect(host.querySelector('a[href="/progress"]')).toBeNull();
  });

  it("keeps the round in this browser, and says where it went", async () => {
    await mount(false);
    await playSlowly();
    expect(posted).toEqual([]);
    expect(host.textContent).toMatch(/kept in this browser/i);
    expect(host.textContent).toMatch(/clearing your site data/i);
    expect(host.textContent).toContain("day streak");
    expect(store.get(LOCAL_PRACTICE_KEY)).toBeTruthy();
  });

  it("offers no sign-in, because the static export has no sign-in page", async () => {
    await mount(false);
    await playSlowly();
    expect(host.querySelector('a[href="/sign-in"]')).toBeNull();
  });

  it("counts one day per browser calendar day, however many rounds are played", async () => {
    await mount(false);
    await playSlowly();
    await click(/Another round/);
    await playSlowly();
    const ledger = parseLocalLedger(store.get(LOCAL_PRACTICE_KEY) ?? null);
    expect(ledger.days).toHaveLength(1);
    expect(ledger.days[0]!.sessions).toBe(2);
    expect(host.textContent).toContain("1day streak");
  });

  it("adds today to the streak a returning visitor already had", async () => {
    store.set(
      LOCAL_PRACTICE_KEY,
      JSON.stringify({
        days: [
          { day: daysAgo(2), sessions: 1, answered: 6, correct: 4 },
          { day: daysAgo(1), sessions: 1, answered: 6, correct: 5 },
        ],
      }),
    );
    await mount(false);
    await playSlowly();
    // Two days were already in this browser; today makes three, and the
    // ledger it came out of was written by nobody but this browser.
    expect(host.textContent).toContain("3day streak");
  });

  it("does not buy a day for a round that went too fast to have been read", async () => {
    await mount(false);
    await playThrough();
    expect(host.textContent).toMatch(/too fast to count/i);
    expect(parseLocalLedger(store.get(LOCAL_PRACTICE_KEY) ?? null).days).toEqual([]);
  });

  it("plays for a browser that stores nothing at all", async () => {
    const broken = { ...window.localStorage };
    Object.defineProperty(window, "localStorage", {
      value: {
        getItem: () => { throw new Error("denied"); },
        setItem: () => { throw new Error("denied"); },
        removeItem: () => { throw new Error("denied"); },
      },
      configurable: true,
    });
    try {
      await mount(false);
      await playSlowly();
      // The round still finished and still said what it was: only the memory
      // of it is gone, and nothing on screen is broken.
      expect(host.textContent).toMatch(/\d+ right, \d+ missed/);
      expect(host.textContent).toContain("0day streak");
    } finally {
      Object.defineProperty(window, "localStorage", { value: broken, configurable: true });
    }
  });
});

/**
 * The on-ramp proper: a hosted build with Clerk mounted, and nobody signed in.
 *
 * This is the case the whole feature exists for, and the one that did not work
 * before it: the API refuses an anonymous caller, so a drill that could only
 * play through the server could not play at all.
 */
describe("hosted build, nobody signed in", () => {
  it("deals nothing until Clerk has answered", async () => {
    await mountWithClerk();
    expect(posted).toEqual([]);
    expect(host.textContent).toMatch(/dealing a round/i);
  });

  it("plays locally once Clerk says nobody is signed in, and calls no API", async () => {
    await mountWithClerk();
    await signedOut();
    expect(host.textContent).toMatch(/Is this a photograph, or an AI-generated image\?/);
    await playSlowly();
    expect(posted).toEqual([]);
    expect(host.textContent).toContain("1day streak");
  });

  it("asks for an account only after the round, and only for what it is for", async () => {
    await mountWithClerk();
    await signedOut();
    // Not during the round: the ask is never in front of the game.
    expect(host.querySelector('a[href="/sign-in"]')).toBeNull();
    await playSlowly();
    const ask = host.textContent ?? "";
    expect(host.querySelector('a[href="/sign-in"]')).toBeTruthy();
    expect(ask).toContain(SIGN_IN_VALUE_SHORT);
    expect(ask).toContain(CLAIM_PROMISE);
  });

  it("threatens nobody with what they would lose", async () => {
    await mountWithClerk();
    await signedOut();
    await playSlowly();
    const copy = host.textContent ?? "";
    for (const tell of [/lose your/i, /before it/i, /last chance/i, /hurry/i, /expires/i]) {
      expect(copy).not.toMatch(tell);
    }
  });

  it("deals from the server once somebody signs in", async () => {
    await mountWithClerk();
    await signedIn("user_abc");
    expect(posted.map((p) => p.url)).toContain("/api/practice");
  });

  it("finishes a round the way it started when a sign-in lands mid-round", async () => {
    await mountWithClerk();
    await signedOut();
    await click(/AI-generated/);
    await click(/Next card/);
    // Another tab signs in. The round on screen is browser-dealt, so its
    // session id means nothing to the server: it must not be posted, and the
    // cards already called must not be taken away.
    await signedIn("user_abc");
    expect(host.textContent).toMatch(/Card 2 of/);
    for (let i = 1; i < PRACTICE_DECK_SIZE; i++) {
      advance(4_000);
      await click(/AI-generated/);
      await click(/Next card|Finish the round/);
    }
    // Not submitted as a session — a browser-dealt round has no server
    // session id. The day itself is not stranded either: it is CLAIMED onto
    // the account that just arrived, which is the same path the taster uses
    // (TEN-156) and the same one a sign-in has always used, only sooner.
    const sessionPosts = posted.filter(
      (p) => p.url.includes("/api/practice/") && !p.url.endsWith("/claim"),
    );
    expect(sessionPosts).toEqual([]);
    expect(posted.map((p) => p.url)).toContain("/api/practice/claim");
    expect(host.textContent).toContain("1day streak");
  });
});

describe("the landing taster (TEN-156)", () => {
  /**
   * The bug: the drill mounts in the landing hero, so a SIGNED-IN visitor who
   * loaded the home page and scrolled past opened a `practice_sessions` row
   * and spent a recorded deal on nothing. Three rows for one round played.
   */
  it("records NOTHING for a signed-in visitor who touches nothing", async () => {
    await mount(true, false, { taster: true });
    // The hero still shows a real card — the feature is "one card, right now".
    expect(host.querySelectorAll("img")).toHaveLength(1);
    // ...and the service has not been told anything at all.
    expect(posted).toEqual([]);
  });

  it("records nothing for a signed-in visitor on a Clerk build either", async () => {
    await mount(true, true, { taster: true });
    await signedIn("user_abc");
    expect(posted).toEqual([]);
    expect(host.querySelectorAll("img")).toHaveLength(1);
  });

  it("deals the taster in the browser, so its round is never posted", async () => {
    await mount(true, false, { taster: true });
    await playSlowly();
    // No deal and no submit: the round was browser-dealt, and the service
    // grades only decks it dealt.
    expect(posted.map((p) => p.url)).not.toContain("/api/practice");
    expect(posted.filter((p) => /\/api\/practice\/[^/]+$/.test(p.url) && !p.url.endsWith("/claim"))).toEqual([]);
    // The day is in this browser's ledger, and the copy says where it is.
    expect(host.textContent).toContain("1day streak");
  });

  it("hands the taster day to the account it was played on", async () => {
    // The taster is dealt here, so the claim is how the day reaches the
    // account at all — it must not wait for the next sign-in.
    await mount(true, false, { taster: true });
    await playSlowly();
    const claim = posted.find((p) => p.url.endsWith("/api/practice/claim"));
    expect(claim, "a claim POST").toBeTruthy();
    expect((claim!.body as { days: Array<{ answered: number }> }).days[0].answered).toBe(PRACTICE_DECK_SIZE);
  });

  it("claims nothing for a visitor with no identity to claim onto", async () => {
    await mount(true, true, { taster: true });
    await signedOut();
    await playSlowly();
    expect(posted.map((p) => p.url)).toEqual([]);
  });

  it("deals a RECORDED round once the visitor has actually played one", async () => {
    // First answer is the engagement. The round in hand finishes where it
    // started; the next one is server-dealt and recorded.
    await mount(true, false, { taster: true });
    await playSlowly();
    expect(posted.map((p) => p.url)).not.toContain("/api/practice");
    await click(/Another round/);
    expect(posted.map((p) => p.url)).toContain("/api/practice");
  });

  it("leaves /practice alone: that page IS the engagement", async () => {
    await mount(true);
    expect(posted[0].url).toMatch(/\/api\/practice$/);
  });

  it("is how the landing page mounts the drill", () => {
    // The prop is the whole fix, and it lives on one line of one page.
    const page = readFileSync(repoFile("app/page.tsx"), "utf8");
    expect(page).toMatch(/<PracticeDrill taster \/>/);
  });
});

describe("it can never show a scored item", () => {
  it("imports the practice corpus and no instrument content", () => {
    const source = readFileSync(repoFile("features/practice/PracticeDrill.tsx"), "utf8");
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(code).not.toMatch(/instruments|bank\.jsonl|demoItems|t2DeckRecords|lib\/instrument/);
  });

  it("renders nothing for an id the practice corpus does not know", async () => {
    dealt = ["not-a-practice-item", ...PRACTICE_BANK.slice(0, 2).map((i) => i.id)];
    await mount(true);
    expect(host.textContent).not.toContain("not-a-practice-item");
    // The unknown id is dropped; the round is simply shorter. (Count the
    // pips inside the strip, not everything whose class contains "pip" —
    // the strip's own wrapper is `pips`.)
    expect(host.querySelector('[class*="pips"]')!.children.length).toBe(2);
  });
});

describe("styling stays on the token palette", () => {
  it("hard-codes no colour, so the measured AA contrast still holds", () => {
    for (const file of ["components/PracticeDrill.module.css", "features/progress/progress.module.css"]) {
      const css = readFileSync(repoFile(file), "utf8");
      expect(css.match(/#[0-9a-fA-F]{3,8}\b/g), file).toBeNull();
      expect(css, file).not.toMatch(/rgb\(|hsl\(/);
    }
  });

  it("gives every interactive control a visible focus indicator (WCAG 2.4.13)", () => {
    const css = readFileSync(repoFile("components/PracticeDrill.module.css"), "utf8");
    expect(css).toMatch(/:focus-visible/);
    expect(css).toMatch(/outline: 2px/);
  });

  it("gates every animation on prefers-reduced-motion", () => {
    const css = readFileSync(repoFile("components/PracticeDrill.module.css"), "utf8");
    const declared = [...css.matchAll(/@keyframes\s+([\w-]+)/g)].map((m) => m[1]);
    expect(declared.length).toBeGreaterThan(0);
    const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(reduced).toMatch(/animation: none/);
    expect(reduced).toMatch(/transition: none/);
  });

  it("pins the plate to a fixed height so the call buttons never move", () => {
    // Portrait and landscape cards alternate; with `height: auto` the two
    // calls jumped by ~200px between cards and started below the fold on a
    // phone.
    const css = readFileSync(repoFile("components/PracticeDrill.module.css"), "utf8");
    expect(css).toMatch(/\.image\s*\{[^}]*height: min\(/);
    expect(css).toMatch(/\.image\s*\{[^}]*object-fit: contain/);
    // ...and a shorter one on a phone, where the wrapped primary nav already
    // costs ~130px of an 844px viewport.
    const narrow = css.slice(css.indexOf("@media (max-width: 640px)"));
    expect(narrow).toMatch(/\.image \{ height: min\(38vh, 20rem\); \}/);
  });
});
