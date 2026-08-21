/**
 * CI-safe link-check gate: validates the COMMITTED link-check manifest
 * (produced by a live run of `check-links --write`) against the committed
 * bank — coverage, freshness (bank sha256 match), and all-ok — without
 * touching the network.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ITEMS = fileURLToPath(
  new URL("../../../instruments/2026.1/tracks/t2-discrimination/items", import.meta.url),
);
const bankRaw = readFileSync(join(ITEMS, "bank.jsonl"), "utf8");
const manifest = JSON.parse(readFileSync(join(ITEMS, "link-check.json"), "utf8")) as {
  bank_sha256: string;
  checked_at: string;
  url_count: number;
  all_ok: boolean;
  results: Array<{ url: string; status: number; ok: boolean; item_ids: string[] }>;
};

describe("provenance link-check manifest", () => {
  it("is fresh: manifest was generated from exactly this bank", () => {
    const sha = createHash("sha256").update(bankRaw).digest("hex");
    expect(manifest.bank_sha256).toBe(sha);
  });

  it("covers every provenance.source_url and reference URL in the bank", () => {
    const wanted = new Set<string>();
    for (const line of bankRaw.split("\n")) {
      if (!line) continue;
      const item = JSON.parse(line) as {
        provenance?: { source_url?: string; references?: string[] };
      };
      const p = item.provenance ?? {};
      if (p.source_url) wanted.add(p.source_url);
      for (const r of p.references ?? []) wanted.add(r);
    }
    const checked = new Set(manifest.results.map((r) => r.url));
    for (const u of wanted) expect(checked, `missing from manifest: ${u}`).toContain(u);
    expect(manifest.url_count).toBe(manifest.results.length);
  });

  it("every checked URL resolved (2xx/3xx)", () => {
    expect(manifest.all_ok).toBe(true);
    for (const r of manifest.results) {
      expect(r.ok, `${r.url} -> ${r.status}`).toBe(true);
      expect(r.status).toBeGreaterThanOrEqual(200);
      expect(r.status).toBeLessThan(400);
    }
  });
});
