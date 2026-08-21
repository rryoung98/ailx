/**
 * Content-legitimacy regression gate: no "vibe-coded" items.
 *
 * - image-provenance: real Commons media only (the mock SVG scenes are
 *   retired; removal is legitimate because the bank is content-addressed
 *   and was re-hashed + re-snapshotted).
 * - text-authenticity: 'human' passages must cite a genuinely human
 *   public-domain source; 'ai' passages must be genuinely model-generated
 *   (with model/date/prompt metadata) or explicitly method:'authored'.
 * - message-hostility: modeled on documented real phishing pattern
 *   families, cited in provenance.
 * - provenance-reasoning: cites the real mechanism (C2PA spec, CT, ...).
 * - ja/ko: machine translation marked prominently as unreviewed.
 */
import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { loadInstrument } from "../src/loader.js";

const DIR = fileURLToPath(new URL("../../../instruments/2026.1", import.meta.url));
const bank = loadInstrument(DIR).tracks.find((t) => t.trackId === "t2-discrimination")!.bank!;

interface Prov {
  method?: string;
  source_url?: string;
  references?: string[];
  pattern_family?: string;
  mechanism?: string;
  model?: string;
  provider?: string;
  generated_date?: string;
  generation_prompt?: string;
  license?: string;
  translation_provenance?: string;
  translation_note?: string;
}
const prov = (i: (typeof bank.items)[number]) => (i.provenance ?? {}) as Prov;

describe("bank content legitimacy", () => {
  it("image-provenance items are real media only (mock SVG scenes retired)", () => {
    const images = bank.items.filter((i) => i.type === "image-provenance");
    expect(images.length).toBeGreaterThanOrEqual(44);
    for (const i of images) {
      expect((i.material as { kind?: string }).kind).toBe("image");
      const p = prov(i);
      expect(p.source_url).toMatch(/^https:\/\/commons\.wikimedia\.org\/wiki\//);
      expect(p.license).toBeTruthy();
    }
  });

  it("'human' text passages cite a genuinely human public-domain/CC source", () => {
    for (const i of bank.items.filter((x) => x.type === "text-authenticity" && x.key === "human")) {
      const p = prov(i);
      expect(p.method).toBe("public-domain-text");
      expect(p.source_url).toMatch(/^https:\/\/(www\.gutenberg\.org|[a-z]+\.wikipedia\.org)\//);
      expect(p.license).toBeTruthy();
    }
  });

  it("'ai' text passages are genuinely model-generated with full metadata, or explicitly authored", () => {
    for (const i of bank.items.filter((x) => x.type === "text-authenticity" && x.key === "ai")) {
      const p = prov(i);
      expect(["model-generated", "authored"]).toContain(p.method);
      if (p.method === "model-generated") {
        expect(p.model).toBeTruthy();
        expect(p.provider).toBe("openrouter");
        expect(p.generated_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(p.generation_prompt).toBeTruthy();
      }
    }
  });

  it("message-hostility items cite a documented real phishing pattern family", () => {
    for (const i of bank.items.filter((x) => x.type === "message-hostility")) {
      const p = prov(i);
      expect(p.pattern_family).toBeTruthy();
      expect(p.references!.length).toBeGreaterThan(0);
    }
  });

  it("provenance-reasoning items cite the real mechanism", () => {
    for (const i of bank.items.filter((x) => x.type === "provenance-reasoning")) {
      const p = prov(i);
      expect(p.mechanism).toBeTruthy();
      expect(p.references!.some((r) => /c2pa\.org|rfc6962|digitalcameraworld|petapixel/.test(r))).toBe(true);
    }
  });

  it("ja/ko items mark machine translation as unreviewed, prominently", () => {
    const jako = bank.items.filter((i) => i.locale === "ja" || i.locale === "ko");
    expect(jako.length).toBeGreaterThanOrEqual(16); // >= 8 playable items per locale
    for (const i of jako) {
      const p = prov(i);
      if (p.translation_provenance !== "source") {
        expect(p.translation_provenance).toBe("machine-unreviewed");
        expect(p.translation_note).toMatch(/not been reviewed|native speaker/);
      }
    }
  });

  it("no item carries the retired 'authored-for-demo' placeholder method", () => {
    for (const i of bank.items) {
      expect(prov(i).method).not.toBe("authored-for-demo");
    }
  });
});
