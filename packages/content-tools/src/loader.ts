import { readFileSync, readdirSync, existsSync } from "node:fs";
import { basename, join } from "node:path";
import { parse } from "yaml";
import { itemId, canonicalJson, rubricVersion } from "@ailx/core";
import { createHash } from "node:crypto";
import type {
  AnchorForm, InstrumentManifest, InstrumentPackage, InstrumentTrack, ItemBank,
  BankItem, BandAnchor, JudgePrompt, Rubric, TrackConfigFile, Locale,
  ShortForm, ShortFormBlock,
} from "./types.js";

export class InstrumentValidationError extends Error {
  constructor(public readonly path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = "InstrumentValidationError";
  }
}

const LOCALES: ReadonlyArray<Locale> = ["en", "ja", "ko"];
const BANDS = ["distinction", "merit", "pass", "participation"];
const DIFFICULTIES = ["easy", "medium", "hard"];

function fail(path: string, msg: string): never {
  throw new InstrumentValidationError(path, msg);
}

function req<T>(obj: Record<string, unknown>, key: string, path: string): T {
  const v = obj[key];
  if (v === undefined || v === null) fail(path, `missing required field '${key}'`);
  return v as T;
}

export function parseManifest(raw: string, path = "manifest.yaml"): InstrumentManifest {
  const doc = parse(raw) as Record<string, unknown>;
  if (typeof doc !== "object" || doc === null) fail(path, "not a YAML mapping");
  const id = req<string>(doc, "id", path);
  const version = String(req<unknown>(doc, "version", path));
  const notice = doc.notice === undefined ? undefined : String(doc.notice);
  const redacted = doc.redacted === undefined ? undefined : doc.redacted;
  if (redacted !== undefined && typeof redacted !== "boolean") {
    fail(path, "'redacted' must be a boolean");
  }
  const anchor = parseAnchor(doc.anchor, path);
  const short_form = parseShortForm(doc.short_form, path);
  // Published keys and a frozen trend line cannot both be true of one package.
  // A redacted package publishes every key on purpose, so declaring an anchor
  // in it would ship a burned form that still looks comparable — the failure
  // docs/TREND-FORM.md §2 calls worse than having no anchor at all.
  if (anchor && redacted === true) fail(path, "a redacted package must not declare an 'anchor'");
  const effective_from = String(req<unknown>(doc, "effective_from", path));
  const locales = req<Locale[]>(doc, "locales", path);
  const tracks = req<string[]>(doc, "tracks", path);
  if (!Array.isArray(tracks) || tracks.length === 0) fail(path, "tracks must be a non-empty list");
  for (const l of locales) {
    if (!LOCALES.includes(l)) fail(path, `unknown locale '${l}'`);
  }
  return {
    id, version, ...(notice ? { notice } : {}), ...(redacted === true ? { redacted: true } : {}),
    effective_from, locales, tracks, ...(anchor ? { anchor } : {}),
    ...(short_form ? { short_form } : {}),
  };
}

/**
 * The manifest's optional frozen-trend-form block (docs/TREND-FORM.md).
 *
 * The budget is validated here rather than counted here: this package reads
 * content, it does not see a sitting. What it can enforce is that a form
 * claiming to be an anchor names itself and states a finite budget, so a
 * later exposure count has something to compare against.
 */
function parseAnchor(raw: unknown, path: string): AnchorForm | undefined {
  if (raw === undefined) return undefined;
  // `anchor:` with nothing under it parses as null. That is a half-written
  // block, not a package without an anchor, and the two must not look alike.
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    fail(path, "'anchor' must be a mapping");
  }
  const a = raw as Record<string, unknown>;
  for (const key of Object.keys(a)) {
    // A misspelled `exposure_budget` would otherwise turn the budget off in
    // silence, which is the one thing a budget may not do.
    if (key !== "id" && key !== "exposure_budget") fail(path, `unknown anchor field '${key}'`);
  }
  const id = req<unknown>(a, "id", `${path} anchor`);
  if (typeof id !== "string" || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(id)) {
    fail(path, `anchor id '${String(id)}' must be lowercase alphanumeric with single hyphens`);
  }
  const budget = req<unknown>(a, "exposure_budget", `${path} anchor`);
  if (typeof budget !== "number" || !Number.isSafeInteger(budget) || budget <= 0) {
    fail(path, "anchor 'exposure_budget' must be a positive whole number of administrations");
  }
  return { id, exposure_budget: budget as number };
}

/**
 * The manifest's optional panel short form (docs/SHORT-FORM.md).
 *
 * Three things are checked here, and they are the three a fielding cannot
 * recover from:
 *  - a common block exists, because it is what links the rotated forms;
 *  - at least two blocks rotate, because one rotated block is a fixed form
 *    wearing the word "matrix";
 *  - the longest respondent path fits the declared minutes.
 * Everything else about the design — which items are in a block, who gets
 * which rotation — belongs to the exam service, which is the only thing that
 * sees a sitting.
 */
function parseShortForm(raw: unknown, path: string): ShortForm | undefined {
  if (raw === undefined) return undefined;
  // `short_form:` with nothing under it parses as null: a half-written block,
  // not a package without a short form.
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    fail(path, "'short_form' must be a mapping");
  }
  const f = raw as Record<string, unknown>;
  for (const key of Object.keys(f)) {
    if (key !== "id" && key !== "target_minutes" && key !== "blocks") {
      fail(path, `unknown short_form field '${key}'`);
    }
  }
  const id = req<unknown>(f, "id", `${path} short_form`);
  if (typeof id !== "string" || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(id)) {
    fail(path, `short_form id '${String(id)}' must be lowercase alphanumeric with single hyphens`);
  }
  const target = req<unknown>(f, "target_minutes", `${path} short_form`);
  if (typeof target !== "number" || !Number.isFinite(target) || target <= 0) {
    fail(path, "short_form 'target_minutes' must be a positive number of minutes");
  }
  const rawBlocks = req<unknown>(f, "blocks", `${path} short_form`);
  if (!Array.isArray(rawBlocks) || rawBlocks.length === 0) {
    fail(path, "short_form 'blocks' must be a non-empty list");
  }
  const blocks = rawBlocks.map((b) => parseShortFormBlock(b, path));
  const ids = new Set<string>();
  for (const b of blocks) {
    if (ids.has(b.id)) fail(path, `duplicate short_form block id '${b.id}'`);
    ids.add(b.id);
  }
  const common = blocks.filter((b) => b.every_respondent);
  const rotated = blocks.filter((b) => !b.every_respondent);
  if (common.length === 0) {
    fail(path, "short_form needs at least one 'every_respondent' block to link the rotated forms");
  }
  if (rotated.length < 2) {
    fail(path, "short_form needs at least two rotated blocks, or it is a fixed form");
  }
  const longest = common.reduce((s, b) => s + b.minutes, 0)
    + rotated.reduce((m, b) => Math.max(m, b.minutes), 0);
  if (longest > target) {
    fail(path, `short_form longest path is ${longest} min, over its target_minutes of ${target}`);
  }
  return { id, target_minutes: target, blocks };
}

function parseShortFormBlock(raw: unknown, path: string): ShortFormBlock {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    fail(path, "each short_form block must be a mapping");
  }
  const b = raw as Record<string, unknown>;
  for (const key of Object.keys(b)) {
    if (key !== "id" && key !== "minutes" && key !== "every_respondent") {
      fail(path, `unknown short_form block field '${key}'`);
    }
  }
  const id = req<unknown>(b, "id", `${path} short_form block`);
  if (typeof id !== "string" || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(id)) {
    fail(path, `short_form block id '${String(id)}' must be lowercase alphanumeric with single hyphens`);
  }
  const minutes = req<unknown>(b, "minutes", `${path} short_form block '${id}'`);
  if (typeof minutes !== "number" || !Number.isFinite(minutes) || minutes <= 0) {
    fail(path, `short_form block '${id}' needs a positive number of 'minutes'`);
  }
  const every = b.every_respondent;
  if (every !== undefined && typeof every !== "boolean") {
    fail(path, `short_form block '${id}': 'every_respondent' must be a boolean`);
  }
  return { id, minutes, ...(every === true ? { every_respondent: true } : {}) };
}

export function parseTrackConfig(raw: string, path: string): TrackConfigFile {
  const doc = parse(raw) as Record<string, unknown>;
  if (typeof doc !== "object" || doc === null) fail(path, "not a YAML mapping");
  const plugin = req<string>(doc, "plugin", path);
  if (!/^[a-z0-9-]+@\d+$/.test(plugin)) {
    fail(path, `plugin '${plugin}' must match '<id>@<apiVersion>' (e.g. item-bank@2)`);
  }
  const config = req<Record<string, unknown>>(doc, "config", path);
  if (typeof config !== "object") fail(path, "config must be a mapping");
  return { plugin, config };
}

/**
 * A rubric, in one of its two on-disk shapes.
 *
 * `redacted` inverts the marking-material rules instead of merely relaxing
 * them. An operational rubric MUST carry a `description` on every criterion
 * and four `band_anchors`; a redacted one MUST carry neither. Both halves are
 * an error, so a published tier cannot drift back into shipping a mark scheme
 * by having someone paste the operational file over it.
 */
export function parseRubric(raw: string, path: string, redacted = false): Rubric {
  const doc = parse(raw) as Record<string, unknown>;
  if (typeof doc !== "object" || doc === null) fail(path, "not a YAML mapping");
  const track = req<string>(doc, "track", path);
  const total = req<number>(doc, "total_points", path);
  const criteria = req<Rubric["criteria"]>(doc, "criteria", path);
  if (!Array.isArray(criteria)) fail(path, "criteria must be a list");
  // A SHOWCASE track publishes no criteria, and it is the only thing that
  // may: total_points 0 and criteria [] is the declared shape for a track
  // that is run and recorded but issues no points (spec §04, T4). Any other
  // empty list is a rubric somebody forgot to write.
  if (criteria.length === 0 && total !== 0) {
    fail(path, "criteria must be a non-empty list unless total_points is 0");
  }
  if (criteria.length > 0 && total === 0) {
    fail(path, "total_points 0 must publish no criteria");
  }
  let sum = 0;
  const seen = new Set<string>();
  for (const c of criteria) {
    const fields = ["id", "name", "points", "scored_by"] as const;
    for (const k of redacted ? fields : ([...fields, "description"] as const)) {
      if ((c as unknown as Record<string, unknown>)[k] === undefined) fail(path, `criterion missing '${k}'`);
    }
    if (redacted && c.description !== undefined) {
      fail(path, `criterion '${String(c.id)}' carries a 'description' in a redacted package`);
    }
    if (typeof c.judged !== "boolean") fail(path, `criterion '${c.id}' missing boolean 'judged'`);
    if (seen.has(c.id)) fail(path, `duplicate criterion id '${c.id}'`);
    seen.add(c.id);
    sum += c.points;
  }
  if (sum !== total) fail(path, `criteria points sum to ${sum}, expected total_points ${total}`);
  if (redacted) {
    if (doc.band_anchors !== undefined) fail(path, "redacted package carries 'band_anchors'");
    return { track, total_points: total, criteria };
  }
  const band_anchors = req<Rubric["band_anchors"]>(doc, "band_anchors", path);
  if (!Array.isArray(band_anchors) || band_anchors.length !== 4) {
    fail(path, "band_anchors must list exactly 4 bands");
  }
  const bandIds = band_anchors.map((b) => b.band);
  for (const b of BANDS) {
    if (!bandIds.includes(b as BandAnchor["band"])) {
      fail(path, `band_anchors missing band '${b}'`);
    }
  }
  for (const b of band_anchors) {
    if (typeof b.min_scaled !== "number") fail(path, `band '${b.band}' missing numeric min_scaled`);
    if (typeof b.anchor !== "string" || b.anchor.length === 0) fail(path, `band '${b.band}' missing anchor text`);
  }
  return { track, total_points: total, criteria, band_anchors };
}

const FRONT_MATTER = /^---\n([\s\S]*?)\n---\n/;

export function parsePrompt(raw: string, filename: string): JudgePrompt {
  const m = FRONT_MATTER.exec(raw);
  if (!m) fail(filename, "judge prompt missing YAML front matter");
  const fm = parse(m[1]) as Record<string, unknown>;
  const locale = fm.locale as Locale;
  if (!LOCALES.includes(locale)) fail(filename, `front matter has unknown locale '${String(fm.locale)}'`);
  const provenance = fm.translation_provenance;
  if (typeof provenance !== "string") fail(filename, "front matter missing translation_provenance");
  return { locale, filename: basename(filename), content: raw, translationProvenance: provenance };
}

export function parseBankLine(line: string, path: string, lineNo: number): BankItem {
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(line) as Record<string, unknown>;
  } catch {
    fail(path, `line ${lineNo}: not valid JSON`);
  }
  const where = `${path}:${lineNo}`;
  const id = req<string>(obj, "id", where);
  for (const k of ["type", "locale", "stem", "material", "options", "key", "difficulty", "provenance", "rationale"]) {
    if (obj[k] === undefined) fail(where, `item missing field '${k}'`);
  }
  const item = obj as unknown as BankItem;
  if (!LOCALES.includes(item.locale)) fail(where, `unknown locale '${String(item.locale)}'`);
  if (!DIFFICULTIES.includes(item.difficulty)) fail(where, `unknown difficulty '${String(item.difficulty)}'`);
  if (!Array.isArray(item.options) || item.options.length < 2) fail(where, "options must list >= 2 choices");
  if (!item.options.some((o) => o.id === item.key)) fail(where, `key '${item.key}' not among option ids`);
  const { id: _drop, ...content } = obj;
  const expected = itemId(content);
  if (id !== expected) {
    fail(where, `item id mismatch: stored ${id}, computed ${expected} (items are content-addressed; run hash-bank --write)`);
  }
  if (line !== canonicalJson(obj)) {
    fail(where, "line is not canonical JSON (run hash-bank --write)");
  }
  return item;
}

export function sha256Hex(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

export function loadBank(dir: string): ItemBank {
  const bankPath = join(dir, "items", "bank.jsonl");
  const shaPath = join(dir, "items", "bank.sha256");
  const rawBytes = readFileSync(bankPath);
  const raw = rawBytes.toString("utf8");
  const lines = raw.split("\n").filter((l) => l.length > 0);
  const items = lines.map((l, i) => parseBankLine(l, bankPath, i + 1));
  const ids = new Set(items.map((i) => i.id));
  if (ids.size !== items.length) fail(bankPath, "duplicate item ids in bank");
  const digest = sha256Hex(rawBytes);
  if (!existsSync(shaPath)) fail(shaPath, "bank.sha256 missing (run hash-bank --write)");
  const stored = readFileSync(shaPath, "utf8").trim().split(/\s+/)[0];
  if (stored !== digest) fail(shaPath, `bank.sha256 mismatch: stored ${stored}, computed ${digest}`);
  return { items, sha256: digest };
}

/**
 * rubric_version = hash(rubric.yaml + prompts, sorted by filename) — spec §14.
 *
 * A REDACTED package has no prompts and a shorter rubric.yaml, so it addresses
 * a different document and gets a different version. That is the content
 * address working, not drifting: see instruments/demo-2026.1/README.md
 * "Why the rubricVersion values moved".
 */
export function computeRubricVersion(rubricRaw: string, prompts: ReadonlyArray<JudgePrompt>): string {
  const parts = [rubricRaw, ...[...prompts].sort((a, b) => a.filename.localeCompare(b.filename)).map((p) => p.content)];
  return rubricVersion(parts);
}

export function loadTrack(instrumentDir: string, trackId: string, redacted = false): InstrumentTrack {
  const dir = join(instrumentDir, "tracks", trackId);
  if (!existsSync(dir)) fail(dir, `track directory missing for '${trackId}'`);
  const trackRaw = readFileSync(join(dir, "track.yaml"), "utf8");
  const { plugin, config } = parseTrackConfig(trackRaw, join(dir, "track.yaml"));
  const rubricRaw = readFileSync(join(dir, "rubric.yaml"), "utf8");
  const rubric = parseRubric(rubricRaw, join(dir, "rubric.yaml"), redacted);
  if (rubric.track !== trackId) {
    fail(join(dir, "rubric.yaml"), `rubric.track '${rubric.track}' does not match directory '${trackId}'`);
  }
  const prompts: JudgePrompt[] = [];
  const promptsDir = join(dir, "prompts");
  if (existsSync(promptsDir)) {
    // A redacted package must not even have the directory: a judge prompt is
    // the mark scheme of a judged track, and the whole point of the tier is
    // that those bytes are not here to leak.
    if (redacted) fail(promptsDir, "redacted package carries judge prompts");
    for (const f of readdirSync(promptsDir).sort()) {
      if (!f.endsWith(".md")) continue;
      prompts.push(parsePrompt(readFileSync(join(promptsDir, f), "utf8"), join(promptsDir, f)));
    }
  }
  const judgedCriteria = rubric.criteria.filter((c) => c.judged);
  if (!redacted && judgedCriteria.length > 0 && prompts.length === 0) {
    fail(dir, `track has judged criteria (${judgedCriteria.map((c) => c.id).join(", ")}) but no judge prompts`);
  }
  let bank: ItemBank | undefined;
  if (existsSync(join(dir, "items", "bank.jsonl"))) bank = loadBank(dir);
  return {
    trackId, plugin, config, rubric, prompts,
    rubricVersion: computeRubricVersion(rubricRaw, prompts),
    bank,
  };
}

export function loadInstrument(instrumentDir: string): InstrumentPackage {
  const manifestPath = join(instrumentDir, "manifest.yaml");
  const manifest = parseManifest(readFileSync(manifestPath, "utf8"), manifestPath);
  const tracks = manifest.tracks.map((t) => loadTrack(instrumentDir, t, manifest.redacted === true));
  return { manifest, tracks };
}
