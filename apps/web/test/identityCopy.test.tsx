// @vitest-environment jsdom
/**
 * TWO COPY LINES THAT TOLD A SIGNED-IN CANDIDATE THEY HAVE NO ACCOUNT (TEN-151).
 *
 * Both surfaces are identity-aware pages that read no identity: /exam's
 * access pill said "sign in to sit a scored run" to a candidate who had just
 * signed in, and the daily result screen said "There is no account to lose it
 * to" on a deployment that has accounts. The seam is `lib/auth/identityState`,
 * which is already what every other identity-aware view reads.
 *
 * Rendered, not string-compared: the branch that matters is the one a reader
 * meets, and `lib/mode.ts` alone cannot show which line reached the screen.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { withQueryClient } from "./helpers/clientPage";
import { dailyDeck, dailyNumber } from "@ailx/report";
import { DailyChallenge } from "../features/daily/DailyChallenge";
import { DAILY_POOL } from "../lib/instrument/demoItems";
import { publishIdentity, resetIdentity, type Identity } from "../lib/auth/identityState";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const store = new Map<string, string>();
Object.defineProperty(window, "localStorage", {
  value: {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  },
  configurable: true,
});
Object.defineProperty(window, "sessionStorage", {
  value: {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  },
  configurable: true,
});

const NOW = Date.parse("2026-03-17T14:00:00.000Z");
const DAY = "2026-03-17";

const SIGNED_IN: Identity = { status: "signed-in", userId: "user_1" };
const ANONYMOUS: Identity = { status: "anonymous", userId: null };

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  store.clear();
  resetIdentity();
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 404 })));
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.spyOn(Date.prototype, "getTimezoneOffset").mockReturnValue(0);
  // A deployment that HAS accounts is the only one where either line can lie.
  vi.stubEnv("NEXT_PUBLIC_AILX_BACKEND", "1");
  vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "pk_test_stub");
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  resetIdentity();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const text = (): string => container.textContent ?? "";
const buttons = (): HTMLButtonElement[] => [...container.querySelectorAll("button")];
const byText = (label: string): HTMLButtonElement => {
  const found = buttons().find((b) => (b.textContent ?? "").includes(label));
  if (!found) throw new Error(`no button "${label}" in: ${buttons().map((b) => b.textContent).join(" | ")}`);
  return found;
};

/** Mount a surface with `who` already published, as a real page finds it. */
function mount(node: Parameters<typeof createElement>[0], who: Identity): void {
  act(() => publishIdentity(who));
  act(() => root.render(withQueryClient(createElement(node))));
}

/** Play the daily out to the result screen, every call right. */
function playDaily(): void {
  const deck = dailyDeck(DAY, DAILY_POOL);
  for (let i = 0; i < deck.length; i++) {
    act(() => void byText(deck[i]!.options[deck[i]!.key]!).click());
    act(() => void byText(i === deck.length - 1 ? "See today" : "Next card").click());
  }
  expect(text()).toContain(`Foray Daily #${dailyNumber(DAY)}`);
}

describe("the daily result screen", () => {
  it("does not tell a signed-in player there is no account", () => {
    mount(DailyChallenge, SIGNED_IN);
    playDaily();
    expect(text()).not.toContain("There is no account to lose it to");
    // The true half stays: the streak really is in this browser either way.
    expect(text()).toContain("this device only");
  });

  it("still says it to a player who has no account", () => {
    mount(DailyChallenge, ANONYMOUS);
    playDaily();
    expect(text()).toContain("There is no account to lose it to");
  });
});

describe("the /exam access pill", () => {
  it("does not ask a signed-in candidate to sign in", async () => {
    const ExamPage = (await import("../app/exam/page")).default;
    mount(ExamPage, SIGNED_IN);
    expect(text()).not.toContain("sign in to sit a scored run");
  });

  it("still asks an anonymous candidate to sign in", async () => {
    const ExamPage = (await import("../app/exam/page")).default;
    mount(ExamPage, ANONYMOUS);
    expect(text()).toContain("sign in to sit a scored run");
  });
});

describe("the daily itself is untouched by who is reading it", () => {
  /** The whole round, as a rendered transcript: cards, tells and the grid. */
  function transcript(who: Identity): string[] {
    const seen: string[] = [];
    mount(DailyChallenge, who);
    const deck = dailyDeck(DAY, DAILY_POOL);
    for (let i = 0; i < deck.length; i++) {
      seen.push(text());
      act(() => void byText(deck[i]!.options[deck[i]!.key]!).click());
      seen.push(text());
      act(() => void byText(i === deck.length - 1 ? "See today" : "Next card").click());
    }
    return seen;
  }

  it("deals the same five cards, in the same order, and asks the service for nothing", () => {
    // The rule the module-name guard in dailyChallenge.test.tsx used to
    // enforce, asserted over what a player actually meets. One sentence of
    // result-screen copy now reads the identity (TEN-151); the ROUND may not.
    const anonymous = transcript(ANONYMOUS);
    act(() => root.unmount());
    container.remove();
    store.clear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const signedIn = transcript(SIGNED_IN);
    expect(signedIn).toEqual(anonymous);
    expect(fetch).not.toHaveBeenCalled();
  });
});
