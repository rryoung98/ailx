import { test as base, expect, type Locator, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { ATTEMPT_KEY, TRACK_IDS, append, type SequencedEntry, type SessionConfig, type TrackId } from "@ailx/session";
import { DEV_USER_HEADER } from "@ailx/contract";
import { fixtureArtifact } from "../lib/sampleAttempt";
import { completedLog } from "../test/helpers/completedAttempt";
import { DEV_USER_KEY, syncKey } from "../lib/persistence";
import { checkpointKey } from "../lib/checkpoints";
import { buildSiteZip, T1_SITE_SEQ, type SiteFile } from "../lib/siteUpload";
import { OPENROUTER_KEY_STORAGE } from "@ailx/track-t1";
import { apiRoot } from "./service";

export { expect };

/**
 * Pinned wall clock for every spec that installs `page.clock`. Anything
 * time-dependent is pinned (§6.5) — the seeded event log is written relative
 * to this instant so the session machine's nondecreasing-ts rule holds.
 */
export const FIXED_TIME = new Date("2026-03-01T12:00:00Z").getTime();

/** The seeded run starts a few seconds "ago" so a timer is already ticking. */
const RUN_AGE_MS = 5_000;

/**
 * The run config for a seeded attempt. Budgets are per-attempt DATA that
 * lives in the log the app then reads back — not an app constant to keep in
 * sync — so they are stated here, generously, to keep the specs about
 * behaviour rather than about the clock.
 */
export function demoConfig(): SessionConfig {
  return {
    instrument: "ailx",
    version: "2026.1",
    locale: "en",
    budgets: { t1: 600, t2: 600, t3: 600, t4: 600 },
    demo: true,
  };
}

/**
 * A valid session log, built with the REAL session machine, that leaves the
 * candidate mid-run inside `track`. Tracks before it are completed with the
 * REAL artifact shape from the bundled sample fixture — the machine only
 * allows the next pending track to start, and a scorer that later walks this
 * log must see the shape it was written for.
 */
export function logInTrack(attemptId: string, track: TrackId, ts = FIXED_TIME - RUN_AGE_MS): SequencedEntry[] {
  let log = append([], { type: "attempt_started", attemptId, config: demoConfig(), ts });
  for (const tid of TRACK_IDS) {
    log = append(log, { type: "track_started", trackId: tid, ts });
    if (tid === track) return log;
    log = append(log, { type: "track_completed", trackId: tid, artifact: fixtureArtifact(tid), timedOut: false, ts });
  }
  throw new Error(`unknown track ${track}`);
}

export interface RunSeed {
  attemptId: string;
  log: SequencedEntry[];
  /** Per-track runner checkpoint, written exactly as the app stores it. */
  checkpoints?: ReadonlyArray<{ trackId: TrackId; state: unknown }>;
  /** Seed a model connection (the T1 runner's BYOK slot). */
  modelKey?: string;
}

/**
 * Install the browser state a mid-run reload would have found: the dev
 * identity, the mirrored attempt, the session log and any runner checkpoint.
 * Runs before every navigation, so a reload inside a test keeps it.
 */
export async function seedRun(page: Page, devUser: string, seed: RunSeed): Promise<void> {
  // The seeded log is written relative to FIXED_TIME, so the clock must be
  // pinned there before anything loads — otherwise every seeded budget is
  // already exhausted and the run "times out" before the first assertion.
  // Installed (not resumed): time only moves when a spec moves it (§6.5).
  await page.clock.install({ time: FIXED_TIME });
  // …then let it tick: with every timer frozen the app never finishes
  // hydrating. Specs that need to jump forward pause it explicitly.
  await page.clock.resume();
  await page.addInitScript(
    ({ devUserKey, devUserId, attemptKey, attemptId, log, syncStateKey, checkpoints, modelKeyStorage, modelKey }) => {
      window.localStorage.setItem(devUserKey, devUserId);
      window.localStorage.setItem(attemptKey, JSON.stringify({ formatVersion: 1, rev: 1, log }));
      window.localStorage.setItem(
        syncStateKey,
        JSON.stringify({ serverAttemptId: attemptId, syncedThrough: 0, finalized: false }),
      );
      for (const cp of checkpoints) window.localStorage.setItem(cp.key, cp.value);
      if (modelKey !== null) window.localStorage.setItem(modelKeyStorage, modelKey);
    },
    {
      devUserKey: DEV_USER_KEY,
      devUserId: devUser,
      attemptKey: ATTEMPT_KEY,
      attemptId: seed.attemptId,
      log: seed.log,
      syncStateKey: syncKey(seed.attemptId),
      checkpoints: (seed.checkpoints ?? []).map((cp) => ({
        key: checkpointKey(seed.attemptId, cp.trackId),
        value: JSON.stringify({
          formatVersion: 2,
          attemptId: seed.attemptId,
          trackId: cp.trackId,
          state: cp.state,
        }),
      })),
      modelKeyStorage: OPENROUTER_KEY_STORAGE,
      modelKey: seed.modelKey ?? null,
    },
  );
}

/** The session log the app has actually persisted — a diagnostic, never the sole proof. */
export async function storedLog(page: Page): Promise<SequencedEntry[]> {
  return page.evaluate((key) => {
    const raw = window.localStorage.getItem(key);
    return raw === null ? [] : (JSON.parse(raw) as { log: SequencedEntry[] }).log;
  }, ATTEMPT_KEY);
}

// ---------------------------------------------------------------------------
// Focus
// ---------------------------------------------------------------------------

export interface FocusState {
  tag: string;
  role: string | null;
  label: string | null;
  ariaDisabled: string | null;
  disabled: boolean;
  inSheet: boolean;
}

/** What the keyboard user is actually on right now. */
export async function focusState(page: Page): Promise<FocusState> {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    return {
      tag: el?.tagName ?? "NONE",
      role: el?.getAttribute("role") ?? null,
      label: el?.getAttribute("aria-label") ?? el?.textContent?.trim().slice(0, 40) ?? null,
      ariaDisabled: el?.getAttribute("aria-disabled") ?? null,
      disabled: (el as HTMLButtonElement | null)?.disabled === true,
      inSheet: el?.closest("[data-testid='confidence-sheet']") !== null && el !== null,
    };
  });
}

/**
 * The P0-2 invariant, asserted after every single keystroke: a keyboard user
 * is never dropped on <body> and never parked on a control that refuses input.
 * jsdom cannot observe either (Navigation and Layout are unimplemented).
 */
export async function expectLiveFocus(page: Page, step: string): Promise<FocusState> {
  const state = await focusState(page);
  expect(state, `focus after ${step}`).toMatchObject({ disabled: false });
  expect(state.tag, `focus after ${step} must not fall to the document body`).not.toBe("BODY");
  expect(state.tag, `focus after ${step} must be a real control`).not.toBe("HTML");
  expect(state.ariaDisabled, `focus after ${step} must not sit on an inert control`).not.toBe("true");
  return state;
}

/**
 * Tab (keyboard only) until `target` holds focus, asserting the focus
 * invariant at every hop. Throws — never silently gives up — after `max`
 * hops, which is also the keyboard-trap guard.
 */
export async function tabTo(page: Page, target: Locator, max = 30): Promise<void> {
  for (let i = 0; i < max; i++) {
    const focused = await target.evaluate((el) => el === document.activeElement).catch(() => false);
    if (focused) return;
    await page.keyboard.press("Tab");
    await expectLiveFocus(page, `Tab #${i + 1}`);
  }
  throw new Error(`focus never reached ${target} within ${max} tab stops (keyboard trap?)`);
}

// ---------------------------------------------------------------------------
// Locators shared by the T2 specs (structure only — decks are seeded per
// attempt, so no spec may name an item, an option or an answer).
// ---------------------------------------------------------------------------

/** The deck's answer controls: two swipe answers, or one button per option. */
export function answerButtons(page: Page): Locator {
  return page.locator(".t2-answer-btn, .t2-option-btn");
}

export function confidenceSheet(page: Page): Locator {
  return page.getByTestId("confidence-sheet");
}

/**
 * The confidence step as assistive technology sees it. The closed sheet is
 * still laid out (it slides), so `toBeHidden` is the wrong question: the
 * user-visible fact is whether the dialog exists in the a11y tree at all.
 */
export function confidenceDialog(page: Page): Locator {
  return page.getByRole("dialog", { name: "Set your confidence" });
}

export function confidenceSlider(page: Page): Locator {
  return confidenceSheet(page).getByRole("slider");
}

export function lockInButton(page: Page): Locator {
  return confidenceSheet(page).getByRole("button", { name: /lock in/i });
}

/** "Item 3 / 6" → 3. Position only; the item itself is never asserted. */
export async function deckPosition(page: Page): Promise<number> {
  const text = await page.getByText(/^Item \d+ \/ \d+/).first().innerText();
  return Number(/^Item (\d+)/.exec(text)?.[1]);
}

/** The track clock as the candidate reads it, in seconds. */
export async function remainingSeconds(page: Page): Promise<number> {
  const label = await page.getByRole("timer").getAttribute("aria-label");
  const [, m, s] = /(\d+):(\d+)/.exec(label ?? "") ?? [];
  return Number(m) * 60 + Number(s);
}

// ---------------------------------------------------------------------------
// Fault injection
// ---------------------------------------------------------------------------

/**
 * Inject one transient fault into the running track: the FIRST `focus()`
 * throws, then the real implementation is restored. The T2 runner focuses the
 * confidence slider the moment a card is answered, so this is a real crash on
 * a real code path — no product test hook, and recoverable, so the retry path
 * is exercised for real too.
 *
 * This used to break `scrollIntoView`, which the runner no longer calls: the
 * confidence step was moved INTO the card frame precisely so that nothing
 * scrolls (packages/tracks/t2-discrimination). A fault injector must follow
 * the code it is meant to fault, or it silently stops testing anything — and
 * for hours nobody noticed, because "green" looked the same either way
 * (FRONTEND.md §6.7).
 *
 * It lives here, not in one spec, because more than one spec now crashes a
 * runner on purpose and two copies would rot apart.
 */
export async function breakNextRunnerFocus(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const real = HTMLElement.prototype.focus;
    HTMLElement.prototype.focus = function patched(this: HTMLElement) {
      HTMLElement.prototype.focus = real;
      throw new Error("e2e injected runner fault");
    } as typeof HTMLElement.prototype.focus;
  });
}

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

/**
 * Every seeding call below goes to the EXAM SERVICE (`apiRoot()`), not to the
 * app under test. The app is a frontend and has no API routes of its own, so
 * "create an attempt exactly as the app does" now means the same HTTP call the
 * browser makes cross-origin. Identity therefore travels as the
 * `x-ailx-dev-user` HEADER and never as a cookie: `ailx_dev_user` is
 * SameSite=Lax and a browser will not send it to another origin
 * (docs/ARCHITECTURE.md §10.1).
 */
export interface AilxFixtures {
  /** Unique dev identity per test — runs can never collide on server rows. */
  devUser: string;
  /** Server-side attempt, created through the API exactly as the app does. */
  attemptId: string;
  /** Publish a site snapshot straight through the API (no UI detour). */
  publishSite: (files: readonly SiteFile[]) => Promise<{ digest: string; url: string }>;
  /**
   * A live share token for a COMPLETE, really-scored attempt: the bundled
   * sample log is mirrored through the same append-only endpoint the app
   * syncs with, then the share is created through the owner's own API. The
   * payload is therefore deterministic, which is what makes the share view
   * safe to hold a screenshot baseline for.
   */
  shareToken: () => Promise<string>;
}

export const test = base.extend<AilxFixtures>({
  devUser: async ({}, use) => {
    await use(`e2e-${randomUUID().slice(0, 8)}`);
  },

  attemptId: async ({ request, devUser }, use) => {
    const res = await request.post(`${apiRoot()}/attempts`, {
      headers: { [DEV_USER_HEADER]: devUser, "content-type": "application/json" },
      data: { locale: "en", decks: true },
    });
    expect(res.status(), await res.text()).toBe(201);
    const body = (await res.json()) as { attempt: { id: string } };
    await use(body.attempt.id);
  },

  shareToken: async ({ request, devUser, attemptId }, use) => {
    await use(async () => {
      const headers = { [DEV_USER_HEADER]: devUser, "content-type": "application/json" };
      for (const entry of completedLog()) {
        const res = await request.post(`${apiRoot()}/attempts/${attemptId}/responses`, {
          headers,
          data: { seq: entry.seq, payload: entry, clientTs: new Date(entry.ts).toISOString() },
        });
        expect(res.status(), await res.text()).toBe(201);
      }
      const res = await request.post(`${apiRoot()}/attempts/${attemptId}/share`, { headers, data: {} });
      expect(res.status(), await res.text()).toBe(201);
      const body = (await res.json()) as { share: { token: string } };
      return body.share.token;
    });
  },

  publishSite: async ({ request, devUser, attemptId }, use) => {
    await use(async (files) => {
      const res = await request.post(`${apiRoot()}/attempts/${attemptId}/site?seq=${T1_SITE_SEQ}`, {
        headers: {
          [DEV_USER_HEADER]: devUser,
          "content-type": "application/zip",
          "x-ailx-client-ts": new Date().toISOString(),
        },
        data: Buffer.from(buildSiteZip(files)),
      });
      expect(res.status(), await res.text()).toBe(201);
      const body = (await res.json()) as { submission: { digest: string; path: string } };
      return { digest: body.submission.digest, url: body.submission.path };
    });
  },
});
