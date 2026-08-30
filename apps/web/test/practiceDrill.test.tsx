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
import { FAMILY_META, PRACTICE_BANK, PRACTICE_DECK_SIZE } from "@ailx/report";

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

function installFetch(): void {
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    const body = init?.body === undefined ? undefined : JSON.parse(String(init.body));
    posted.push({ url: String(url), body });
    if (String(url).endsWith("/api/practice")) {
      return new Response(JSON.stringify({ session: { id: SESSION_ID, itemIds: dealt } }), { status: 201 });
    }
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

async function mount(serverMode: boolean): Promise<void> {
  vi.resetModules();
  process.env.NEXT_PUBLIC_AILX_BACKEND = serverMode ? "1" : "";
  const { PracticeDrill } = await import("../lib/PracticeDrill");
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(createElement(PracticeDrill));
  });
}

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

/** Play the whole deck, always calling "AI-generated". */
async function playThrough(): Promise<void> {
  for (let i = 0; i < PRACTICE_DECK_SIZE; i++) {
    await click(/AI-generated/);
    await click(/Next card|Finish the round/);
  }
}

beforeEach(() => {
  posted.length = 0;
  store.clear();
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

  it("says plainly that nothing was recorded and shows no streak", async () => {
    await mount(false);
    await playThrough();
    expect(posted).toEqual([]);
    expect(host.textContent).toMatch(/static demo build/i);
    expect(host.textContent).toMatch(/nothing was recorded/i);
    expect(host.textContent).not.toContain("day streak");
  });
});

describe("it can never show a scored item", () => {
  it("imports the practice corpus and no instrument content", () => {
    const source = readFileSync(repoFile("lib/PracticeDrill.tsx"), "utf8");
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
    for (const file of ["lib/PracticeDrill.module.css", "app/progress/progress.module.css"]) {
      const css = readFileSync(repoFile(file), "utf8");
      expect(css.match(/#[0-9a-fA-F]{3,8}\b/g), file).toBeNull();
      expect(css, file).not.toMatch(/rgb\(|hsl\(/);
    }
  });

  it("gives every interactive control a visible focus indicator (WCAG 2.4.13)", () => {
    const css = readFileSync(repoFile("lib/PracticeDrill.module.css"), "utf8");
    expect(css).toMatch(/:focus-visible/);
    expect(css).toMatch(/outline: 2px/);
  });

  it("gates every animation on prefers-reduced-motion", () => {
    const css = readFileSync(repoFile("lib/PracticeDrill.module.css"), "utf8");
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
    const css = readFileSync(repoFile("lib/PracticeDrill.module.css"), "utf8");
    expect(css).toMatch(/\.image\s*\{[^}]*height: min\(/);
    expect(css).toMatch(/\.image\s*\{[^}]*object-fit: contain/);
    // ...and a shorter one on a phone, where the wrapped primary nav already
    // costs ~130px of an 844px viewport.
    const narrow = css.slice(css.indexOf("@media (max-width: 640px)"));
    expect(narrow).toMatch(/\.image \{ height: min\(38vh, 20rem\); \}/);
  });
});
