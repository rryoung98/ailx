import { readFileSync, readdirSync, existsSync } from "node:fs";
import { basename, join } from "node:path";
import { parse } from "yaml";
import { itemId, canonicalJson, rubricVersion } from "@ailx/core";
import { createHash } from "node:crypto";
import type {
  InstrumentManifest, InstrumentPackage, InstrumentTrack, ItemBank,
  BankItem, JudgePrompt, Rubric, TrackConfigFile, Locale,
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
  const effective_from = String(req<unknown>(doc, "effective_from", path));
  const locales = req<Locale[]>(doc, "locales", path);
  const tracks = req<string[]>(doc, "tracks", path);
  if (!Array.isArray(tracks) || tracks.length === 0) fail(path, "tracks must be a non-empty list");
  for (const l of locales) {
    if (!LOCALES.includes(l)) fail(path, `unknown locale '${l}'`);
  }
  return { id, version, effective_from, locales, tracks };
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

export function parseRubric(raw: string, path: string): Rubric {
  const doc = parse(raw) as Record<string, unknown>;
  if (typeof doc !== "object" || doc === null) fail(path, "not a YAML mapping");
  const track = req<string>(doc, "track", path);
  const total = req<number>(doc, "total_points", path);
  const criteria = req<Rubric["criteria"]>(doc, "criteria", path);
  if (!Array.isArray(criteria) || criteria.length === 0) fail(path, "criteria must be a non-empty list");
  let sum = 0;
  const seen = new Set<string>();
  for (const c of criteria) {
    for (const k of ["id", "name", "points", "scored_by", "description"] as const) {
      if ((c as unknown as Record<string, unknown>)[k] === undefined) fail(path, `criterion missing '${k}'`);
    }
    if (typeof c.judged !== "boolean") fail(path, `criterion '${c.id}' missing boolean 'judged'`);
    if (seen.has(c.id)) fail(path, `duplicate criterion id '${c.id}'`);
    seen.add(c.id);
    sum += c.points;
  }
  if (sum !== total) fail(path, `criteria points sum to ${sum}, expected total_points ${total}`);
  const band_anchors = req<Rubric["band_anchors"]>(doc, "band_anchors", path);
  if (!Array.isArray(band_anchors) || band_anchors.length !== 4) {
    fail(path, "band_anchors must list exactly 4 bands");
  }
  const bandIds = band_anchors.map((b) => b.band);
  for (const b of BANDS) {
    if (!bandIds.includes(b as Rubric["band_anchors"][number]["band"])) {
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

/** rubric_version = hash(rubric.yaml + prompts, sorted by filename) — spec §14. */
export function computeRubricVersion(rubricRaw: string, prompts: ReadonlyArray<JudgePrompt>): string {
  const parts = [rubricRaw, ...[...prompts].sort((a, b) => a.filename.localeCompare(b.filename)).map((p) => p.content)];
  return rubricVersion(parts);
}

export function loadTrack(instrumentDir: string, trackId: string): InstrumentTrack {
  const dir = join(instrumentDir, "tracks", trackId);
  if (!existsSync(dir)) fail(dir, `track directory missing for '${trackId}'`);
  const trackRaw = readFileSync(join(dir, "track.yaml"), "utf8");
  const { plugin, config } = parseTrackConfig(trackRaw, join(dir, "track.yaml"));
  const rubricRaw = readFileSync(join(dir, "rubric.yaml"), "utf8");
  const rubric = parseRubric(rubricRaw, join(dir, "rubric.yaml"));
  if (rubric.track !== trackId) {
    fail(join(dir, "rubric.yaml"), `rubric.track '${rubric.track}' does not match directory '${trackId}'`);
  }
  const prompts: JudgePrompt[] = [];
  const promptsDir = join(dir, "prompts");
  if (existsSync(promptsDir)) {
    for (const f of readdirSync(promptsDir).sort()) {
      if (!f.endsWith(".md")) continue;
      prompts.push(parsePrompt(readFileSync(join(promptsDir, f), "utf8"), join(promptsDir, f)));
    }
  }
  const judgedCriteria = rubric.criteria.filter((c) => c.judged);
  if (judgedCriteria.length > 0 && prompts.length === 0) {
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
  const tracks = manifest.tracks.map((t) => loadTrack(instrumentDir, t));
  return { manifest, tracks };
}
