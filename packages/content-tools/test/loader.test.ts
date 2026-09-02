import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, cpSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseManifest, parseTrackConfig, parseRubric, parsePrompt, parseBankLine,
  loadInstrument, InstrumentValidationError,
} from "../src/loader.js";
import { hashBank } from "../src/bank.js";
import { canonicalJson, itemId } from "@ailx/core";

/**
 * The only instrument in this repo is the REDACTED released tier. The failure
 * modes below are properties of an unredacted (operational-shaped) package, so
 * they are exercised against a copy with its redaction undone rather than
 * against content that is no longer here — see
 * `test/instrument-demo-2026.1.test.ts` for the same technique and why.
 */
const INSTRUMENT_DIR = fileURLToPath(new URL("../../../instruments/demo-2026.1", import.meta.url));

function unredactedCopy(): string {
  const dir = mkdtempSync(join(tmpdir(), "ailx-"));
  cpSync(INSTRUMENT_DIR, dir, { recursive: true });
  const manifest = join(dir, "manifest.yaml");
  writeFileSync(manifest, readFileSync(manifest, "utf8").replace("redacted: true\n", ""));
  for (const track of ["t1-creative-build", "t2-discrimination", "t3-reasoning", "t4-generative"]) {
    const rubric = join(dir, "tracks", track, "rubric.yaml");
    writeFileSync(
      rubric,
      readFileSync(rubric, "utf8").replace(/^(    judged: (?:true|false))$/gm, "$1\n    description: marking prose") +
        ["band_anchors:",
          "  - { band: distinction, min_scaled: 70, anchor: x }",
          "  - { band: merit, min_scaled: 61, anchor: x }",
          "  - { band: pass, min_scaled: 50, anchor: x }",
          "  - { band: participation, min_scaled: 0, anchor: x }",
          ""].join("\n"),
    );
    const prompts = join(dir, "tracks", track, "prompts");
    if (track === "t2-discrimination") continue; // no model in the loop
    mkdirSync(prompts);
    writeFileSync(
      join(prompts, "screening.en.md"),
      "---\nlocale: en\ntranslation_provenance: source\n---\nJudge it.\n",
    );
  }
  return dir;
}

const GOOD_RUBRIC = `
track: t9-demo
total_points: 100
criteria:
  - { id: a, name: A, points: 60, scored_by: arithmetic, judged: false, description: d }
  - { id: b, name: B, points: 40, scored_by: judge, judged: true, description: d }
band_anchors:
  - { band: distinction, min_scaled: 70, anchor: x }
  - { band: merit, min_scaled: 61, anchor: x }
  - { band: pass, min_scaled: 50, anchor: x }
  - { band: participation, min_scaled: 0, anchor: x }
`;

describe("parseManifest", () => {
  it("rejects missing tracks", () => {
    expect(() => parseManifest("id: ailx\nversion: '2026.1'\neffective_from: 2026-01-01\nlocales: [en]\n"))
      .toThrow(InstrumentValidationError);
  });
  it("rejects unknown locales", () => {
    expect(() =>
      parseManifest("id: ailx\nversion: '1'\neffective_from: 2026-01-01\nlocales: [fr]\ntracks: [t1]\n"),
    ).toThrow(/unknown locale/);
  });
});

/**
 * The frozen trend form (docs/TREND-FORM.md). The manifest is where an
 * anchor declares itself, because a policy note is not loadable and a form
 * that nobody can tell is an anchor gets rotated by the annual re-version
 * runbook like everything else.
 */
describe("parseManifest anchor", () => {
  const BASE = "id: ailx\nversion: '2026.1'\neffective_from: 2026-01-01\nlocales: [en]\ntracks: [t2-discrimination]\n";

  it("is absent on an ordinary operational package", () => {
    expect(parseManifest(BASE).anchor).toBeUndefined();
  });
  it("accepts an id and a positive exposure budget", () => {
    const m = parseManifest(`${BASE}anchor:\n  id: ltt-2026a\n  exposure_budget: 4000\n`);
    expect(m.anchor).toEqual({ id: "ltt-2026a", exposure_budget: 4000 });
  });
  it("rejects an anchor in a redacted package, whose keys are published", () => {
    expect(() => parseManifest(`${BASE}redacted: true\nanchor:\n  id: ltt-2026a\n  exposure_budget: 4000\n`))
      .toThrow(/redacted package must not declare an 'anchor'/);
  });
  it("rejects an anchor that is not a mapping, including an empty one", () => {
    expect(() => parseManifest(`${BASE}anchor: ltt-2026a\n`)).toThrow(/'anchor' must be a mapping/);
    expect(() => parseManifest(`${BASE}anchor: [ltt-2026a]\n`)).toThrow(/'anchor' must be a mapping/);
    // `anchor:` alone is null, which is a half-written block, not an absent one.
    expect(() => parseManifest(`${BASE}anchor:\n`)).toThrow(/'anchor' must be a mapping/);
  });
  it("rejects an unknown anchor field, so a misspelled budget cannot disable it", () => {
    expect(() =>
      parseManifest(`${BASE}anchor:\n  id: ltt-2026a\n  exposure_budget: 10\n  exposure_budegt: 99\n`),
    ).toThrow(/unknown anchor field 'exposure_budegt'/);
  });
  it("rejects an anchor without an id", () => {
    expect(() => parseManifest(`${BASE}anchor:\n  exposure_budget: 10\n`)).toThrow(/missing required field 'id'/);
  });
  it("rejects an id that is not a lowercase slug", () => {
    for (const id of ["LTT-2026a", "ltt 2026a", "-ltt", "ltt-", "ltt--2026a", "''"]) {
      expect(() => parseManifest(`${BASE}anchor:\n  id: ${id}\n  exposure_budget: 10\n`))
        .toThrow(/anchor id/);
    }
  });
  it("rejects a missing, zero, negative or fractional exposure budget", () => {
    expect(() => parseManifest(`${BASE}anchor:\n  id: ltt-2026a\n`))
      .toThrow(/missing required field 'exposure_budget'/);
    for (const budget of ["0", "-1", "1.5", "'4000'", "1e400"]) {
      expect(() => parseManifest(`${BASE}anchor:\n  id: ltt-2026a\n  exposure_budget: ${budget}\n`))
        .toThrow(/exposure_budget/);
    }
  });
});

/**
 * The panel short form (docs/SHORT-FORM.md). The manifest declares the block
 * structure because the time budget IS the design: a form that grows past the
 * minutes a panel will sit does not fail at fielding, it fails as break-off.
 */
describe("parseManifest short_form", () => {
  const BASE = "id: ailx\nversion: '2026.1'\neffective_from: 2026-01-01\nlocales: [en]\ntracks: [t2-discrimination]\n";
  const FORM = [
    "short_form:",
    "  id: psf-2026a",
    "  target_minutes: 55",
    "  blocks:",
    "    - id: anchor-core",
    "      minutes: 14",
    "      every_respondent: true",
    "    - id: t3-reliance-a",
    "      minutes: 20",
    "    - id: t3-reliance-b",
    "      minutes: 20",
    "",
  ].join("\n");

  it("is absent on a package that is only ever sat in full", () => {
    expect(parseManifest(BASE).short_form).toBeUndefined();
  });
  it("accepts a common block and two rotated blocks inside the target", () => {
    const f = parseManifest(BASE + FORM).short_form;
    expect(f?.id).toBe("psf-2026a");
    expect(f?.target_minutes).toBe(55);
    expect(f?.blocks).toEqual([
      { id: "anchor-core", minutes: 14, every_respondent: true },
      { id: "t3-reliance-a", minutes: 20 },
      { id: "t3-reliance-b", minutes: 20 },
    ]);
  });
  it("accepts fractional minutes, because a 25-second item does not land on a minute", () => {
    expect(parseManifest(BASE + FORM.replace("minutes: 14", "minutes: 13.5")).short_form?.blocks[0].minutes)
      .toBe(13.5);
  });
  it("rejects a short_form that is not a mapping, including a half-written one", () => {
    for (const bad of ["short_form: psf-2026a\n", "short_form: [psf-2026a]\n", "short_form:\n"]) {
      expect(() => parseManifest(BASE + bad)).toThrow(/'short_form' must be a mapping/);
    }
  });
  it("rejects an unknown field on the form or on a block", () => {
    expect(() => parseManifest(BASE + FORM + "  rotations: 4\n"))
      .toThrow(/unknown short_form field 'rotations'/);
    expect(() => parseManifest(BASE + FORM.replace("      minutes: 20\n    - id: t3-reliance-b", "      minutes: 20\n      items: 12\n    - id: t3-reliance-b")))
      .toThrow(/unknown short_form block field 'items'/);
  });
  it("rejects an id that is not a lowercase slug, on the form or on a block", () => {
    expect(() => parseManifest(BASE + FORM.replace("psf-2026a", "PSF-2026a")))
      .toThrow(/short_form id/);
    expect(() => parseManifest(BASE + FORM.replace("anchor-core", "anchor core")))
      .toThrow(/short_form block id/);
  });
  it("rejects a missing or non-positive target", () => {
    expect(() => parseManifest(BASE + FORM.replace("  target_minutes: 55\n", "")))
      .toThrow(/missing required field 'target_minutes'/);
    for (const t of ["0", "-5", "'55'"]) {
      expect(() => parseManifest(BASE + FORM.replace("target_minutes: 55", `target_minutes: ${t}`)))
        .toThrow(/target_minutes/);
    }
  });
  it("rejects a block list that is empty, or a block that is not a mapping", () => {
    expect(() => parseManifest(BASE + "short_form:\n  id: psf-2026a\n  target_minutes: 55\n  blocks: []\n"))
      .toThrow(/'blocks' must be a non-empty list/);
    expect(() => parseManifest(BASE + "short_form:\n  id: psf-2026a\n  target_minutes: 55\n  blocks: [anchor-core]\n"))
      .toThrow(/each short_form block must be a mapping/);
  });
  it("rejects a block without positive minutes", () => {
    expect(() => parseManifest(BASE + FORM.replace("      minutes: 14\n", "")))
      .toThrow(/missing required field 'minutes'/);
    expect(() => parseManifest(BASE + FORM.replace("minutes: 14", "minutes: 0")))
      .toThrow(/short_form block 'anchor-core' needs a positive number of 'minutes'/);
  });
  it("rejects a non-boolean every_respondent", () => {
    expect(() => parseManifest(BASE + FORM.replace("every_respondent: true", "every_respondent: yes please")))
      .toThrow(/'every_respondent' must be a boolean/);
  });
  it("rejects duplicate block ids, which would make a rotation ambiguous", () => {
    expect(() => parseManifest(BASE + FORM.replace("t3-reliance-b", "t3-reliance-a")))
      .toThrow(/duplicate short_form block id 't3-reliance-a'/);
  });
  it("rejects a form with no common block, because nothing would link the rotations", () => {
    expect(() => parseManifest(BASE + FORM.replace("      every_respondent: true\n", "")))
      .toThrow(/at least one 'every_respondent' block/);
  });
  it("rejects a form with fewer than two rotated blocks, which is a fixed form", () => {
    const oneRotation = FORM.replace("    - id: t3-reliance-b\n      minutes: 20\n", "");
    expect(() => parseManifest(BASE + oneRotation)).toThrow(/at least two rotated blocks/);
  });
  it("rejects a longest respondent path over the target, counting one rotation only", () => {
    expect(() => parseManifest(BASE + FORM.replace("target_minutes: 55", "target_minutes: 33")))
      .toThrow(/longest path is 34 min, over its target_minutes of 33/);
    // 14 + 20 + 20 = 54 if the rotations were summed; the check must not do that.
    expect(parseManifest(BASE + FORM.replace("target_minutes: 55", "target_minutes: 34")).short_form)
      .toBeDefined();
  });
});

describe("parseTrackConfig", () => {
  it("rejects plugin ids without an apiVersion suffix", () => {
    expect(() => parseTrackConfig("plugin: item-bank\nconfig: {}\n", "t.yaml"))
      .toThrow(/must match/);
  });
  it("accepts '<id>@<version>'", () => {
    expect(parseTrackConfig("plugin: item-bank@2\nconfig: { a: 1 }\n", "t.yaml").plugin)
      .toBe("item-bank@2");
  });
});

describe("parseRubric", () => {
  it("accepts a well-formed rubric", () => {
    expect(parseRubric(GOOD_RUBRIC, "r.yaml").criteria).toHaveLength(2);
  });
  it("rejects criteria that do not sum to total_points", () => {
    expect(() => parseRubric(GOOD_RUBRIC.replace("points: 40", "points: 39"), "r.yaml"))
      .toThrow(/sum to 99/);
  });
  it("rejects a missing band", () => {
    expect(() =>
      parseRubric(GOOD_RUBRIC.replace("  - { band: merit, min_scaled: 61, anchor: x }\n", ""), "r.yaml"),
    ).toThrow(/exactly 4 bands/);
  });
  it("rejects duplicate criterion ids", () => {
    expect(() => parseRubric(GOOD_RUBRIC.replace("id: b", "id: a"), "r.yaml"))
      .toThrow(/duplicate criterion/);
  });
});

describe("parsePrompt", () => {
  it("rejects prompts without front matter", () => {
    expect(() => parsePrompt("# Judge\nDo things.", "p.md")).toThrow(/front matter/);
  });
  it("rejects prompts without translation_provenance", () => {
    expect(() => parsePrompt("---\nlocale: en\n---\nbody", "p.md"))
      .toThrow(/translation_provenance/);
  });
  it("extracts locale and provenance", () => {
    const p = parsePrompt("---\nlocale: ja\ntranslation_provenance: machine\n---\nbody", "p.md");
    expect(p.locale).toBe("ja");
    expect(p.translationProvenance).toBe("machine");
  });
});

function goodItem(): Record<string, unknown> {
  return {
    type: "text-authenticity", locale: "en", stem: "s",
    material: { kind: "text", text: "x" },
    options: [{ id: "ai", label: "AI" }, { id: "human", label: "Human" }],
    key: "ai", difficulty: "easy", provenance: { tier: "A" }, rationale: "r",
  };
}

describe("parseBankLine", () => {
  it("accepts a canonical content-addressed line", () => {
    const content = goodItem();
    const line = canonicalJson({ ...content, id: itemId(content) });
    expect(parseBankLine(line, "bank.jsonl", 1).key).toBe("ai");
  });
  it("rejects an id that does not match the content (edited item)", () => {
    const content = goodItem();
    const line = canonicalJson({ ...content, id: itemId({ ...content, stem: "tampered" }) });
    expect(() => parseBankLine(line, "bank.jsonl", 1)).toThrow(/id mismatch/);
  });
  it("rejects a key not present among option ids", () => {
    const content = { ...goodItem(), key: "nope" };
    const line = canonicalJson({ ...content, id: itemId(content) });
    expect(() => parseBankLine(line, "bank.jsonl", 1)).toThrow(/not among option ids/);
  });
  it("rejects non-canonical JSON lines", () => {
    const content = goodItem();
    const obj = { ...content, id: itemId(content) };
    expect(() => parseBankLine(JSON.stringify(obj) + " ", "bank.jsonl", 1)).toThrow();
  });
});

describe("loadInstrument failure modes", () => {
  it("loads the unredacted fixture as it stands (or the negatives prove nothing)", () => {
    const dir = unredactedCopy();
    const pkg = loadInstrument(dir);
    expect(pkg.manifest.redacted).toBeUndefined();
    expect(pkg.tracks.find((t) => t.trackId === "t3-reasoning")!.prompts).toHaveLength(1);
    rmSync(dir, { recursive: true, force: true });
  });
  it("fails when bank.sha256 disagrees with bank.jsonl", () => {
    const dir = unredactedCopy();
    const shaPath = join(dir, "tracks/t2-discrimination/items/bank.sha256");
    writeFileSync(shaPath, "0".repeat(64) + "  bank.jsonl\n");
    expect(() => loadInstrument(dir)).toThrow(/bank.sha256 mismatch/);
  });
  it("fails when a judged track loses its prompts", () => {
    const dir = unredactedCopy();
    rmSync(join(dir, "tracks/t3-reasoning/prompts"), { recursive: true });
    expect(() => loadInstrument(dir)).toThrow(/judged criteria .* but no judge prompts/);
  });
  it("fails when a listed track directory is missing", () => {
    const dir = unredactedCopy();
    const manifest = readFileSync(join(dir, "manifest.yaml"), "utf8");
    writeFileSync(join(dir, "manifest.yaml"), manifest + "  - t5-missing\n");
    expect(() => loadInstrument(dir)).toThrow(/track directory missing/);
  });
});

describe("hashBank round-trip", () => {
  it("write then verify is stable, and edits change the id", () => {
    const dir = mkdtempSync(join(tmpdir(), "ailx-bank-"));
    mkdirSync(join(dir, "items"), { recursive: true });
    const bankPath = join(dir, "items", "bank.jsonl");
    const a = goodItem();
    const b = { ...goodItem(), stem: "another stem" };
    writeFileSync(bankPath, JSON.stringify(a) + "\n" + JSON.stringify(b) + "\n");

    const first = hashBank(bankPath, true);
    expect(first.itemCount).toBe(2);
    expect(first.rewrittenIds).toBe(2); // ids were absent

    const verify = hashBank(bankPath, false);
    expect(verify.changed).toBe(false);
    expect(verify.rewrittenIds).toBe(0);
    expect(verify.sha256).toBe(first.sha256);
    expect(readFileSync(bankPath.replace(/\.jsonl$/, ".sha256"), "utf8"))
      .toContain(first.sha256);

    // Editing an item must change its id (edited item is a NEW item).
    const lines = readFileSync(bankPath, "utf8").trim().split("\n");
    const parsed = JSON.parse(lines[0]) as Record<string, unknown>;
    const oldId = parsed.id as string;
    parsed.stem = "edited";
    writeFileSync(bankPath, canonicalJson(parsed) + "\n" + lines[1] + "\n");
    const stale = hashBank(bankPath, false);
    expect(stale.rewrittenIds).toBe(1);
    const rewritten = hashBank(bankPath, true);
    const newId = (JSON.parse(readFileSync(bankPath, "utf8").trim().split("\n")[0]) as Record<string, unknown>).id;
    expect(newId).not.toBe(oldId);
    expect(rewritten.sha256).not.toBe(first.sha256);
  });
});
