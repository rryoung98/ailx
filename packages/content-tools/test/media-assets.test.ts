import { describe, expect, it } from "vitest";
import { readFileSync, statSync, existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { loadBank } from "../src/loader.js";

/**
 * Regression tests for the T2 real-vs-AI media deck (material kind "image").
 * Every `src` referenced by the bank must exist under apps/web/public and
 * stay within the 200 KB asset budget; every shipped asset must be referenced.
 */
const REPO = resolve(__dirname, "..", "..", "..");
const TRACK_DIR = join(REPO, "instruments", "2026.1", "tracks", "t2-discrimination");
const PUBLIC_DIR = join(REPO, "apps", "web", "public");
const MEDIA_DIR = join(PUBLIC_DIR, "t2-media");

interface ImageMaterial { kind: string; src?: string; alt?: string }

describe("t2 media assets", () => {
  const bank = loadBank(TRACK_DIR);
  const imageItems = bank.items.filter(
    (i) => (i.material as unknown as ImageMaterial).kind === "image",
  );

  it("has a balanced real-vs-AI image deck (>= 8 per side)", () => {
    const real = imageItems.filter((i) => i.key === "real");
    const ai = imageItems.filter((i) => i.key === "ai");
    expect(real.length).toBeGreaterThanOrEqual(8);
    expect(ai.length).toBeGreaterThanOrEqual(8);
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

  it("every shipped t2-media asset is referenced by exactly one bank item per locale", () => {
    // Media files are locale-neutral: ja/ko stem-variant items may reuse an
    // en item's asset, but within one locale each asset appears at most once,
    // and every shipped asset is referenced by the en deck.
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
    const shipped = readdirSync(MEDIA_DIR).filter((f) => f.endsWith(".jpg"));
    expect(shipped.sort()).toEqual([...(byLocale.get("en") ?? [])].sort());
    // Non-en locales may only reuse assets the en deck ships.
    const enSet = new Set(byLocale.get("en") ?? []);
    for (const [locale, refs] of byLocale) {
      if (locale === "en") continue;
      for (const r of refs) expect(enSet.has(r), `${locale} references non-en asset ${r}`).toBe(true);
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
