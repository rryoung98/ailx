import {
  answerButtons,
  breakNextRunnerFocus,
  expect,
  logInTrack,
  remainingSeconds,
  seedRun,
  storedLog,
  test,
} from "./fixtures";
import { REQUIRES_SERVICE, hasExamService } from "./service";

/**
 * Runner crash recovery (FRONTEND.md §6.4.6).
 *
 * A track runner CAN throw — a browser API that misbehaves once is enough —
 * and before the boundary existed that left a candidate on a white page with
 * their own clock still running. Two things must hold, and only one of them
 * is about pixels: the candidate gets a way forward, and the fault is not
 * charged to their time budget.
 */

// Every test here SEEDS through the exam service, so the whole file skips with a
// stated reason when there is none. Measurement specs are unaffected: they take
// no seeding fixture and must keep running with no backend (FRONTEND.md §6.7.3).
test.skip(!hasExamService(), REQUIRES_SERVICE);

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
