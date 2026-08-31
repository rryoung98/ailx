import {
  answerButtons,
  breakNextRunnerFocus,
  confidenceDialog,
  confidenceSheet,
  confidenceSlider,
  expect,
  lockInButton,
  logInTrack,
  seedRun,
  test,
} from "./fixtures";
import type { Locator, Page } from "@playwright/test";
import {
  eventually,
  expectCentred,
  expectInViewport,
  expectNoHorizontalOverflow,
  expectNoInnerScroll,
  expectCovers,
  expectNoOverlap,
  expectNotOccluded,
  expectScrollStable,
  expectStablePosition,
  expectTapTarget,
  expectTapTargets,
  expectTextNotClipped,
} from "./visual";

/**
 * VISUAL CONTRACTS on the surfaces where this class of bug has actually bitten
 * (FRONTEND.md §6.7). Nothing here duplicates a DOM assertion: every line asks
 * a question about GEOMETRY, which jsdom cannot answer at all.
 *
 * The contracts themselves are mutation-tested in `visual-contracts.spec.ts`.
 */

/** The phone the T2 scroll bug was found on. */
const PHONE = { width: 390, height: 844 };

const deckFrame = (page: Page): Locator => page.getByTestId("swipe-deck");
const runnerFrame = (page: Page): Locator => page.locator(".runner-frame");

/**
 * Let the HARNESS do its scrolling before a stability contract starts
 * measuring. Playwright scrolls an element into view as part of its
 * actionability checks, so a click can move the page for reasons that have
 * nothing to do with the app; doing it up front means the assertion that
 * follows is about the product, not about the test runner.
 */
async function settleOn(target: Locator): Promise<void> {
  await target.scrollIntoViewIfNeeded();
}

async function startDeck(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Start the deck" }).click();
  await expect(answerButtons(page).first()).toBeVisible();
}

/** "Item 2 / 6 · provenance" → "provenance". */
async function currentItemType(page: Page): Promise<string> {
  const text = await page.getByText(/^Item \d+ \/ \d+ · /).first().innerText();
  return text.split("·")[1].trim();
}

/** Answer the current card and lock the confidence in, landing on the next. */
async function answerAndLockIn(page: Page): Promise<void> {
  await answerButtons(page).first().click();
  await expect(confidenceDialog(page)).toBeVisible();
  await confidenceSlider(page).click();
  await lockInButton(page).click();
  await expect(confidenceDialog(page)).toHaveCount(0);
}

/**
 * Walk the seeded deck to the first item of `type`. Every deck carries two
 * provenance items (deck.ts), so this terminates; it throws rather than
 * silently testing the wrong card if it ever does not.
 */
async function advanceToItemType(page: Page, type: string): Promise<void> {
  const total = Number(/\/ (\d+)/.exec(await page.getByText(/^Item \d+ \/ \d+/).first().innerText())?.[1]);
  for (let i = 0; i < total; i++) {
    if ((await currentItemType(page)) === type) return;
    await answerAndLockIn(page);
  }
  throw new Error(`the seeded deck never reached a "${type}" item`);
}

/**
 * Every geometric promise the T2 confidence step makes, on any viewport.
 * Retried as a group: the judged card sails off over ~340ms, and the resting
 * state is the one the candidate lives in (§6.4).
 */
async function assertConfidenceStepGeometry(page: Page, where: string): Promise<void> {
  await eventually(async () => {
  const sheet = confidenceSheet(page);
  // Above the fold / below the fold: the 390x844 regression, where the page
  // jumped 464px and the panel landed off screen.
  await expectInViewport(page, sheet, `the confidence step (${where})`);
  // The dogfood regression: on provenance items it rendered behind the card.
  await expectNotOccluded(sheet, `the confidence step (${where})`);
  // The brief's own bug: a modal that is a corner panel.
  await expectCentred(page, sheet, `the confidence step (${where})`, { within: deckFrame(page), axis: "both" });
  // A step you must scroll inside is the same failure as a page that scrolls.
  await expectNoInnerScroll(sheet, `the confidence step (${where})`);
  await expectTapTargets(sheet, `the confidence step (${where})`);
  await expectInViewport(page, lockInButton(page), `the Lock in button (${where})`);
  await expectNoHorizontalOverflow(page, `the exam page (${where})`);
  });
}

for (const [label, viewport] of [
  ["desktop", null],
  ["390x844 phone", PHONE],
] as const) {
  test.describe(`T2 confidence step · ${label}`, () => {
    // A phone is a touch device: `pointer: coarse` is what its CSS gets, so a
    // viewport-only "phone" would test rules the real device never applies.
    test.use(viewport === null ? {} : { viewport, hasTouch: true, isMobile: true });

    test("opening the step moves nothing and lands the panel on screen", async ({
      page,
      devUser,
      attemptId,
    }) => {
      await seedRun(page, devUser, { attemptId, log: logInTrack(attemptId, "t2") });
      await page.goto("/exam");
      await startDeck(page);

      // THE regression: the transition must not move the page under the
      // candidate, and must not change the document height either.
      await settleOn(answerButtons(page).first());
      await expectScrollStable(page, `opening the confidence step (${label})`, async () => {
        await expectStablePosition(deckFrame(page), `the deck frame (${label})`, async () => {
          await answerButtons(page).first().click();
          await expect(confidenceDialog(page)).toBeVisible();
        });
      });
      await assertConfidenceStepGeometry(page, label);

      // …and closing it moves nothing either: the ping-pong went both ways.
      await settleOn(confidenceSlider(page));
      await expectScrollStable(page, `locking in (${label})`, async () => {
        await confidenceSlider(page).click();
        await lockInButton(page).click();
        await expect(confidenceDialog(page)).toHaveCount(0);
      });
    });

    test("the step is visible on a provenance item, where it once was not", async ({
      page,
      devUser,
      attemptId,
    }) => {
      await seedRun(page, devUser, { attemptId, log: logInTrack(attemptId, "t2") });
      await page.goto("/exam");
      await startDeck(page);
      await advanceToItemType(page, "provenance");

      // A provenance card is answered by button and never flies off, so it
      // used to sit ON TOP of the confidence step.
      // No scroll-stability assertion here, and that is the honest reading of
      // the design: a provenance item carries the tallest option list, so on a
      // short viewport the deck hits its DECK_MIN_H floor and the page really
      // does not fit. What must hold is the thing that failed in the dogfood —
      // the panel ends up fully on screen and nothing paints over it.
      await answerButtons(page).first().click();
      await expect(confidenceDialog(page)).toBeVisible();
      await assertConfidenceStepGeometry(page, `${label}, provenance item`);
    });
  });
}

test.describe("exam overlays", () => {
  test("the pause overlay covers the workspace and carries its own way out", async ({
    page,
    devUser,
    attemptId,
  }) => {
    await seedRun(page, devUser, { attemptId, log: logInTrack(attemptId, "t2") });
    await page.goto("/exam");
    await startDeck(page);
    await page.getByRole("button", { name: "Pause" }).click();

    const paused = page.getByRole("dialog", { name: "Paused" });
    // The veil's whole job: cover the timed workspace completely. It may be
    // taller than the fold — the workspace is — so "wholly in the viewport"
    // would be the wrong question; "no strip of the deck showing" is the right
    // one, and its own control must still be reachable without scrolling.
    await expectCovers(paused, runnerFrame(page), ["the pause overlay", "the runner workspace"], 1);
    await expectCentred(page, paused, "the pause overlay", { within: runnerFrame(page), axis: "both", tolerancePx: 1 });
    await expectNotOccluded(paused, "the pause overlay");
    const resume = paused.getByRole("button", { name: "Resume track" });
    await expectInViewport(page, resume, "the Resume track button");
    await expectTapTarget(resume, "the Resume track button");
    await expectNoHorizontalOverflow(page, "the paused exam page");
  });

  test("the crash notice is on screen with a pressable way forward", async ({
    page,
    devUser,
    attemptId,
  }) => {
    await seedRun(page, devUser, { attemptId, log: logInTrack(attemptId, "t2") });
    await breakNextRunnerFocus(page);
    await page.goto("/exam");
    await startDeck(page);
    await answerButtons(page).first().click();

    const crash = page.getByTestId("runner-crash");
    await expectInViewport(page, crash, "the runner crash notice");
    await expectNotOccluded(crash, "the runner crash notice");
    await expectTextNotClipped(crash, "the runner crash notice");
    const retry = page.getByTestId("runner-crash-retry");
    await expectInViewport(page, retry, "the crash retry button");
    await expectTapTarget(retry, "the crash retry button");
    await expectNoHorizontalOverflow(page, "the crashed exam page");
  });

  test("the time-up notice reads end to end and its Continue is pressable", async ({
    page,
    devUser,
    attemptId,
  }) => {
    await seedRun(page, devUser, { attemptId, log: logInTrack(attemptId, "t2") });
    await page.goto("/exam");
    await startDeck(page);
    // Past the seeded 600s budget: the track closes itself.
    await page.clock.fastForward(601_000);

    const notice = page.getByTestId("time-up");
    await expect(notice).toBeVisible();
    await expectTextNotClipped(notice, "the time-up notice");
    await expectInViewport(page, notice.getByRole("heading", { name: "Time up" }), "the Time up heading");
    const cont = page.getByTestId("time-up-continue");
    await expectInViewport(page, cont, "the time-up Continue button");
    await expectTapTarget(cont, "the time-up Continue button");
    await expectNoHorizontalOverflow(page, "the time-up page");
  });
});

test.describe("finish steps", () => {
  test("T1's finish step lands on screen with two distinct, pressable choices", async ({
    page,
    devUser,
    attemptId,
  }) => {
    await seedRun(page, devUser, { attemptId, log: logInTrack(attemptId, "t1") });
    await page.goto("/exam");
    await page.getByRole("button", { name: "Submit final artifact" }).click();

    const finish = page.getByRole("region", { name: "Finish T1" });
    // The T1 workspace is a two-pane environment taller than a laptop screen,
    // so the step legitimately opens below the fold. What must hold is that it
    // is WHOLE once reached — not half a step with the confirmation clipped.
    await settleOn(finish);
    await expectInViewport(page, finish, "the T1 finish step");
    await expectNotOccluded(finish, "the T1 finish step");
    await expectTapTargets(finish, "the T1 finish step");
    const confirm = finish.getByRole("button", { name: "Yes, submit final artifact" });
    const keep = finish.getByRole("button", { name: "Keep working" });
    // Forfeiting the clock and carrying on must never be one mis-tap apart.
    await expectNoOverlap(confirm, keep, ["the submit button", "the Keep working button"]);
    await expectInViewport(page, confirm, "the T1 submit confirmation");
    await expectNoHorizontalOverflow(page, "the T1 workspace");
  });

  test("T4's finish step lands on screen and its controls are pressable", async ({
    page,
    devUser,
    attemptId,
  }) => {
    await seedRun(page, devUser, { attemptId, log: logInTrack(attemptId, "t4") });
    await page.goto("/exam");
    await page.getByRole("button", { name: "Direction note" }).click();

    const finish = page.getByRole("region", { name: "Finish T4" });
    await settleOn(finish);
    await expectInViewport(page, finish, "the T4 finish step");
    await expectNotOccluded(finish, "the T4 finish step");
    await expectTapTargets(finish, "the T4 finish step");
    await expectNoHorizontalOverflow(page, "the T4 workspace");
  });
});

test.describe("share view", () => {
  test("the shared card holds together on a phone and on a desktop", async ({
    page,
    shareToken,
  }) => {
    const token = await shareToken();

    for (const [label, size] of [
      ["390x844 phone", PHONE],
      ["desktop", { width: 1280, height: 720 }],
    ] as const) {
      await page.setViewportSize(size);
      await page.goto(`/s/${token}`);

      const card = page.locator(".ptype-card");
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expectNoHorizontalOverflow(page, `the share view (${label})`);
      await expectTextNotClipped(card, `the player-type card (${label})`);
      // The type letters used to run into the portrait at narrow widths.
      await expectNoOverlap(page.locator(".ptype-intro"), page.locator(".ptype-code"), [
        `the portrait block (${label})`,
        `the type code (${label})`,
      ]);
      await expectInViewport(page, page.getByRole("heading", { level: 1 }), `the share heading (${label})`);
    }
  });
});

test.describe("landing hero · 390x844 phone", () => {
  // The hero's entrance animation scales the CTAs while it plays, so a box
  // measured mid-flight is 40px, not 44. Reduced motion is both the honest
  // resting state and what a large minority of real visitors actually get.
  test.use({ viewport: PHONE, hasTouch: true, isMobile: true, contextOptions: { reducedMotion: "reduce" } });

  test("the hero fits the phone and its calls to action are pressable", async ({ page }) => {
    await page.goto("/");

    await expectNoHorizontalOverflow(page, "the landing page");
    const title = page.locator("h1.hero-title");
    await expectInViewport(page, title, "the hero headline");
    await expectTextNotClipped(title, "the hero headline");
    const play = page.getByRole("link", { name: "Play a full round" });
    const credential = page.getByRole("link", { name: "Go for the credential" });
    // The hero deliberately puts the playable card at the fold and the CTAs
    // just below it, so "in the viewport on load" is not the promise. The
    // promise is that they are whole and pressable once scrolled to.
    await settleOn(play);
    await expectInViewport(page, play, "the primary landing CTA");
    await expectTapTarget(play, "the primary landing CTA");
    await expectTapTarget(credential, "the secondary landing CTA");
    await expectNoOverlap(play, credential, ["the primary landing CTA", "the secondary landing CTA"]);
  });
});
