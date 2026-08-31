import { expect, type Locator, type Page } from "@playwright/test";

/**
 * VISUAL CONTRACTS — the assertions jsdom can never make.
 *
 * [jsdom lists Layout as unimplemented](https://www.npmjs.com/package/jsdom):
 * every box it reports is 0x0 at (0,0). So "is the modal centred", "does the
 * panel sit above the fold", "is that button covered by the card", "is the tap
 * target big enough" are not *failing* questions there — they are UNASKABLE.
 * A component test can therefore be green while the screen is obviously wrong,
 * and this repo has shipped exactly that four times (FRONTEND.md §6.7).
 *
 * Every helper here takes a human-readable `name` and puts it in the failure
 * message, because a geometry failure is only actionable if it says WHICH box
 * was where. Tolerances are stated once, as named constants, never sprinkled.
 */

/**
 * Retry a group of geometric assertions until they hold.
 *
 * A CSS transition in flight is not a layout bug: the judged card takes ~340ms
 * to sail off the confidence panel, and a probe that samples frame one reports
 * the panel as covered. The rule is the same one §6.4 states for navigation —
 * assert the TERMINAL state, never the frame we happened to catch.
 *
 * Only for assertions that describe a resting state. Never wrap
 * `expectScrollStable` or `expectStablePosition` in it: those measure ACROSS an
 * action, and retrying them would silently re-run the action's aftermath.
 */
export async function eventually(assertions: () => Promise<void>, timeout = 5_000): Promise<void> {
  await expect(assertions).toPass({ timeout, intervals: [50, 100, 200, 400] });
}

/** Sub-pixel slack: layout rounds, and 0.5px is never a user-visible bug. */
const EPSILON = 0.5;

/**
 * Wait for the page to STOP moving before a stability contract measures it.
 *
 * Two things settle after "the deck is visible": web fonts (self-hosted by
 * next/font, but still async — a font swap changes every line box), and the
 * deck's own fit-to-viewport pass, which runs from a ResizeObserver. Measure
 * across either and the test is asking about the settling, not about the
 * product. This is the layout twin of §6.4's rule on terminal states.
 */
export async function awaitStableLayout(page: Page, target: Locator, name: string): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
  let previous: string | null = null;
  await expect(async () => {
    const box = JSON.stringify(await target.boundingBox());
    const settled = previous !== null && box === previous;
    previous = box;
    expect(settled, `${name} is still moving (${box})`).toBe(true);
  }).toPass({ timeout: 5_000, intervals: [100, 100, 200, 400] });
}

/**
 * Minimum interactive target, in CSS px. WCAG 2.5.5 (AAA) and the Apple HIG
 * both say 44; WCAG 2.5.8 (AA) says 24. We hold the higher bar because this is
 * a TIMED exam taken on phones — a missed tap is charged to the candidate.
 */
export const MIN_TAP_PX = 44;

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The controls a tap-target contract applies to: things a candidate presses.
 * Inline links inside prose are deliberately excluded — WCAG 2.5.5 exempts
 * text-flow links, and demanding 44px of them would only teach people to
 * suppress the check.
 */
export const TAP_TARGET_SELECTOR =
  'button, [role="button"], [role="tab"], [role="slider"], input[type="checkbox"], input[type="radio"], input[type="range"], summary';

/** The element's box, proven to exist and to have area first. */
export async function boxOf(target: Locator, name: string): Promise<Box> {
  await expect(target, `${name} must be visible before it can be measured`).toBeVisible();
  const box = await target.boundingBox();
  expect(box, `${name} has no layout box at all`).not.toBeNull();
  expect(box!.width, `${name} has zero width`).toBeGreaterThan(0);
  expect(box!.height, `${name} has zero height`).toBeGreaterThan(0);
  return box!;
}

/** The viewport as a box, so the same intersection maths serves both. */
export async function viewportBox(page: Page): Promise<Box> {
  return page.evaluate(() => ({
    x: 0,
    y: 0,
    width: document.documentElement.clientWidth,
    height: window.innerHeight,
  }));
}

function overlapArea(a: Box, b: Box): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > EPSILON && h > EPSILON ? w * h : 0;
}

// ---------------------------------------------------------------------------
// 1. On screen
// ---------------------------------------------------------------------------

/**
 * The element is WHOLLY inside the viewport: not above the fold, not below it,
 * not clipped left or right.
 *
 * The T2 regression this exists for: on a 390x844 phone the page jumped 464px
 * when the confidence step opened and the panel landed ABOVE the fold. Every
 * DOM assertion — visible, in the a11y tree, focused — still passed.
 */
export async function expectInViewport(page: Page, target: Locator, name: string): Promise<Box> {
  const box = await boxOf(target, name);
  const view = await viewportBox(page);
  expect(box.y, `${name} top is above the fold (y=${box.y.toFixed(1)})`).toBeGreaterThanOrEqual(-EPSILON);
  expect(
    box.y + box.height,
    `${name} bottom (${(box.y + box.height).toFixed(1)}) is below the fold (${view.height})`,
  ).toBeLessThanOrEqual(view.height + EPSILON);
  expect(box.x, `${name} is clipped by the left edge (x=${box.x.toFixed(1)})`).toBeGreaterThanOrEqual(-EPSILON);
  expect(
    box.x + box.width,
    `${name} right edge (${(box.x + box.width).toFixed(1)}) is past the viewport (${view.width})`,
  ).toBeLessThanOrEqual(view.width + EPSILON);
  return box;
}

// ---------------------------------------------------------------------------
// 2. Centred
// ---------------------------------------------------------------------------

export interface CentredOptions {
  /** Default "x": a modal that is centred vertically but not horizontally is
   *  the bug in the brief; a page-length dialog top-aligns on purpose. */
  axis?: "x" | "y" | "both";
  /** Centre inside this element instead of the viewport. */
  within?: Locator;
  /** How far off centre is still "centred", in CSS px. */
  tolerancePx?: number;
}

/**
 * The element is centred within its container (viewport by default).
 *
 * This is the brief's own example: a modal that renders in the right-hand
 * corner satisfies every DOM test ever written about it.
 */
export async function expectCentred(
  page: Page,
  target: Locator,
  name: string,
  options: CentredOptions = {},
): Promise<void> {
  const { axis = "x", tolerancePx = 8 } = options;
  const box = await boxOf(target, name);
  const container = options.within ? await boxOf(options.within, `${name}'s container`) : await viewportBox(page);
  const check = (label: "horizontally" | "vertically", pos: number, size: number, cPos: number, cSize: number) => {
    const offset = pos + size / 2 - (cPos + cSize / 2);
    expect(
      Math.abs(offset),
      `${name} is ${Math.abs(offset).toFixed(1)}px off centre ${label} (tolerance ${tolerancePx}px)`,
    ).toBeLessThanOrEqual(tolerancePx);
  };
  if (axis !== "y") check("horizontally", box.x, box.width, container.x, container.width);
  if (axis !== "x") check("vertically", box.y, box.height, container.y, container.height);
}

// ---------------------------------------------------------------------------
// 3. No overlap
// ---------------------------------------------------------------------------

/** Two elements do not share a single pixel. */
export async function expectNoOverlap(a: Locator, b: Locator, names: [string, string]): Promise<void> {
  const boxA = await boxOf(a, names[0]);
  const boxB = await boxOf(b, names[1]);
  expect(
    overlapArea(boxA, boxB),
    `${names[0]} and ${names[1]} overlap: ${JSON.stringify(boxA)} vs ${JSON.stringify(boxB)}`,
  ).toBe(0);
}

/**
 * Nothing PAINTS over the element: it is the topmost visible thing at its own
 * sample points.
 *
 * The dogfood bug: the confidence panel rendered BEHIND the judged card, so on
 * provenance items it was invisible. It was in the DOM, in the a11y tree,
 * correctly sized and focusable — and the candidate was moving a slider they
 * could not see. Only a real browser can answer "what is on top here".
 *
 * Hit-testing alone is not enough: the card that covered the panel had
 * `pointer-events: none`, so `elementFromPoint` would have looked straight
 * through it and reported no problem. So pointer-events are neutralised for
 * the duration of the query, which turns `elementsFromPoint` into a pure
 * PAINT-ORDER probe, and elements that paint nothing (transparent decorative
 * overlays — the deck has one) are stepped over rather than reported.
 */
export async function expectNotOccluded(target: Locator, name: string): Promise<void> {
  const box = await boxOf(target, name);
  // The centre plus four inset quarter-points: one sample can legitimately
  // fall in a gap between the element's own children.
  const points: Array<[number, number]> = [
    [box.x + box.width / 2, box.y + box.height / 2],
    [box.x + box.width * 0.25, box.y + box.height * 0.25],
    [box.x + box.width * 0.75, box.y + box.height * 0.25],
    [box.x + box.width * 0.25, box.y + box.height * 0.75],
    [box.x + box.width * 0.75, box.y + box.height * 0.75],
  ];
  const covered = await target.evaluate((el, pts) => {
    /** Does this element put any ink on the screen where it sits? */
    const paints = (node: Element): boolean => {
      const s = getComputedStyle(node);
      if (s.visibility !== "visible" || s.display === "none") return false;
      for (let p: Element | null = node; p !== null; p = p.parentElement) {
        if (Number(getComputedStyle(p).opacity) < 0.05) return false;
      }
      if (["IMG", "CANVAS", "VIDEO", "INPUT", "SELECT", "TEXTAREA", "SVG"].includes(node.tagName)) return true;
      const alpha = /rgba?\(([^)]*)\)/.exec(s.backgroundColor);
      if (alpha !== null) {
        const parts = alpha[1].split(",").map((v) => Number(v));
        if ((parts[3] ?? 1) > 0.05) return true;
      }
      if (s.backgroundImage !== "none") return true;
      for (const child of Array.from(node.childNodes)) {
        if (child.nodeType === Node.TEXT_NODE && (child.textContent ?? "").trim() !== "") return true;
      }
      return false;
    };

    // Neutralise pointer-events so the probe reports what is PAINTED on top,
    // not what would receive a click. Restored in `finally`, always.
    const saved: Array<[HTMLElement, string]> = [];
    for (const node of Array.from(document.querySelectorAll<HTMLElement>("*"))) {
      saved.push([node, node.style.pointerEvents]);
      node.style.pointerEvents = "auto";
    }
    try {
      const report: string[] = [];
      for (const [x, y] of pts) {
        const stack = document.elementsFromPoint(x, y);
        let verdict: string | null = `(${Math.round(x)},${Math.round(y)}): nothing painted here`;
        for (const hit of stack) {
          if (el.contains(hit)) { verdict = null; break; }
          if (paints(hit)) {
            const h = hit as HTMLElement;
            const s2 = getComputedStyle(h);
            verdict =
              `(${Math.round(x)},${Math.round(y)}): ${h.tagName.toLowerCase()}` +
              `.${h.className || "—"}[testid=${h.dataset.testid ?? "—"}` +
              ` z=${s2.zIndex} bg=${s2.backgroundColor} aria-hidden=${h.getAttribute("aria-hidden") ?? "—"}]`;
            break;
          }
        }
        if (verdict !== null) report.push(verdict);
      }
      return report;
    } finally {
      for (const [node, value] of saved) node.style.pointerEvents = value;
    }
  }, points);
  expect(covered, `${name} is covered by something else at ${covered.join("; ")}`).toEqual([]);
}

/**
 * The element is no taller than `maxPx` — a budget, not a pixel baseline.
 *
 * Written for the sticky site header. On a 390x844 phone it wrapped into
 * three rows and ate 130px of the only screen a first-time visitor gets; the
 * CSS token that was supposed to describe it (`--header-h`) said so in a
 * string, which is exactly the kind of claim a jsdom test can confirm while
 * the rendered header is a different height entirely.
 */
export async function expectMaxHeight(target: Locator, name: string, maxPx: number): Promise<void> {
  const box = await boxOf(target, name);
  expect(
    box.height,
    `${name} is ${box.height.toFixed(0)}px tall, over its ${maxPx}px budget`,
  ).toBeLessThanOrEqual(maxPx + EPSILON);
}

// ---------------------------------------------------------------------------
// 4. Tap targets
// ---------------------------------------------------------------------------

/** One control is at least {@link MIN_TAP_PX} square. */
export async function expectTapTarget(target: Locator, name: string): Promise<void> {
  const box = await boxOf(target, name);
  expect(
    Math.min(box.width, box.height),
    `${name} is ${box.width.toFixed(0)}x${box.height.toFixed(0)}, under the ${MIN_TAP_PX}px tap target`,
  ).toBeGreaterThanOrEqual(MIN_TAP_PX - EPSILON);
}

/**
 * EVERY visible control inside `scope` clears the tap-target floor. Scanning
 * beats naming: a control added tomorrow is covered without editing the test.
 */
export async function expectTapTargets(scope: Locator, name: string): Promise<void> {
  const undersized = await scope.evaluate(
    (root, { selector, min }) => {
      const bad: string[] = [];
      for (const el of Array.from(root.querySelectorAll<HTMLElement>(selector))) {
        // A checkbox inside (or labelled by) a <label> is not the target: the
        // whole label is clickable, and that is what WCAG 2.5.5 measures.
        const target = el.closest("label") ?? el;
        const r = target.getBoundingClientRect();
        // Not rendered at all (closed step, `display:none`) is not a tap
        // target; a control the candidate can see and press is.
        if (r.width === 0 && r.height === 0) continue;
        if (el.closest("[inert]") !== null || el.getAttribute("aria-hidden") === "true") continue;
        if (Math.min(r.width, r.height) >= min - 0.5) continue;
        const name = (el.getAttribute("aria-label") ?? target.textContent ?? "").trim().slice(0, 40);
        bad.push(`${el.tagName.toLowerCase()} "${name}" ${Math.round(r.width)}x${Math.round(r.height)}`);
      }
      return bad;
    },
    { selector: TAP_TARGET_SELECTOR, min: MIN_TAP_PX },
  );
  expect(undersized, `${name} has controls under ${MIN_TAP_PX}px: ${undersized.join(", ")}`).toEqual([]);
}

// ---------------------------------------------------------------------------
// 5. Overflow and scroll
// ---------------------------------------------------------------------------

/**
 * Nothing pushes the document wider than the viewport. A horizontal scrollbar
 * on a phone is the single loudest "this was never opened on a phone" signal,
 * and it is invisible to every DOM test.
 *
 * On failure it names the widest offending element, because "the page is 40px
 * too wide" without a culprit is a bisect, not a bug report.
 */
export async function expectNoHorizontalOverflow(page: Page, name: string): Promise<void> {
  const report = await page.evaluate(() => {
    const root = document.documentElement;
    const limit = root.clientWidth;
    const offenders: string[] = [];
    for (const el of Array.from(document.body.querySelectorAll<HTMLElement>("*"))) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.right <= limit + 1) continue;
      // An element only overflows the PAGE if no ancestor clips or scrolls it.
      let clipped = false;
      for (let p = el.parentElement; p !== null; p = p.parentElement) {
        const o = getComputedStyle(p).overflowX;
        if (o !== "visible") { clipped = true; break; }
      }
      if (clipped) continue;
      offenders.push(`${el.tagName.toLowerCase()}.${el.className || "—"} right=${Math.round(r.right)}`);
    }
    return { scrollWidth: root.scrollWidth, clientWidth: limit, offenders: offenders.slice(0, 5) };
  });
  expect(
    report.scrollWidth,
    `${name} scrolls horizontally (${report.scrollWidth} > ${report.clientWidth}); widest culprits: ${report.offenders.join(", ") || "none found"}`,
  ).toBeLessThanOrEqual(report.clientWidth + 1);
}

/**
 * Run `action` and prove the page did not scroll, and did not change height,
 * underneath it.
 *
 * The T2 phone regression in one assertion: opening the confidence step used
 * to move the document by 464px. Height is checked too, because a transition
 * that grows the page has already lost — the scroll is just the symptom.
 */
export async function expectScrollStable(
  page: Page,
  name: string,
  action: () => Promise<void>,
  // Scroll anchoring is allowed a pixel or two: the browser deliberately
  // moves `scrollY` to keep the PIXELS still when content resolves above the
  // viewport, and charging that to the app would be charging it for doing the
  // right thing. Pair this with {@link expectStablePosition}, which asks the
  // question the candidate actually experiences.
  tolerancePx = EPSILON,
): Promise<void> {
  const before = await page.evaluate(() => ({ y: window.scrollY, h: document.documentElement.scrollHeight }));
  await action();
  const after = await page.evaluate(() => ({ y: window.scrollY, h: document.documentElement.scrollHeight }));
  expect(
    Math.abs(after.y - before.y),
    `${name} scrolled the page from ${before.y} to ${after.y} (tolerance ${tolerancePx}px)`,
  ).toBeLessThanOrEqual(tolerancePx);
  expect(
    after.h,
    `${name} changed the document height from ${before.h} to ${after.h} — the page will jump`,
  ).toBeCloseTo(before.h, 0);
}

// ---------------------------------------------------------------------------
// 6. Clipped text
// ---------------------------------------------------------------------------

/**
 * The element's own content fits inside it — or, where it does not, the
 * element is genuinely scrollable.
 *
 * `overflow: hidden` plus content taller than the box is a silent truncation:
 * the words are in the DOM, `toBeVisible()` passes, and the candidate reads
 * half a sentence.
 */
export async function expectTextNotClipped(target: Locator, name: string): Promise<void> {
  await expect(target, `${name} must be visible before it can be measured`).toBeVisible();
  const clipped = await target.evaluate((el) => {
    const s = getComputedStyle(el);
    const hidden = (o: string) => o === "hidden" || o === "clip";
    const out: string[] = [];
    if (hidden(s.overflowX) && el.scrollWidth > el.clientWidth + 1) {
      out.push(`horizontally (${el.scrollWidth} > ${el.clientWidth})`);
    }
    if (hidden(s.overflowY) && el.scrollHeight > el.clientHeight + 1) {
      out.push(`vertically (${el.scrollHeight} > ${el.clientHeight})`);
    }
    return out;
  });
  expect(clipped, `${name} clips its own content ${clipped.join(" and ")}`).toEqual([]);
}

/**
 * The element's content fits INSIDE it without scrolling — even where the
 * element is legitimately scrollable.
 *
 * Weaker than "not clipped" and stronger than "reachable": T2's confidence
 * step is `overflow: auto`, so a squeezed panel would technically be readable,
 * and a step the candidate has to scroll INSIDE on a timed, scored item is the
 * same failure as a page that scrolls. That is the deck's own DECK_MIN_H
 * invariant (packages/tracks/t2-discrimination/src/SwipeDeck.tsx), and nothing
 * outside a real browser can check it.
 */
export async function expectNoInnerScroll(target: Locator, name: string): Promise<void> {
  await expect(target, `${name} must be visible before it can be measured`).toBeVisible();
  const over = await target.evaluate((el) => ({
    x: el.scrollWidth - el.clientWidth,
    y: el.scrollHeight - el.clientHeight,
  }));
  expect(over.y, `${name} needs ${over.y}px of internal scrolling to be read`).toBeLessThanOrEqual(1);
  expect(over.x, `${name} needs ${over.x}px of internal sideways scrolling`).toBeLessThanOrEqual(1);
}

/**
 * `outer` completely contains `inner` — a veil really veils.
 *
 * The pause overlay's whole job is to hide a timed workspace. An overlay that
 * is merely "visible and centred" can still leave a strip of the deck showing
 * down one side, which is a fairness bug, not a cosmetic one.
 */
export async function expectCovers(
  outer: Locator,
  inner: Locator,
  names: [string, string],
  // The runner frame carries a 1px border of its own, and an inset:0 veil
  // covers the padding box: a one-pixel rule is chrome, not a peephole.
  slack = EPSILON,
): Promise<void> {
  const o = await boxOf(outer, names[0]);
  const i = await boxOf(inner, names[1]);
  const gaps: string[] = [];
  if (o.x > i.x + slack) gaps.push(`left by ${(o.x - i.x).toFixed(1)}px`);
  if (o.y > i.y + slack) gaps.push(`top by ${(o.y - i.y).toFixed(1)}px`);
  if (o.x + o.width < i.x + i.width - slack) gaps.push(`right by ${(i.x + i.width - o.x - o.width).toFixed(1)}px`);
  if (o.y + o.height < i.y + i.height - slack) gaps.push(`bottom by ${(i.y + i.height - o.y - o.height).toFixed(1)}px`);
  expect(gaps, `${names[0]} does not cover ${names[1]}: short on the ${gaps.join(", ")}`).toEqual([]);
}

/**
 * The element occupies the SAME place on screen after `action` as before it.
 *
 * Stricter than {@link expectScrollStable} where it matters, and honest where
 * that one is not: a browser's scroll anchoring deliberately CHANGES
 * `window.scrollY` in order to keep the pixels still, so "scrollY did not
 * move" is neither necessary nor sufficient for "nothing jumped". What the
 * candidate experiences is whether the thing they are looking at stayed put.
 */
export async function expectStablePosition(
  target: Locator,
  name: string,
  action: () => Promise<void>,
  tolerancePx = 1,
): Promise<void> {
  const before = await boxOf(target, name);
  await action();
  const after = await boxOf(target, name);
  const moved = Math.max(Math.abs(after.x - before.x), Math.abs(after.y - before.y));
  const resized = Math.max(Math.abs(after.width - before.width), Math.abs(after.height - before.height));
  expect(moved, `${name} moved ${moved.toFixed(1)}px on screen: ${JSON.stringify(before)} → ${JSON.stringify(after)}`)
    .toBeLessThanOrEqual(tolerancePx);
  expect(
    resized,
    `${name} changed size by ${resized.toFixed(1)}px: ${JSON.stringify(before)} → ${JSON.stringify(after)}`,
  ).toBeLessThanOrEqual(tolerancePx);
}
