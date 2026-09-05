import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/**
 * Shared mobile containment layer — regression for the live-dogfood report:
 * at 390x844 the T1 design-rationale textarea overflowed its card and the
 * submit button escaped the card entirely (landing over the footer rule and
 * the spec §13 disclaimer). The app layer now guarantees, for EVERY runner
 * and page: form controls stay inside their card, grid/flex children are
 * shrinkable, phone inputs render >= 16px (no iOS zoom-jump), and coarse
 * pointers get >= 44px targets.
 */
const css = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../app/globals.css"),
  "utf8",
);

describe("globals.css shared mobile containment layer", () => {
  it("form controls inside main are box-sized and capped to their container", () => {
    const layer = css.slice(css.indexOf("Mobile card containment (shared layer)"));
    expect(layer).toContain("max-width: 100%;");
    expect(layer).toContain("box-sizing: border-box;");
    expect(layer).toContain("min-width: 0;");
    expect(layer).toMatch(/main textarea,\s*main input,\s*main select \{/);
  });

  it("sections and cards are shrinkable grid/flex children", () => {
    const layer = css.slice(css.indexOf("Mobile card containment (shared layer)"));
    expect(layer).toMatch(/main section,\s*main \.card \{\s*min-width: 0;/);
  });

  it("phone inputs render >= 16px so iOS Safari does not zoom-jump", () => {
    const layer = css.slice(css.indexOf("Mobile card containment (shared layer)"));
    const mobile = layer.slice(layer.indexOf("@media (max-width: 900px)"));
    expect(mobile).toContain("font-size: 16px !important;");
  });

  it("resizable textareas are clamped and lose the drag handle on touch", () => {
    const layer = css.slice(css.indexOf("Mobile card containment (shared layer)"));
    expect(layer).toMatch(/main textarea \{\s*resize: vertical;\s*max-height: 60vh;/);
    expect(layer).toContain("resize: none !important;");
  });

  it("coarse pointers get >= 44px buttons", () => {
    const layer = css.slice(css.indexOf("Mobile card containment (shared layer)"));
    const coarse = layer.slice(layer.indexOf("@media (pointer: coarse)"));
    expect(coarse).toContain("min-height: 44px;");
  });

  /**
   * At 390px the share page's "How the run was shaped" heading printed
   * straight through the absolutely positioned "AILX" share-card watermark.
   * Everything that can reach the card's top-right corner keeps room for it.
   */
  it("share-card watermark keeps clearance from the eyebrow AND the heading", () => {
    expect(css).toMatch(/\.share-card \.eyebrow,\s*\.share-card h2 \{ padding-right: 3\.6rem; \}/);
  });

  /**
   * Inline grid columns cannot be answered by a media query inside the
   * component that wrote them, so the app layer collapses ALL of them, not
   * just the track runners'. /report's per-track rubric rows
   * (minmax(10rem, 1fr) 2fr 6.5rem) gave a 320px viewport a 331px
   * scrollWidth, clipped the max score mid-number and left a 2px meter.
   */
  /**
   * /methodology's Bias/Magnitude/Mitigation table was 316px wide in a 320px
   * viewport with no scroll container: the DOCUMENT scrolled sideways
   * (scrollWidth 332) and words were cut in half ("Randomised position
   * withi"). A table's min-content width is the sum of its columns, so no
   * wrapping rule can save it — it needs its own scroller.
   */
  it("a wide table scrolls itself on a phone instead of scrolling the page", () => {
    const at = css.indexOf("main table {");
    expect(at).toBeGreaterThan(-1);
    const rule = css.slice(at, css.indexOf("}", at));
    expect(rule).toContain("display: block;");
    expect(rule).toContain("overflow-x: auto;");
    expect(css.slice(css.lastIndexOf("@media", at), at)).toContain("max-width: 700px");
  });

  /**
   * The pill CTA is fixed, so it reserves no space and the end of a page came
   * to rest under it: /exam at 1440x900 read "T3 — t[pill]h them." at scroll
   * top, and / at 390x844 read "Scor[pill]ment." for "Scored like an
   * instrument."
   */
  it("a page that shows the floating pill reserves room for it", () => {
    expect(css).toMatch(/body:has\(\.pill-cta\) main\.page \{\s*padding-bottom: 6rem;/);
  });

  it("every inline grid inside main collapses to one column on phones", () => {
    expect(css).toContain('main [style*="grid-template-columns"] { grid-template-columns: 1fr !important; }');
    // Scoped to the phone query, not global.
    const at = css.indexOf('main [style*="grid-template-columns"]');
    expect(css.slice(css.lastIndexOf("@media", at), at)).toContain("max-width: 700px");
  });
});
