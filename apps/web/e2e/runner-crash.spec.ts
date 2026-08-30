import {
  answerButtons,
  expect,
  logInTrack,
  remainingSeconds,
  seedRun,
  storedLog,
  test,
} from "./fixtures";
import type { Page } from "@playwright/test";

/**
 * Runner crash recovery (FRONTEND.md §6.4.6).
 *
 * A track runner CAN throw — a browser API that misbehaves once is enough —
 * and before the boundary existed that left a candidate on a white page with
 * their own clock still running. Two things must hold, and only one of them
 * is about pixels: the candidate gets a way forward, and the fault is not
 * charged to their time budget.
 */

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
 * the code it is meant to fault, or it silently stops testing anything.
 */
async function breakNextRunnerFocus(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const real = HTMLElement.prototype.focus;
    HTMLElement.prototype.focus = function patched(this: HTMLElement, ...args: unknown[]) {
      HTMLElement.prototype.focus = real;
      throw new Error("e2e injected runner fault");
    } as typeof HTMLElement.prototype.focus;
  });
}

test("a crashed runner offers recovery and stops charging the candidate", async ({
  page,
  devUser,
  attemptId,
}) => {
  await seedRun(page, devUser, { attemptId, log: logInTrack(attemptId, "t2") });
  await breakNextRunnerFocus(page);
  await page.goto("/exam");
  await page.getByRole("button", { name: "Start the deck" }).click();

  const beforeCrash = await remainingSeconds(page);
  await answerButtons(page).first().click();

  // The candidate sees an explanation and a way on — not a white page.
  const crash = page.getByRole("alert").filter({ hasText: "This track hit a fault" });
  await expect(crash).toBeVisible();
  const retry = page.getByRole("button", { name: "Reload this track and continue" });
  await expect(retry).toBeVisible();

  // Our fault is not billed: a minute passes on the candidate's pinned clock
  // and the track clock they can read has not moved at all.
  const atCrash = await remainingSeconds(page);
  expect(atCrash).toBeLessThanOrEqual(beforeCrash);
  await page.clock.fastForward(60_000);
  expect(await remainingSeconds(page)).toBe(atCrash);

  // Diagnostic (§6.4): the involuntary pause has an auditable cause in the
  // append-only log — never the sole proof, but a re-score must be able to
  // see that the pause was ours.
  const log = await storedLog(page);
  expect(log.map((e) => e.type)).toContain("paused");
  expect(
    log.some((e) => e.type === "track_event" && e.event.verb === "runner_crashed"),
  ).toBe(true);

  // Recovery: the track comes back from its checkpoint and the clock restarts.
  await retry.click();
  await expect(answerButtons(page).first()).toBeVisible();
  await expect(crash).toHaveCount(0);
  await page.clock.fastForward(10_000);
  expect(await remainingSeconds(page)).toBeLessThan(atCrash);
});
