import { describe, expect, it } from "vitest";
import { statSync, existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { loadBank } from "../src/loader.js";

/**
 * Regression tests for the T2 real-vs-AI media deck (material kind "image").
 * Every `src` referenced by the bank must exist under apps/web/public and
 * stay within the 200 KB asset budget; every shipped asset must be referenced.
 */
const REPO = resolve(__dirname, "..", "..", "..");
/**
 * The shipped t2-media pool serves BOTH tiers, but only one of them is in this
 * repository: the operational bank moved to the private backend repo, and the
 * media BYTES stayed here because the browser has to fetch them (the custody
 * gap the private README states plainly). So the pool is a superset of what
 * this bank references, and "every shipped asset is referenced" can only be
 * checked where both trees exist — nowhere, today. What is still checked here
 * is every property of an asset that does not need the other bank: the naming
 * rule, the 200 KB budget, and the released deck's own references.
 */
const DEMO_TRACK_DIR = join(REPO, "instruments", "demo-2026.1", "tracks", "t2-discrimination");
const PUBLIC_DIR = join(REPO, "apps", "web", "public");
const MEDIA_DIR = join(PUBLIC_DIR, "t2-media");

interface ImageMaterial { kind: string; src?: string; alt?: string }

describe("t2 media assets", () => {
  const items = loadBank(DEMO_TRACK_DIR).items;
  const imageItems = items.filter(
    (i) => (i.material as unknown as ImageMaterial).kind === "image",
  );

  it("has a balanced real-vs-AI image deck (>= 8 per side)", () => {
    const real = imageItems.filter((i) => i.key === "real");
    const ai = imageItems.filter((i) => i.key === "ai");
    // 4 per side in the released tier. Balance is what d' needs; the floor
    // only guards a silent path bug.
    expect(real.length).toBeGreaterThanOrEqual(4);
    expect(ai.length).toBeGreaterThanOrEqual(4);
    expect(real.length).toBe(ai.length);
  });

  it("every referenced media src exists under apps/web/public and is <= 200 KB", () => {
    expect(imageItems.length).toBeGreaterThan(0);
    for (const item of imageItems) {
      const m = item.material as unknown as ImageMaterial;
      expect(m.src, `item ${item.id} missing material.src`).toBeTruthy();
      expect(m.src).toMatch(/^t2-media\/[0-9a-f]{12}\.jpg$/);
      expect(m.alt, `item ${item.id} missing material.alt`).toBeTruthy();
      const path = join(PUBLIC_DIR, m.src as string);
      expect(existsSync(path), `missing asset ${m.src}`).toBe(true);
      expect(statSync(path).size, `${m.src} exceeds 200 KB budget`).toBeLessThanOrEqual(200_000);
    }
  });

  it("references each asset at most once per locale, and only assets the en deck ships", () => {
    // Media files are locale-neutral: ja/ko stem-variant items may reuse an
    // en item's asset, but within one locale each asset appears at most once.
    const byLocale = new Map<string, string[]>();
    for (const i of imageItems) {
      const src = (i.material as unknown as ImageMaterial).src?.replace("t2-media/", "") ?? "";
      const list = byLocale.get(i.locale) ?? [];
      list.push(src);
      byLocale.set(i.locale, list);
    }
    for (const [locale, refs] of byLocale) {
      expect(new Set(refs).size, `duplicate media reference within locale ${locale}`).toBe(refs.length);
    }
    const shipped = new Set(readdirSync(MEDIA_DIR).filter((f) => f.endsWith(".jpg")));
    // Subset, not equality: the pool also serves the operational bank, which
    // is not in this repository (see the header).
    for (const src of byLocale.get("en") ?? []) {
      expect(shipped.has(src), `en deck references unshipped asset ${src}`).toBe(true);
    }
    // A ja/ko item may reuse the asset of an en item that is NOT in this tier:
    // the released/operational partition cut the corpus by item, not by asset.
    // So the rule that survives here is "a shipped asset", not "an en asset".
    for (const [locale, refs] of byLocale) {
      if (locale === "en") continue;
      for (const r of refs) expect(shipped.has(r), `${locale} references unshipped asset ${r}`).toBe(true);
    }
  });

  it("every shipped t2-media asset obeys the naming rule and the 200 KB budget", () => {
    // The half of asset hygiene that needs no bank at all — and the half that
    // still covers the ~36 pool files the operational deck references.
    const shipped = readdirSync(MEDIA_DIR);
    expect(shipped.length).toBeGreaterThan(imageItems.length);
    for (const f of shipped) {
      expect(f, "unexpected file in the t2-media pool").toMatch(/^[0-9a-f]{12}\.jpg$/);
      expect(statSync(join(MEDIA_DIR, f)).size, `${f} exceeds 200 KB budget`).toBeLessThanOrEqual(200_000);
    }
  });

  it("image items carry Commons provenance with an allowed license", () => {
    const OK = /^(CC0|CC BY(-SA)? \d(\.\d)?|Public domain|PD)/i;
    for (const item of imageItems) {
      const p = item.provenance as Record<string, string>;
      for (const field of ["source_url", "commons_title", "author", "license", "retrieved"]) {
        expect(p[field], `item ${item.id} provenance missing ${field}`).toBeTruthy();
      }
      expect(p.license, `item ${item.id} license '${p.license}' not allowed`).toMatch(OK);
      expect(p.source_url).toContain("commons.wikimedia.org");
    }
  });

  it("stems and alt text do not leak the answer key", () => {
    for (const item of imageItems) {
      const alt = ((item.material as unknown as ImageMaterial).alt ?? "").toLowerCase();
      expect(alt).not.toContain("ai-generated");
      expect(alt).not.toContain("midjourney");
      expect(alt).not.toContain("photograph of a real");
    }
  });
});
