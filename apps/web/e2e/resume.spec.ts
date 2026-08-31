import {
  answerButtons,
  confidenceDialog,
  confidenceSlider,
  deckPosition,
  expect,
  lockInButton,
  logInTrack,
  remainingSeconds,
  seedRun,
  test,
} from "./fixtures";
import { REQUIRES_SERVICE, hasExamService } from "./service";

/**
 * Reload / resume mid-exam (FRONTEND.md §6.4.3).
 *
 * A candidate's browser will be reloaded, restored, or crash-recovered
 * mid-run. What must survive is what they can SEE afterwards: the same
 * track, the same place in the deck, and a clock that did not silently
 * restart (or silently keep charging). Asserted through the UI, never by
 * reading localStorage bytes.
 */
// Every test here SEEDS through the exam service, so the whole file skips with a
// stated reason when there is none. Measurement specs are unaffected: they take
// no seeding fixture and must keep running with no backend (FRONTEND.md §6.7.3).
test.skip(!hasExamService(), REQUIRES_SERVICE);

test("a reload mid-track restores the track, the deck position and the clock", async ({
  page,
  devUser,
  attemptId,
}) => {
  await seedRun(page, devUser, { attemptId, log: logInTrack(attemptId, "t2") });
  await page.goto("/exam");
  await page.getByRole("button", { name: "Start the deck" }).click();

  // Answer one item so there is real progress to lose.
  await answerButtons(page).first().click();
  await expect(confidenceDialog(page)).toBeVisible();
  await confidenceSlider(page).click();
  await lockInButton(page).click();
  await expect(confidenceDialog(page)).toHaveCount(0);

  const position = await deckPosition(page);
  expect(position).toBe(2);

  // A minute of the candidate's budget really passes (pinned clock).
  await page.clock.fastForward(60_000);
  const before = await remainingSeconds(page);
  expect(before).toBeLessThan(600 - 60);

  await page.reload();

  // Terminal, user-visible state: same track, same card, same clock.
  await expect(page.getByRole("heading", { name: /T2 · /i })).toBeVisible();
  await expect(answerButtons(page).first()).toBeVisible();
  expect(await deckPosition(page)).toBe(position);

  const after = await remainingSeconds(page);
  expect(after).toBeLessThanOrEqual(before);
  expect(after).toBeGreaterThan(before - 10);
});
