// @vitest-environment jsdom
/**
 * The efficacy-claim gate, at the surface a person actually reads.
 *
 * `packages/report/test/efficacyClaims.test.ts` holds the same rule at the
 * copy layer. This file holds it where copy is written by hand: the rendered
 * text of the pages that offer, describe, or report on practice.
 *
 * The finding this enforces. Geissler, Robertson & Feuerriegel (arXiv
 * 2507.23492, N = 1,200) ran five interventions with a two-week follow-up.
 * The GAMIFIED arm did not beat control (p_adj = 0.310) and the FEEDBACK arm
 * did not either (p_adj = 1.000); at two weeks no arm beat control at all.
 * AILX's practice loop — streaks, drills, immediate right/wrong — is built
 * from exactly those two arms. Gray et al. (R. Soc. Open Sci. 12:250921,
 * 2025) supplies the second hazard: their trained typical adults gained
 * accuracy while d' stayed at -0.066 (p = .279), so training moved the
 * CRITERION and not the sensitivity. Copy that tells such a person they are
 * getting better at spotting fakes is manufacturing false confidence in the
 * exact population we say we are helping.
 *
 * ENGAGEMENT COPY IS NOT THE TARGET and is asserted to survive: a streak, a
 * "come back tomorrow", a day count are true statements about activity.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  PRACTICE_ACCURACY_CAVEAT,
  PRACTICE_EFFICACY_NOTE,
  PRACTICE_EFFICACY_NOTE_SHORT,
} from "@ailx/report";
import Home from "../app/page";
import PracticePage, { metadata as practiceMetadata } from "../app/practice/page";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * Assertions of an ability gain, in the forms a marketing sentence takes.
 * Kept in step with the @ailx/report list by the shared-shape test at the
 * bottom of this file.
 */
const EFFICACY_CLAIM: readonly RegExp[] = [
  /\bmoves detection\b/i,
  /\bimproves? (your|their|people'?s?)\b/i,
  /\bmakes you (better|sharper)\b/i,
  /\bgetting better at\b/i,
  /\bbetter at (spotting|detecting|telling)\b/i,
  /\byou will (get|be) better\b/i,
  /\btrains your\b/i,
  /\bsharpens? your\b/i,
  /\bboosts? your\b/i,
  /\bmeasurably (works|improves)\b/i,
  /\bproven to\b/i,
  /\braises? your (score|accuracy|d')\b/i,
  // implied by a label rather than stated: a figure named as a skill
  /\b(detection|discrimination) (skill|ability) (level|score|meter)\b/i,
];

/** The denials legitimately contain the banned words; excise them by identity. */
const DENIALS = [PRACTICE_EFFICACY_NOTE, PRACTICE_EFFICACY_NOTE_SHORT, PRACTICE_ACCURACY_CAVEAT];

function findEfficacyClaim(raw: string): string | null {
  const text = DENIALS.reduce((acc, d) => acc.split(d).join(" "), raw);
  for (const re of EFFICACY_CLAIM) {
    const m = text.match(re);
    if (m !== null) return `${m[0]} — near: ${text.slice(Math.max(0, m.index! - 60), m.index! + 60)}`;
  }
  return null;
}

let host: HTMLElement | null = null;
let root: Root | null = null;

function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() { return m.size; },
    clear: () => m.clear(),
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    key: (i: number) => Array.from(m.keys())[i] ?? null,
    removeItem: (k: string) => { m.delete(k); },
    setItem: (k: string, v: string) => { m.set(k, String(v)); },
  } as Storage;
}

beforeEach(() => {
  Object.defineProperty(window, "localStorage", { value: memoryStorage(), configurable: true });
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.unstubAllGlobals();
});

async function renderedText(el: ReactElement): Promise<string> {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root!.render(el); });
  return host.textContent ?? "";
}

describe("the practice surface claims nothing for itself", () => {
  it("the practice page asserts no ability gain", async () => {
    const text = await renderedText(createElement(PracticePage));
    expect(findEfficacyClaim(text)).toBeNull();
  });

  it("the practice page ANSWERS the efficacy question rather than going quiet", async () => {
    const text = await renderedText(createElement(PracticePage));
    // Silence is not honesty here: somebody has just spent five minutes and
    // is entitled to know what it was worth.
    expect(text).toContain(PRACTICE_EFFICACY_NOTE);
    expect(text).toContain("Does this actually work?");
    // and it names the trial rather than asking to be believed
    expect(text).toMatch(/2507\.23492/);
    expect(text).toMatch(/250921/);
  });

  it("the page metadata carries the denial too, since it is what a link preview shows", () => {
    expect(String(practiceMetadata.description)).toContain(PRACTICE_EFFICACY_NOTE_SHORT);
    expect(findEfficacyClaim(String(practiceMetadata.description))).toBeNull();
    expect(findEfficacyClaim(String(practiceMetadata.title))).toBeNull();
  });

  it("the landing page asserts no ability gain", async () => {
    const text = await renderedText(createElement(Home));
    expect(findEfficacyClaim(text)).toBeNull();
  });
});

describe("the engagement surface survives intact", () => {
  it("the landing funnel still asks people to come back, and still offers the drill", async () => {
    const text = await renderedText(createElement(Home));
    // Activity language is honest language: it describes what happened.
    expect(text).toContain("Play one card.");
    expect(text).toMatch(/Meet the families\.|Come back tomorrow\./);
    expect(text).toContain("Practise the tells");
  });

  it("the practice page still sells the round on the tells, not on a promise", async () => {
    const text = await renderedText(createElement(PracticePage));
    expect(text).toContain("Practise the tells.");
    expect(text).toContain("Being shown the thing you looked straight past");
  });
});

describe("the gate can fail", () => {
  // A ban nobody has watched go red is not a gate. These are the exact
  // sentences this pass removed from the product.
  it.each([
    "immediate right/wrong on each call is what moves detection",
    "Five minutes of this improves your detection",
    "Are you actually getting better at spotting fakes?",
    "A detection skill meter, right there on your profile",
  ])("catches %s", (sentence) => {
    expect(findEfficacyClaim(sentence)).not.toBeNull();
  });

  it("does not fire on activity copy, which is what we are protecting", () => {
    for (const ok of [
      "You have a 5-day streak. Come back tomorrow.",
      "12 days practised, 6 cards a round.",
      "Practise the tells.",
      "What moved",
    ]) {
      expect(findEfficacyClaim(ok), ok).toBeNull();
    }
  });
});
