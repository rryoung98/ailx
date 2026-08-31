import {
  answerButtons,
  confidenceDialog,
  confidenceSlider,
  deckPosition,
  expect,
  expectLiveFocus,
  focusState,
  lockInButton,
  logInTrack,
  seedRun,
  tabTo,
  test,
} from "./fixtures";
import { REQUIRES_SERVICE, hasExamService } from "./service";

/**
 * Keyboard-only path through a T2 card (FRONTEND.md §6.4.5).
 *
 * The dogfood P0: answering yanked focus to <body>, because the button the
 * candidate had just pressed disabled itself under their fingers — on a
 * TIMED, SCORED item whose decision latency is part of the measurement.
 * jsdom can never catch that (Layout and focus semantics are unimplemented),
 * so it is pinned here, in a real browser, with a real tab order.
 *
 * The deck is seeded per attempt, so nothing below names an item, an option
 * or an answer: only structure and behaviour.
 */
// Every test here SEEDS through the exam service, so the whole file skips with a
// stated reason when there is none. Measurement specs are unaffected: they take
// no seeding fixture and must keep running with no backend (FRONTEND.md §6.7.3).
test.skip(!hasExamService(), REQUIRES_SERVICE);

test("a candidate can answer a T2 card with the keyboard alone", async ({ page, devUser, attemptId }) => {
  await seedRun(page, devUser, { attemptId, log: logInTrack(attemptId, "t2") });
  await page.goto("/exam");

  const startDeck = page.getByRole("button", { name: "Start the deck" });
  await expect(startDeck).toBeVisible();
  await tabTo(page, startDeck);
  await page.keyboard.press("Enter");

  const firstAnswer = answerButtons(page).first();
  await expect(firstAnswer).toBeVisible();
  const startedAt = await deckPosition(page);

  // Answer with the keyboard only — no pointer has been used in this test.
  await tabTo(page, firstAnswer);
  await page.keyboard.press("Enter");

  // The confidence step is modal, and it takes focus: the regression was
  // that nothing did.
  await expect(confidenceDialog(page)).toBeVisible();
  await expect(confidenceSlider(page)).toBeFocused();
  await expectLiveFocus(page, "answering");

  // Focus trap: Tab cannot escape to the (inert) deck behind the sheet.
  // While confidence is unset the slider is the only enabled control, so
  // both hops land back on it.
  await page.keyboard.press("Tab");
  expect(await focusState(page)).toMatchObject({ inSheet: true });
  await page.keyboard.press("Shift+Tab");
  expect(await focusState(page)).toMatchObject({ inSheet: true });

  // Set confidence from the keyboard, then lock in from the keyboard.
  await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("confidence-hint")).toBeHidden();
  await tabTo(page, lockInButton(page), 4);
  await page.keyboard.press("Enter");

  // Terminal state: the sheet is gone, the deck advanced, and focus is on a
  // live answer control — ready for the next item with no tabbing from the
  // top of the document.
  await expect(confidenceDialog(page)).toHaveCount(0);
  expect(await deckPosition(page)).toBe(startedAt + 1);
  await expectLiveFocus(page, "locking in");
  await expect(answerButtons(page).first()).toBeFocused();
});
