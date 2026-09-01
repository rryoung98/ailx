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
import { REQUIRES_SERVICE, hasExamService } from "./service";
import { samplePracticeDeck } from "@ailx/report";
import {
  awaitStableLayout,
  eventually,
  expectCentred,
  expectInViewport,
  expectMaxHeight,
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

/** Fixed seed for the stubbed practice deal, so the deck is the same deck. */
const PRACTICE_SESSION = "e2e-landing-drill";

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
  // `scrollIntoView({ block: "nearest" })` and not Playwright's
  // `scrollIntoViewIfNeeded()`: that one is satisfied by a visibility RATIO,
  // so it leaves an element hanging a pixel or two off the edge — which is
  // precisely the state the contract after it is meant to judge. `instant`
  // because the document is `scroll-behavior: smooth` and a smooth scroll
  // would still be moving when the next assertion measures.
  await target.evaluate((el) => el.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" }));
}

/**
 * Scroll it into view and prove it is WHOLE there — retried as one unit.
 *
 * Separate steps would be a race: the landing page reflows as its serif face
 * and its scroll-driven sections resolve, so a scroll that was correct when
 * it was made can be stale by the time the box is measured. Retrying the
 * pair asks the only question that matters — can the candidate get to the
 * whole of this thing — and never the question "was one frame right".
 */
async function settleAndSee(page: Page, target: Locator, name: string): Promise<void> {
  await eventually(async () => {
    await settleOn(target);
    await expectInViewport(page, target, name);
  });
}

async function startDeck(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Start the deck" }).click();
  await expect(answerButtons(page).first()).toBeVisible();
  // The deck sizes itself to the viewport from a ResizeObserver, and the
  // serif face lands a beat after first paint. Both move the page, and both
  // are the harness settling rather than the product jumping.
  await awaitStableLayout(page, deckFrame(page), "the deck frame");
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
interface StepGeometryOptions {
  /** A touch viewport, where the 44px tap-target floor applies. */
  coarsePointer: boolean;
}

async function assertConfidenceStepGeometry(page: Page, where: string, options: StepGeometryOptions): Promise<void> {
  await eventually(async () => {
    const sheet = confidenceSheet(page);
    // The panel fills the CARD frame exactly (Runner.tsx: `position:absolute;
    // inset:0` inside SwipeDeck's card box), and the card box sits a few
    // pixels above the fold whenever the harness has scrolled the answer row
    // to the bottom edge — so the promise is not "on screen wherever the page
    // happens to be", it is "whole and reachable". Settle first, then demand
    // the whole panel: that is the 390x844 regression, where the page jumped
    // 464px and the panel could not be reached at all.
    await settleOn(sheet);
    await expectInViewport(page, sheet, `the confidence step (${where})`);
    // The dogfood regression: on provenance items it rendered behind the card.
    await expectNotOccluded(sheet, `the confidence step (${where})`);
    // The brief's own bug: a modal that is a corner panel. Measured against
    // the DECK, not the viewport, and horizontally only: the panel stands in
    // for the card it is about, and the deck element is taller than the card
    // box by the answer row beneath it. The deck itself is drawn with a
    // stacked-card overhang, so it is not page-centred and never claims to be.
    await expectCentred(page, sheet, `the confidence step (${where})`, { within: deckFrame(page) });
    // Nothing is silently truncated, anywhere.
    await expectTextNotClipped(sheet, `the confidence step (${where})`);
    // A step you must scroll inside is the same failure as a page that scrolls.
    await expectNoInnerScroll(sheet, `the confidence step (${where})`);
    // Tap targets are a TOUCH promise, and the app keeps it with
    // `@media (pointer: coarse)`: Lock in is a 37px `.btn.small-btn` under a
    // mouse and 44px under a finger. Demanding 44px of the desktop build
    // would be demanding the CSS be wrong.
    if (options.coarsePointer) await expectTapTargets(sheet, `the confidence step (${where})`);
    await expectInViewport(page, lockInButton(page), `the Lock in button (${where})`);
    await expectNoHorizontalOverflow(page, `the exam page (${where})`);
  });
}

for (const [label, viewport] of [
  ["desktop", null],
  ["390x844 phone", PHONE],
] as const) {
  test.describe(`T2 confidence step · ${label}`, () => {
    // Seeds a run, so it needs the exam service. GRANULAR skip: the landing
    // contracts below seed nothing and must keep running without one.
    test.skip(!hasExamService(), REQUIRES_SERVICE);
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
      await expectScrollStable(
        page,
        `opening the confidence step (${label})`,
        async () => {
          await expectStablePosition(deckFrame(page), `the deck frame (${label})`, async () => {
            await answerButtons(page).first().click();
            await expect(confidenceDialog(page)).toBeVisible();
          });
        },
        // Scroll anchoring: opening the step resolves content above the
        // viewport, so the browser shifts `scrollY` by a pixel or two in order
        // to keep the deck where it is. The deck-frame contract nested inside
        // is the one that proves nothing actually moved.
        4,
      );
      await assertConfidenceStepGeometry(page, label, { coarsePointer: viewport !== null });

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
      await assertConfidenceStepGeometry(page, `${label}, provenance item`, {
        coarsePointer: viewport !== null,
      });
    });
  });
}

test.describe("exam overlays", () => {
  // Seeds a run, so it needs the exam service. GRANULAR skip: the landing
  // contracts below seed nothing and must keep running without one.
  test.skip(!hasExamService(), REQUIRES_SERVICE);
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
    // Retried as a group (§6.4): the deck under the veil is still settling
    // when the veil appears, and the veil is `inset: 0` of a frame that is
    // still finding its height — a probe that samples frame one reports a
    // strip the candidate never sees.
    await eventually(async () => {
      // The veil's whole job: cover the timed workspace completely. It may be
      // taller than the fold — the workspace is — so "wholly in the viewport"
      // would be the wrong question; "no strip of the deck showing" is the
      // right one, and its own control must still be reachable.
      await expectCovers(paused, runnerFrame(page), ["the pause overlay", "the runner workspace"], 1);
      await expectCentred(page, paused, "the pause overlay", {
        within: runnerFrame(page),
        axis: "both",
        tolerancePx: 1,
      });
      await expectNotOccluded(paused, "the pause overlay");
    });
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
  // Seeds a run, so it needs the exam service. GRANULAR skip: the landing
  // contracts below seed nothing and must keep running without one.
  test.skip(!hasExamService(), REQUIRES_SERVICE);
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
    await settleAndSee(page, finish, "the T1 finish step");
    await expectNotOccluded(finish, "the T1 finish step");
    await expectTapTargets(finish, "the T1 finish step");
    const confirm = finish.getByRole("button", { name: "Yes, submit final artifact" });
    const keep = finish.getByRole("button", { name: "Keep working" });
    // Forfeiting the clock and carrying on must never be one mis-tap apart.
    await expectNoOverlap(confirm, keep, ["the submit button", "the Keep working button"]);
    await expectInViewport(page, confirm, "the T1 submit confirmation");
    await expectNoHorizontalOverflow(page, "the T1 workspace");
  });

  // NOT covered: T4's finish step. In hosted mode (`AILX_BACKEND=1`, which is
  // the only mode this suite runs) the T4 runner deals its content from
  // `GET /attempts/:id/track/t4`, and this app serves no such route — the
  // track opens on "your T4 content could not be loaded from the server:
  // … 404" and the finish step is unreachable. T1 has a local fallback, which
  // is why its step IS covered above. Restore the T4 case with the route.
});

test.describe("share view", () => {
  // Seeds a run, so it needs the exam service. GRANULAR skip: the landing
  // contracts below seed nothing and must keep running without one.
  test.skip(!hasExamService(), REQUIRES_SERVICE);
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

  /**
   * The sticky header's budget on a phone, in CSS px. It is chrome on EVERY
   * page, so a header that wraps into three rows spends the visitor's first
   * screen before the page has said anything. 66px is the desktop token; the
   * phone row is the same height plus the sticky border, and anything past
   * this is a wrap.
   */
  const HEADER_BUDGET_PX = 72;

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
    await settleAndSee(page, play, "the primary landing CTA");
    await expectTapTarget(play, "the primary landing CTA");
    await expectTapTarget(credential, "the secondary landing CTA");
    await expectNoOverlap(play, credential, ["the primary landing CTA", "the secondary landing CTA"]);
  });

  test("the sticky header stays one row, here and on every other page", async ({ page }) => {
    // Layout-wide chrome, so it is checked on more than the page that pays
    // for it: the same header wraps or does not wrap everywhere.
    for (const path of ["/", "/methodology"]) {
      await page.goto(path);
      await expectMaxHeight(page.locator("header.site-header"), `the site header (${path})`, HEADER_BUDGET_PX);
      await expectNoHorizontalOverflow(page, `the page chrome (${path})`);
    }
  });

  test("the hero drill is playable: whole, big enough, and nothing printed over it", async ({ page }) => {
    // Deal a deterministic deck in the browser instead of over the network.
    // The e2e app is a SERVER build, so the drill asks the exam service for a
    // deck; with no service it renders its honest failure state and there is
    // nothing to measure. This contract is about GEOMETRY, so the deal is
    // stubbed and the geometry keeps being asserted with no backend at all —
    // the alternative was skipping it, and a landing contract that only runs
    // where a private service exists is a contract that never runs.
    await page.route("**/practice", async (route) =>
      route.fulfill({ json: { session: { id: PRACTICE_SESSION, itemIds: samplePracticeDeck(PRACTICE_SESSION) } } }),
    );
    await page.goto("/");
    const drill = page.locator(".hero-play");
    await settleAndSee(page, drill, "the hero drill");

    const answers = drill.locator("button");
    await expect(answers).toHaveCount(2);
    for (let i = 0; i < 2; i++) {
      const answer = answers.nth(i);
      const name = `hero drill answer ${i + 1}`;
      await settleAndSee(page, answer, name);
      await expectTapTarget(answer, name);
      // The fixed bottom pill used to print straight across both answers.
      // `expectNotOccluded` is the right question and not `expectNoOverlap`:
      // the pill clears itself by going transparent over `[data-pill-clear]`
      // (app/page.tsx), and a pill that paints nothing is not in the way.
      // Retried, because that clearing is a 200ms fade and the frame it
      // starts on is not the state the visitor sits in.
      await eventually(() => expectNotOccluded(answer, name));
    }
    await expectTapTargets(drill, "the hero drill");
  });
});

test.describe("landing cast strip · 390x844 phone", () => {
  test.use({ viewport: PHONE, hasTouch: true, isMobile: true, contextOptions: { reducedMotion: "reduce" } });

  /**
   * The sixteen faces are the identity payoff, and sixteen fixed-width tiles
   * next to a text column is exactly the shape that pushes a page sideways.
   * jsdom counts the tiles and reads their codes; only a layout engine can
   * say whether the row wrapped, whether a face is whole, and whether the
   * fixed bottom pill paints across them.
   */
  test("the cast row wraps instead of pushing the page sideways", async ({ page }) => {
    await page.goto("/");
    const row = page.locator(".cast .cast-row");
    await settleAndSee(page, row, "the cast row");
    await expectNoHorizontalOverflow(page, "the landing page (cast strip)");
    await expectNoInnerScroll(row, "the cast row");
  });

  test("every face is whole, and the pill does not print over the last row", async ({ page }) => {
    await page.goto("/");
    const tiles = page.locator(".cast .cast-tile");
    await expect(tiles).toHaveCount(16);
    // First and last only: the contract is "the row is not clipped at either
    // end", and measuring all sixteen buys nothing but minutes.
    for (const [tile, name] of [
      [tiles.first(), "the first character tile"],
      [tiles.last(), "the last character tile"],
    ] as const) {
      await settleAndSee(page, tile, name);
      await eventually(() => expectNotOccluded(tile, name));
    }
  });

  test("the sample-card link is reachable and nothing paints over it", async ({ page }) => {
    await page.goto("/");
    const link = page.locator(".cast .cast-more a");
    await settleAndSee(page, link, "the sample card link");
    // NOT expectTapTarget: this is a quiet in-body text link, the same shape
    // as the funnel's "Practise the tells" links, and holding it to 44x44
    // would be a rule this page does not follow anywhere else. What it must
    // be is whole and unpainted-over, which is what is asserted.
    await eventually(() => expectNotOccluded(link, "the sample card link"));
  });
});

test.describe("landing hero · desktop", () => {
  // NOT reduced motion, and wide: the paper artifacts are `display: none`
  // both under `prefers-reduced-motion: reduce` and under 700px, so a phone
  // run cannot ask this question at all.
  test.use({ viewport: { width: 1280, height: 900 } });

  test("the paper decoration never prints over the hero copy", async ({ page }) => {
    await page.goto("/");
    // Retried: the green `.loader` splash really does cover the hero for its
    // first ~850ms, on purpose. The resting state is the one to assert (§6.4)
    // — and this is also the contract proving the splash always leaves.
    await eventually(async () => {
      await expectNotOccluded(page.locator("p.hero-lede"), "the hero lede");
      await expectNotOccluded(page.locator("h1.hero-title"), "the hero headline");
    });
    await expectNoHorizontalOverflow(page, "the landing page (desktop)");
  });
});
