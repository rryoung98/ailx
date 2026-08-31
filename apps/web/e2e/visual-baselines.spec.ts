import {
  answerButtons,
  breakNextRunnerFocus,
  expect,
  logInTrack,
  seedRun,
  test,
} from "./fixtures";
import type { Page } from "@playwright/test";
import { REQUIRES_SERVICE, hasExamService } from "./service";

/**
 * SCREENSHOT BASELINES — deliberately few.
 *
 * A baseline is worth its maintenance only where (a) a human would notice the
 * regression instantly and (b) the pixels are DETERMINISTIC. Everything else
 * becomes the flake people learn to click past, which costs more than the bug
 * it was meant to catch.
 *
 * So the four surfaces below are all ELEMENT screenshots of full-surface,
 * copy-only states with no seeded content and no clock in frame:
 *
 *  1. the pause overlay — a veil that must cover the workspace completely;
 *     if it slips, a paused candidate can read the deck they are timed on;
 *  2. the time-up notice — the fairness screen; a candidate reads it once,
 *     under stress, and it must be whole;
 *  3. the runner crash notice — the last thing between a fault and a white
 *     page, and the surface nobody looks at on purpose;
 *  4. the shared player-type card — the one screen strangers see, built from
 *     the bundled sample attempt, so its numbers are fixed.
 *
 * Rejected on purpose: the T2 card and its confidence step (the deck is
 * seeded per attempt, so a baseline would be mostly mask), and the landing
 * hero (an animated canvas plus a randomly drawn practice card — the same
 * problem). Both are covered geometrically in `visual.spec.ts` instead, which
 * is the honest tool for them.
 *
 * Baselines are per platform (Playwright puts `{platform}` in the snapshot
 * name), and the committed ones are darwin. The CI job that owns this file
 * therefore runs on macOS; see FRONTEND.md §6.7.
 */

test.describe("screenshot baselines", () => {
  // Every baseline here seeds a run or a share token, so all of them need
  // the exam service (see e2e/service.ts). Nothing in this file measures an
  // unseeded page, so the skip is whole-file by fact, not by convenience.
  test.skip(!hasExamService(), REQUIRES_SERVICE);
  // Motion off in both senses: the app's own reduced-motion branch, and
  // Playwright's animation freeze. A baseline must not race a transition.
  // `reducedMotion` is a CONTEXT option, not a top-level test option, in
  // Playwright 1.62 — spelling it the other way does not fail to compile in a
  // plain object, it just silently emulates nothing.
  test.use({ contextOptions: { reducedMotion: "reduce" } });

  /** Web fonts are self-hosted by next/font, but still async: wait for them. */
  async function ready(page: Page): Promise<void> {
    await page.evaluate(() => document.fonts.ready);
  }

  test("the pause overlay", async ({ page, devUser, attemptId }) => {
    await seedRun(page, devUser, { attemptId, log: logInTrack(attemptId, "t2") });
    await page.goto("/exam");
    await page.getByRole("button", { name: "Start the deck" }).click();
    await page.getByRole("button", { name: "Pause" }).click();
    const paused = page.getByRole("dialog", { name: "Paused" });
    await expect(paused).toBeVisible();
    await ready(page);
    await expect(paused).toHaveScreenshot("pause-overlay.png");
  });

  test("the time-up notice", async ({ page, devUser, attemptId }) => {
    await seedRun(page, devUser, { attemptId, log: logInTrack(attemptId, "t2") });
    await page.goto("/exam");
    await page.getByRole("button", { name: "Start the deck" }).click();
    await page.clock.fastForward(601_000);
    const notice = page.getByTestId("time-up");
    await expect(notice).toBeVisible();
    await ready(page);
    await expect(notice).toHaveScreenshot("time-up.png");
  });

  test("the runner crash notice", async ({ page, devUser, attemptId }) => {
    await seedRun(page, devUser, { attemptId, log: logInTrack(attemptId, "t2") });
    await breakNextRunnerFocus(page);
    await page.goto("/exam");
    await page.getByRole("button", { name: "Start the deck" }).click();
    await answerButtons(page).first().click();
    const crash = page.getByTestId("runner-crash");
    await expect(crash).toBeVisible();
    await ready(page);
    // The fault detail is our own injected message, so it is stable text.
    await expect(crash).toHaveScreenshot("runner-crash.png");
  });

  test("the shared player-type card", async ({ page, shareToken }) => {
    const token = await shareToken();
    await page.goto(`/s/${token}`);
    const card = page.locator(".ptype-card");
    await expect(card).toBeVisible();
    await ready(page);
    await expect(card).toHaveScreenshot("share-player-type-card.png");
  });
});
