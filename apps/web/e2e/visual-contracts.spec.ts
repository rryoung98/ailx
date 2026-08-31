import { test, expect, type Locator, type Page } from "@playwright/test";
import {
  expectCentred,
  expectCovers,
  expectInViewport,
  expectNoHorizontalOverflow,
  expectNoInnerScroll,
  expectNoOverlap,
  expectNotOccluded,
  expectScrollStable,
  expectStablePosition,
  expectTapTarget,
  expectTapTargets,
  expectTextNotClipped,
} from "./visual";

/**
 * THE CONTRACTS' OWN TESTS — proof that each visual contract can FAIL.
 *
 * Twice now this repo has shipped a test that could not fail: a fault injector
 * that stopped faulting anything when the code it patched moved, and a
 * redirect assertion that passed through an infinite loop. Both were green for
 * hours (FRONTEND.md §6.7). A contract that never bites is worse than no
 * contract, because it also spends the reviewer's trust.
 *
 * So every helper in `visual.ts` is mutation-tested here, in both directions,
 * against a synthetic page whose layout is under this file's control: the good
 * layout passes, and one deliberate break per contract fails. This runs in the
 * normal suite — it is the regression test for the test layer itself, and it
 * needs no server, no database and no seeded deck.
 */

/**
 * Assert that a contract REJECTS, and that it says why.
 *
 * `run` returns `unknown` because some contracts hand back the box they
 * measured; what is under test is the throw, never the value.
 */
async function expectContractToFail(run: () => Promise<unknown>, saying: RegExp): Promise<void> {
  let message: string | null = null;
  try {
    await run();
  } catch (err) {
    message = err instanceof Error ? err.message : String(err);
  }
  expect(message, "the contract passed a layout it was written to reject").not.toBeNull();
  expect(message!).toMatch(saying);
}

const PAGE_CSS = `
  * { box-sizing: border-box; }
  body { margin: 0; font: 16px/1.4 system-ui, sans-serif; }
  #stage { position: relative; height: 100vh; }
  .modal {
    position: absolute; width: 300px; height: 200px; background: #fff;
    border: 1px solid #333;
  }
  .centred { left: calc(50% - 150px); top: calc(50% - 100px); }
  .corner  { right: 8px; bottom: 8px; }
  .target { width: 48px; height: 48px; }
  .tiny   { width: 20px; height: 20px; }
`;

/** The good layout: a centred modal, a big button, nothing off screen. */
async function goodLayout(page: Page): Promise<void> {
  await page.setContent(`<style>${PAGE_CSS}</style>
    <div id="stage">
      <div class="modal centred" data-t="modal"><p>Centred popup</p></div>
      <button class="target" data-t="button">OK</button>
      <div data-t="box" style="width:200px;height:60px;overflow:hidden">short</div>
      <div data-t="other" style="position:absolute;left:0;top:0;width:80px;height:40px">other</div>
    </div>`);
}

const at = (page: Page, name: string): Locator => page.locator(`[data-t="${name}"]`);

test.describe("visual contracts bite", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 600 });
  });

  test("a good layout satisfies every contract", async ({ page }) => {
    await goodLayout(page);
    await expectInViewport(page, at(page, "modal"), "modal");
    await expectCentred(page, at(page, "modal"), "modal", { axis: "both" });
    await expectNoOverlap(at(page, "modal"), at(page, "other"), ["modal", "other"]);
    await expectNotOccluded(at(page, "modal"), "modal");
    await expectTapTarget(at(page, "button"), "OK button");
    await expectTapTargets(page.locator("#stage"), "the stage");
    await expectNoHorizontalOverflow(page, "the stage");
    await expectTextNotClipped(at(page, "box"), "the box");
    await expectNoInnerScroll(at(page, "box"), "the box");
    await expectScrollStable(page, "doing nothing", async () => {});
    await expectStablePosition(at(page, "modal"), "modal", async () => {});
    await expectCovers(page.locator("#stage"), at(page, "modal"), ["the stage", "modal"]);
  });

  test("mutation: a veil that leaves a strip uncovered is caught", async ({ page }) => {
    await goodLayout(page);
    await at(page, "other").evaluate((el: HTMLElement) => {
      el.style.cssText = "position:absolute;left:0;top:0;width:100px;height:600px";
    });
    await expectContractToFail(
      () => expectCovers(at(page, "other"), at(page, "modal"), ["the veil", "modal"]),
      /does not cover/,
    );
  });

  test("mutation: an element that jumps on screen is caught even without a scroll", async ({ page }) => {
    await goodLayout(page);
    await expectContractToFail(
      () =>
        expectStablePosition(at(page, "modal"), "modal", async () => {
          await at(page, "modal").evaluate((el: HTMLElement) => (el.style.top = "40px"));
        }),
      /moved \d/,
    );
  });

  test("mutation: an element that resizes under the candidate is caught", async ({ page }) => {
    await goodLayout(page);
    await expectContractToFail(
      () =>
        expectStablePosition(at(page, "modal"), "modal", async () => {
          await at(page, "modal").evaluate((el: HTMLElement) => (el.style.height = "99px"));
        }),
      /changed size/,
    );
  });

  test("mutation: a modal above the fold is caught", async ({ page }) => {
    await goodLayout(page);
    await at(page, "modal").evaluate((el: HTMLElement) => (el.style.top = "-120px"));
    await expectContractToFail(() => expectInViewport(page, at(page, "modal"), "modal"), /above the fold/);
  });

  test("mutation: a modal below the fold is caught", async ({ page }) => {
    await goodLayout(page);
    await at(page, "modal").evaluate((el: HTMLElement) => (el.style.top = "520px"));
    await expectContractToFail(() => expectInViewport(page, at(page, "modal"), "modal"), /below the fold/);
  });

  test("mutation: the brief's own bug — a corner modal instead of a centred one", async ({ page }) => {
    await goodLayout(page);
    await at(page, "modal").evaluate((el: HTMLElement) => el.classList.replace("centred", "corner"));
    // It is still visible, still in the a11y tree, still the right size: every
    // DOM assertion about it passes.
    await expect(at(page, "modal")).toBeVisible();
    await expectContractToFail(
      () => expectCentred(page, at(page, "modal"), "modal", { axis: "both" }),
      /off centre horizontally/,
    );
  });

  test("mutation: two elements that overlap are caught", async ({ page }) => {
    await goodLayout(page);
    await at(page, "other").evaluate((el: HTMLElement) => {
      el.style.left = "300px";
      el.style.top = "250px";
    });
    await expectContractToFail(
      () => expectNoOverlap(at(page, "modal"), at(page, "other"), ["modal", "other"]),
      /overlap/,
    );
  });

  test("mutation: an element rendered BEHIND another is caught", async ({ page }) => {
    await goodLayout(page);
    // The dogfood bug, reproduced: a cover painted over the panel. The panel
    // is visible(), has a box, has content — and the user cannot see it.
    await page.locator("#stage").evaluate((el: HTMLElement) => {
      const cover = document.createElement("div");
      cover.style.cssText = "position:absolute;inset:0;background:#fff;z-index:9";
      el.appendChild(cover);
    });
    await expect(at(page, "modal")).toBeVisible();
    await expectContractToFail(() => expectNotOccluded(at(page, "modal"), "modal"), /covered by/);
  });

  test("mutation: a cover with pointer-events:none is STILL caught", async ({ page }) => {
    await goodLayout(page);
    // The exact shape of the T2 bug: the judged card sat over the confidence
    // step but did not take clicks, so a hit test looked straight through it.
    // The contract is about what is PAINTED, not about what is clickable.
    await page.locator("#stage").evaluate((el: HTMLElement) => {
      const cover = document.createElement("div");
      cover.style.cssText = "position:absolute;inset:0;background:#fff;z-index:9;pointer-events:none";
      el.appendChild(cover);
    });
    await expectContractToFail(() => expectNotOccluded(at(page, "modal"), "modal"), /covered by/);
  });

  test("a transparent decorative overlay is not mistaken for a cover", async ({ page }) => {
    await goodLayout(page);
    // The deck really does put one of these over the card (the verdict badge
    // layer). A contract that flagged it would be turned off within a week.
    await page.locator("#stage").evaluate((el: HTMLElement) => {
      const veil = document.createElement("div");
      veil.style.cssText = "position:absolute;inset:0;z-index:9;pointer-events:none";
      el.appendChild(veil);
    });
    await expectNotOccluded(at(page, "modal"), "modal");
  });

  test("mutation: an undersized tap target is caught, one control and by scan", async ({ page }) => {
    await goodLayout(page);
    await at(page, "button").evaluate((el: HTMLElement) => el.classList.replace("target", "tiny"));
    await expectContractToFail(() => expectTapTarget(at(page, "button"), "OK button"), /under the 44px tap target/);
    await expectContractToFail(
      () => expectTapTargets(page.locator("#stage"), "the stage"),
      /controls under 44px/,
    );
  });

  test("mutation: horizontal overflow is caught and the culprit named", async ({ page }) => {
    await goodLayout(page);
    await at(page, "box").evaluate((el: HTMLElement) => (el.style.width = "1600px"));
    await expectContractToFail(() => expectNoHorizontalOverflow(page, "the stage"), /scrolls horizontally/);
  });

  test("mutation: a scroll jump across a transition is caught", async ({ page }) => {
    await goodLayout(page);
    await page.locator("#stage").evaluate((el: HTMLElement) => (el.style.height = "3000px"));
    await expectContractToFail(
      () =>
        expectScrollStable(page, "opening the step", async () => {
          await page.evaluate(() => window.scrollTo(0, 464));
        }),
      /scrolled the page from 0 to 464/,
    );
  });

  test("mutation: a growing document is caught even without a scroll", async ({ page }) => {
    await goodLayout(page);
    await expectContractToFail(
      () =>
        expectScrollStable(page, "opening the step", async () => {
          await at(page, "box").evaluate((el: HTMLElement) => (el.style.height = "2000px"));
        }),
      /changed the document height/,
    );
  });

  test("mutation: text clipped by its own container is caught", async ({ page }) => {
    await goodLayout(page);
    await at(page, "box").evaluate((el: HTMLElement) => {
      el.textContent = "a sentence long enough to need three lines in a box this narrow, ".repeat(4);
    });
    await expect(at(page, "box")).toBeVisible();
    await expectContractToFail(() => expectTextNotClipped(at(page, "box"), "the box"), /clips its own content/);
  });

  test("mutation: a container the user must scroll inside is caught", async ({ page }) => {
    await goodLayout(page);
    await at(page, "box").evaluate((el: HTMLElement) => {
      el.style.overflow = "auto";
      el.textContent = "a sentence long enough to need three lines in a box this narrow, ".repeat(4);
    });
    await expectContractToFail(
      () => expectNoInnerScroll(at(page, "box"), "the box"),
      /internal scrolling/,
    );
  });

  test("a scrollable container is not reported as clipping", async ({ page }) => {
    await goodLayout(page);
    await at(page, "box").evaluate((el: HTMLElement) => {
      el.style.overflow = "auto";
      el.textContent = "a sentence long enough to need three lines in a box this narrow, ".repeat(4);
    });
    await expectTextNotClipped(at(page, "box"), "the box");
  });
});
