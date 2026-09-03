/**
 * PUBLIC instrument wiring: derives track configs from the RELEASED PRACTICE
 * TIER (instruments/demo-2026.1/snapshot.json) into the config shapes each
 * track plugin validates (F16).
 *
 * THIS MODULE IS BUNDLED INTO THE BROWSER, so it may only ever read a bank
 * whose keys are published ON PURPOSE. It used to import
 * `instruments/2026.1/snapshot.json`, and the deployed GitHub Pages export
 * therefore carried all 104 operational T2 items with `key`, `rationale` and
 * `provenance` — 40 occurrences of `"key":"ai"` in one chunk. The operational
 * bank now lives behind `@ailx/instrument`, which is server-only; two tests
 * keep it that way (`test/serverOnlyPages.test.ts` bans the import,
 * `test/bundleSecrecy.test.ts` greps the BUILT bundles of both build modes).
 *
 * T2 items come from the snapshot's embedded bank; per-item exposure
 * seconds come from the snapshot's instrument config blocks (F3). The T3
 * demo scenario remains code-side (no content-package changes); its hash is
 * pinned and asserted at test time.
 */
import {
  D_PRIME_CEILING,
  maxAttainableDPrime,
  sampleT2DeckIds,
  t2DeckSeed,
  type T2DeckCandidate,
  type T2DeckComposition,
} from "@ailx/track-t2";
import { t3TimeBudgetSeconds, type T3PresentationConfig } from "@ailx/track-t3";
import snapshotRaw from "../../../../instruments/demo-2026.1/snapshot.json";
import { assetUrl } from "../mode";

interface BankItem {
  id: string;
  type: string;
  locale: string;
  difficulty: string;
  stem: string;
  material: {
    kind: string;
    text?: string;
    svg?: string;
    dataUri?: string;
    data_uri?: string;
    [k: string]: unknown;
  };
  options: Array<{ id: string; label: string }>;
  key: string;
  rationale: string;
  provenance?: unknown;
}

interface SnapshotBlock {
  id: string;
  /** How many items THIS package's bank holds in the block, all locales. */
  bank_items?: number;
  exposure_seconds?: number | null;
  untimed?: boolean;
}

/** `config.deck` as the instrument declares it (snake_case, from track.yaml). */
interface SnapshotDeck {
  media_pairs?: unknown;
  text?: unknown;
  provenance?: unknown;
}

interface SnapshotTrack {
  trackId: string;
  plugin: string;
  config: Record<string, unknown>;
  rubricVersion: string;
  bank?: { items: BankItem[]; sha256?: string };
}

/**
 * Build-time content address of a track's score() source closure, emitted by
 * `@ailx/content-tools build-snapshot --scorers` (see packages/content-tools/
 * src/scorers.ts). This is the audit digest: it identifies the scoring SOURCE,
 * so it survives a bundler bump that changes nothing about how a score is
 * computed.
 */
export interface SnapshotScorer {
  trackId: "t1" | "t2" | "t3" | "t4";
  packageName: string;
  packageVersion: string;
  sources: Array<{ path: string; sha256: string }>;
  externals: string[];
  digest: string;
}

interface Snapshot {
  format: string;
  instrument: { manifest: Record<string, unknown>; tracks: SnapshotTrack[] };
  scorers?: SnapshotScorer[];
}

export const SNAPSHOT = snapshotRaw as unknown as Snapshot;

const SNAPSHOT_TRACK_IDS: Record<"t1" | "t2" | "t3" | "t4", string> = {
  t1: "t1-creative-build",
  t2: "t2-discrimination",
  t3: "t3-reasoning",
  t4: "t4-generative",
};

export function snapshotTrack(trackId: "t1" | "t2" | "t3" | "t4"): SnapshotTrack {
  const t = SNAPSHOT.instrument.tracks.find(
    (x) => x.trackId === SNAPSHOT_TRACK_IDS[trackId],
  );
  if (!t) throw new Error(`snapshot missing track ${trackId}`);
  return t;
}

/** Per-track rubricVersion from the committed snapshot (F12). */
export function snapshotRubricVersion(trackId: "t1" | "t2" | "t3" | "t4"): string {
  return snapshotTrack(trackId).rubricVersion;
}

/**
 * Per-track scoring digest from the committed snapshot (F12). Fails CLOSED:
 * an attempt must never persist a score with a digest the platform cannot
 * derive from source. Regenerate with
 * `pnpm --filter @ailx/content-tools run snapshot:2026.1`.
 */
export function snapshotScoringDigest(trackId: "t1" | "t2" | "t3" | "t4"): string {
  const s = SNAPSHOT.scorers?.find((x) => x.trackId === trackId);
  if (!s) {
    throw new Error(
      `snapshot carries no scoring digest for ${trackId} — rebuild it with ` +
      `'pnpm --filter @ailx/content-tools run snapshot:2026.1'`,
    );
  }
  return s.digest;
}

/** Bank item type → T2Config item type. */
const TYPE_MAP: Record<string, string> = {
  "text-authenticity": "message-page",
  "image-provenance": "media-image",
  "message-hostility": "message-email",
  "provenance-reasoning": "provenance",
};

const DIFF_MAP: Record<string, number> = { easy: 0.25, medium: 0.5, hard: 0.85 };

/** Option ids that name the SIGNAL (synthetic / hostile) call. */
const SIGNAL_OPTION_IDS = new Set(["ai", "synthetic", "hostile"]);

/**
 * Per-item-type exposure seconds, read from the snapshot's instrument
 * config blocks (media-image 6, media-video 12, media-audio 10,
 * message-email 25, message-page 25; provenance untimed → undefined).
 */
export function t2ExposureSeconds(): Record<string, number | undefined> {
  const blocks = (snapshotTrack("t2").config.blocks ?? []) as SnapshotBlock[];
  const map: Record<string, number | undefined> = {};
  for (const b of blocks) {
    map[b.id] =
      b.untimed === true || b.exposure_seconds == null
        ? undefined
        : b.exposure_seconds;
  }
  return map;
}

function materialToString(m: BankItem["material"]): string {
  // The committed bank uses snake_case data_uri; accept camelCase and raw
  // svg too so image items always render as images (F3).
  if (m.kind === "image" && typeof m.src === "string") {
    // Real media files under apps/web/public, served beneath the basePath.
    return assetUrl(`/${String(m.src).replace(/^\/+/, "")}`);
  }
  if (typeof m.data_uri === "string") return m.data_uri;
  if (typeof m.dataUri === "string") return m.dataUri;
  if (typeof m.svg === "string") {
    return `data:image/svg+xml;base64,${typeof btoa === "function" ? btoa(unescape(encodeURIComponent(m.svg))) : Buffer.from(m.svg, "utf8").toString("base64")}`;
  }
  if (typeof m.text === "string") return m.text;
  if (m.kind === "email") {
    const parts: string[] = [];
    if (typeof m.from_display === "string" || typeof m.from_address === "string") {
      parts.push(`From: ${[m.from_display, m.from_address && `<${String(m.from_address)}>`].filter(Boolean).join(" ")}`);
    }
    if (typeof m.subject === "string") parts.push(`Subject: ${m.subject}`);
    if (typeof m.body === "string") parts.push("", String(m.body));
    if (parts.length > 0) return parts.join("\n");
  }
  if (typeof m.body === "string") return m.body;      // chat
  if (typeof m.details === "string") return m.details; // scenario
  return JSON.stringify(m);
}

/** Full localized bank in T2Config item shape (pre-sampling). */
function t2TransformedItems(locale: string) {
  const bank = snapshotTrack("t2").bank;
  if (!bank) throw new Error("snapshot t2 bank missing");
  const exposure = t2ExposureSeconds();
  // Unknown/unpopulated locales fall back to the en deck rather than an
  // empty (unscorable) sitting.
  const wanted = bank.items.some((i) => i.locale === locale) ? locale : "en";
  const items = bank.items
    .filter((i) => i.locale === wanted)
    .map((i) => {
      const type = TYPE_MAP[i.type] ?? "provenance";
      const signal = i.options.findIndex((o) => SIGNAL_OPTION_IDS.has(o.id));
      return {
        id: i.id,
        type,
        stem: i.stem,
        material: materialToString(i.material),
        options: i.options.map((o) => o.label),
        key: Math.max(0, i.options.findIndex((o) => o.id === i.key)),
        ...(signal >= 0 ? { signal } : {}),
        difficulty: DIFF_MAP[i.difficulty] ?? 0.5,
        rationale: i.rationale,
        ...(exposure[type] !== undefined ? { exposureSeconds: exposure[type] } : {}),
      };
    });
  return items;
}

/** Snapshot bank items (content-addressed upstream) → T2Config item shape. */
export function t2Items(locale: string = "en", attemptId?: string) {
  const items = t2TransformedItems(locale);
  const byId = new Map(items.map((i) => [i.id, i]));
  return t2DeckItemIds(locale, attemptId).map((id) => byId.get(id)!);
}

/** Repo-local real-media items (served files) vs data-URI/text material. */
const isMediaMaterial = (material: string) => material.startsWith("/");

/** Content-addressed sha256 of the embedded T2 bank. */
export function t2BankSha256(): string {
  const sha = snapshotTrack("t2").bank?.sha256;
  if (!sha) throw new Error("snapshot t2 bank sha256 missing");
  return sha;
}

/**
 * WHAT ONE SITTING IS DEALT, read from the instrument rather than repeated
 * here: `config.deck` in the released tier's t2 `track.yaml`, carried into
 * the snapshot. Fails CLOSED — an absent or malformed declaration throws
 * instead of falling back to numbers this module made up. Before TEN-48 the
 * sampler held the numbers, `track.yaml` declared a 132-item form, and the
 * bank held 20; nothing compared the three.
 */
export function t2DeckComposition(): T2DeckComposition {
  const deck = snapshotTrack("t2").config.deck as SnapshotDeck | undefined;
  const count = (field: "media_pairs" | "text" | "provenance"): number => {
    const n = deck?.[field];
    if (typeof n !== "number" || !Number.isInteger(n) || n < 0) {
      throw new Error(
        `instrument declares no usable config.deck.${field} for t2 — it must be a ` +
          `non-negative integer in instruments/demo-2026.1/tracks/t2-discrimination/track.yaml`,
      );
    }
    return n;
  };
  return { mediaPairs: count("media_pairs"), text: count("text"), provenance: count("provenance") };
}

/**
 * PER-ATTEMPT DECK: presented item ids, sampled by the pure @ailx/track-t2
 * sampler. Seed = sha256(attemptId + bank sha) so the deck is re-derivable
 * from stored inputs alone (server records the same ids at attempt
 * creation; scoring recomputes them). Without an attemptId the fixed
 * default deck is returned (sample fixtures, /validate).
 *
 * NOTE: the OPERATIONAL instrument uses fixed, equated forms (spec §T2) —
 * per-attempt variation is the hosted-demo exposure model. Static mode
 * seeds from the LOCAL attempt id; server mode seeds from the SERVER
 * attempt id (the session adopts it at start), same derivation.
 */
function t2DeckCandidates(locale: string): T2DeckCandidate[] {
  return t2TransformedItems(locale).map((i) => ({
    id: i.id,
    kind:
      i.type === "provenance"
        ? ("provenance" as const)
        : isMediaMaterial(i.material)
          ? ("media" as const)
          : ("text" as const),
    signal: i.signal === i.key,
    difficulty: i.difficulty,
  }));
}

/**
 * AN OVERSIZED DECLARATION REFUSES; A THIN TRANSLATION DEGRADES (TEN-73).
 *
 * The sampler is capped by the pool it is handed, so a `config.deck` no bank
 * can satisfy is dealt SHORT and scored — a deck nobody declared, reported as
 * if it were the form. That is refused here, against the CANONICAL `en` bank:
 * the declaration is one global statement, and `en` is the inventory it is a
 * statement about (it is also the locale every unpopulated locale falls back
 * to).
 *
 * `ja` and `ko` are deliberately NOT refused. They hold one provenance item
 * each against a declared two, so they are dealt 5 where `en` is dealt 6, and
 * t2's scoring already scales to the deck it was given. Refusing them would
 * close the Japanese and Korean demo instead of the defect, and the policy is
 * already written down in t2's `track.yaml`: a locale that cannot supply a
 * stratum deals fewer items rather than an unbalanced deck. Making a thin
 * translation refuse needs new items in the released bank — a bank change, a
 * new bank hash and a re-vendor — not a guard.
 */
function assertT2DeckDeclarationIsDealable(deck: T2DeckComposition): void {
  const pool = t2DeckCandidates("en");
  const n = (kind: T2DeckCandidate["kind"], signal?: boolean) =>
    pool.filter((c) => c.kind === kind && (signal === undefined || c.signal === signal)).length;
  const short: string[] = [];
  // A media PAIR needs one of each class, so each class caps the pair count.
  const pairs = Math.min(n("media", true), n("media", false));
  if (deck.mediaPairs > pairs) short.push(`media_pairs ${deck.mediaPairs} against ${pairs}`);
  if (deck.text > n("text")) short.push(`text ${deck.text} against ${n("text")}`);
  if (deck.provenance > n("provenance")) {
    short.push(`provenance ${deck.provenance} against ${n("provenance")}`);
  }
  if (short.length > 0) {
    throw new Error(
      `instrument declares a t2 deck the released en bank cannot deal: ${short.join("; ")} ` +
        "— fix config.deck in instruments/demo-2026.1/tracks/t2-discrimination/track.yaml, " +
        "or add the items. A short deal would be scored as if it were the declared form.",
    );
  }
}

export function t2DeckItemIds(locale: string = "en", attemptId?: string): string[] {
  const deck = t2DeckComposition();
  assertT2DeckDeclarationIsDealable(deck);
  return sampleT2DeckIds(
    t2DeckCandidates(locale),
    deck,
    attemptId === undefined ? undefined : t2DeckSeed(attemptId, t2BankSha256()),
  );
}

/**
 * Deck records for server-side exposure logging: what @ailx/backend persists
 * (attempt_decks) at attempt creation. MUST stay byte-identical to what the
 * client presents — both sides call t2DeckItemIds with the same attempt id.
 */
export function t2DeckRecords(
  attemptId: string,
  locale: string = "en",
): Array<{ trackId: "t2"; bankSha256: string; itemIds: string[] }> {
  return [{ trackId: "t2", bankSha256: t2BankSha256(), itemIds: t2DeckItemIds(locale, attemptId) }];
}

/**
 * Answer keys for the FULL bank (not just one deck) — report/rationale
 * rendering must resolve any rotated deck's item ids.
 */
export function t2AnswerKeys(locale: string = "en"): Record<string, number> {
  const bank = snapshotTrack("t2").bank;
  if (!bank) throw new Error("snapshot t2 bank missing");
  const keys: Record<string, number> = {};
  for (const i of bank.items) {
    if (i.locale !== locale) continue;
    keys[i.id] = Math.max(0, i.options.findIndex((o) => o.id === i.key));
  }
  return keys;
}

/**
 * T3 RELEASED-PRACTICE SCENARIO — published on purpose, exactly like the
 * released item keys in `instruments/demo-2026.1`. Its planted errors are
 * practice material, not an answer key: no score of record is issued from it,
 * and `apps/web/test/bundleSecrecy.test.ts` takes its T3 needles from the
 * OPERATIONAL instrument so this scenario cannot make the guard self-trip.
 *
 * The OPERATIONAL scenario is the opposite: which surfaced claim is planted,
 * every plant's `truth`, and the operational brief/sourceExcerpt never reach a
 * browser — the exam service serves the transcript with plants UNMARKED and
 * grades detection server-side (docs/ARCHITECTURE.md §4).
 *
 * Kept code-side by design — NO content-package changes — with its canonical
 * hash pinned as T3_SCENARIO_SHA256 and asserted by tests.
 */
export const T3_SCENARIO = {
  title: "Trilateral AI workforce readiness memorandum",
  brief:
    "Advise the U.S. delegation lead: should the three governments adopt the shared AI-skills certification track in 2027? Take a position a negotiator could act on.",
  sourceTitle: "US\u2013Japan\u2013Korea Trilateral AI Workforce Readiness Memorandum (2026) \u2014 Staff Review Draft",
  sourceExcerpt:
    "Prepared by the trilateral working group on AI workforce readiness (Washington · Tokyo · Seoul). Status: staff review draft — not yet adopted by any of the three governments.\n\nSection 2.1 — Scope. The memorandum covers public-sector AI reskilling programs in the United States, Japan, and the Republic of Korea, and a proposed shared AI-skills certification track to open in 2027.\n\nSection 3.2 — Certification backlog. The median wait for advanced AI-role certification reached 38 months in 2025 across the three countries. In the two pilot ministries that pooled their assessor panels, shared assessment cut median processing time by 41%.\n\nSection 4.1 — Withdrawal from training. A completion bond of $2 per enrolled training hour, refunded on completion, deterred speculative enrollment; program withdrawal rates fell from 62% to 29%.\n\nSection 5.3 — Small employers. Firms under 20 employees saw compliance and assessment costs rise 18% under the pooled model, a regressive effect the working group recommends offsetting with a fee cap. The fee cap is a staff recommendation; no adopted instrument mandates it.\n\nSection 6.2 — Assessor supply. The three countries between them certified 1,240 assessors in 2025 against an estimated need of 3,100. The working group notes that assessor training takes 11 months and that no pooled assessor register exists yet.\n\nSection 7.1 — Cost. The pooled model is costed at $46m over three years, of which $31m is assessor training and $9m is the shared registry platform. The remaining $6m is contingency. No cost-benefit ratio is stated anywhere in the draft.\n\nSection 8.4 — Mutual recognition. Recognition of each country's existing credentials would begin in 2028, one year after the shared track opens, and only for credentials issued after the track's start date. Retroactive recognition was considered and not recommended.\n\nSection 9.2 — Evaluation. The working group proposes a two-year evaluation window with no control group, and states that attribution of any employment effect to the certification track will therefore be weak.",
  /**
   * EIGHT planted errors, not three.
   *
   * The planted-error component carries 50 of T3's 160 points and its item
   * count IS the number of plants that surface. A four-item subtest cannot
   * support that weight: catching 2 of 4 versus 3 of 4 is 12.5 points decided
   * by essentially one event. `ERROR_CATCH_MIN_SURFACED` in the scorer
   * declares 8 as the floor and flags any sitting that comes in under it.
   *
   * Two instances of each of the four stable error FAMILIES — misattributed
   * figure, false causal claim, fabricated citation, wrong calculation. The
   * families are what re-versions cheaply: new instances of known families,
   * not new families.
   */
  plantedErrors: [
    {
      id: "pe-figure",
      topic: "certification backlog median wait",
      claim: "The memorandum puts the median certification wait at 61 months in 2025.",
      truth: "Section 3.2 states the median wait was 38 months in 2025.",
    },
    {
      id: "pe-figure-assessors",
      topic: "assessor supply register certified",
      claim:
        "The three countries certified 2,400 assessors in 2025, close to the estimated need of 3,100, and a pooled assessor register is already operating.",
      truth:
        "Section 6.2 states 1,240 assessors against a need of 3,100, and says no pooled assessor register exists yet.",
    },
    {
      id: "pe-causal",
      topic: "withdrawal completion bond speculative",
      claim:
        "Withdrawal rates fell mainly because labor markets tightened, not because of the $2 completion bond \u2014 the memorandum concludes the bond had no measurable effect.",
      truth:
        "Section 4.1 attributes the fall from 62% to 29% to the completion bond; the memorandum draws no labor-market conclusion.",
    },
    {
      id: "pe-causal-evaluation",
      topic: "evaluation window employment effect attribution",
      claim:
        "The two-year evaluation window is designed to establish that the certification track causes employment gains, so the adoption case can rest on it.",
      truth:
        "Section 9.2 proposes an evaluation with NO control group and states that attribution of any employment effect will therefore be weak.",
    },
    {
      id: "pe-citation",
      topic: "OECD annex 2023 compliance mandate",
      claim:
        "OECD Council Annex 2023-B, adopted March 2026, already mandates fee caps for small employers, so Section 5.3 is moot.",
      truth:
        "No such annex exists in the record. Section 5.3 says the fee cap is a staff recommendation, not a mandate.",
    },
    {
      id: "pe-citation-recognition",
      topic: "mutual recognition retroactive credentials 2028",
      claim:
        "Annex C of the memorandum sets out retroactive recognition of credentials issued before the track opens, on the model of the 2024 Seoul Accord.",
      truth:
        "Section 8.4 says retroactive recognition was considered and NOT recommended. There is no Annex C and no 2024 Seoul Accord in this document.",
    },
    {
      id: "pe-arithmetic-cost",
      topic: "cost assessor training registry contingency",
      claim:
        "Assessor training and the registry platform together account for about half the $46m programme cost, leaving roughly $23m of contingency.",
      truth:
        "Section 7.1: $31m + $9m = $40m of $46m, i.e. about 87%. Contingency is $6m, not $23m.",
    },
    {
      id: "pe-arithmetic-backlog",
      topic: "processing time saving months pooled panels",
      claim:
        "A 41% cut on a 38-month median saves about 6 months, which is too small to change the negotiating position.",
      truth:
        "Section 3.2: 41% of 38 months is about 15.6 months, not 6. The saving is roughly two and a half times what the claim states.",
    },
  ],
  /**
   * FOUR correct-advice claims, not two. Under-reliance is the positive half
   * of the reliance construct and it now carries 30 points; refusing correct,
   * source-grounded help is a failure in the same measurement, so the
   * positive tail needs enough items to be a rate rather than an anecdote.
   */
  correctAdvice: [
    {
      id: "ca-cluster",
      topic: "shared assessment processing time",
      claim:
        "Pooled assessor panels cut median processing time by 41% in both pilot ministries (Section 3.2) \u2014 strong evidence for the shared track.",
    },
    {
      id: "ca-equity",
      topic: "small employers fee",
      claim:
        "Section 5.3 flags an 18% cost increase for firms under 20 employees; a fee cap offsets the regressive effect.",
    },
    {
      id: "ca-capacity",
      topic: "assessor training eleven months capacity",
      claim:
        "Section 6.2 is the binding constraint on the 2027 date: 1,240 assessors against a need of 3,100, and 11 months to train one. The gap has to be closed before the track opens, not after.",
    },
    {
      id: "ca-sequencing",
      topic: "recognition begins 2028 sequencing",
      claim:
        "Section 8.4 puts mutual recognition a year behind the track opening and limits it to credentials issued afterwards \u2014 so the first cohort carries a credential nobody else recognises for a year. That sequencing is negotiable and worth raising.",
    },
  ],
  minWords: 120,
};

/** Pinned sha256(canonicalJson(T3_SCENARIO)) — asserted at test time. */
export const T3_SCENARIO_SHA256 =
  "eade8c2db44a7665bcf3b0ce8cc900de6911518213c4f21eef6f4b5fa063ad56";

/**
 * HOW MANY PLANTS THE INSTRUMENT DECLARES: `config.seeded_errors.count_per_form`
 * in the released tier's t3 `track.yaml`, carried into the snapshot. Fails
 * CLOSED — an absent or malformed declaration throws instead of falling back to
 * the length of whatever form happens to be in this file.
 */
export function t3DeclaredPlantCount(): number {
  const seeded = snapshotTrack("t3").config.seeded_errors as
    | { count_per_form?: unknown }
    | undefined;
  const n = seeded?.count_per_form;
  if (typeof n !== "number" || !Number.isInteger(n) || n <= 0) {
    throw new Error(
      "instrument declares no usable config.seeded_errors.count_per_form for t3 — it must " +
        "be a positive integer in instruments/demo-2026.1/tracks/t3-reasoning/track.yaml",
    );
  }
  return n;
}

/**
 * THE FORM MUST BE THE FORM THE INSTRUMENT DECLARES (TEN-73). The plant count
 * is the item count of a component carrying 50 of T3's 160 points, so a
 * declaration the form does not satisfy is a measurement error, not a typo:
 * the released `track.yaml` said 4 while this scenario planted 8, and every
 * sitting quietly raised `errorCatchRate.underpowered` instead of anyone
 * noticing. The exam service refuses such a package at load; this repo can
 * break the number freely unless it refuses too, so it refuses here.
 */
export function t3Scenario(): typeof T3_SCENARIO {
  const declared = t3DeclaredPlantCount();
  const planted = T3_SCENARIO.plantedErrors.length;
  if (planted !== declared) {
    throw new Error(
      `t3 form plants ${planted} errors but the instrument declares ${declared} — ` +
        "fix instruments/demo-2026.1/tracks/t3-reasoning/track.yaml " +
        "(config.seeded_errors.count_per_form) or the scenario, and regenerate the snapshot",
    );
  }
  return T3_SCENARIO;
}

/**

 * Per-track config passed to the real Runner + score(). The SESSION's
 * locale (SessionConfig.locale, chosen via the header switcher) selects
 * the localized T2 deck; `attemptId` drives the DEMO-ONLY T2 deck rotation.
 * Presentation and scoring must pass the SAME locale + attemptId so the
 * scored deck is the presented deck. Omitted attemptId → fixed default
 * deck (fixtures, /validate). T1/T3/T4 demo briefs stay English.
 */
/**
 * The T3 sitting clock this build's form declares, in seconds, or undefined
 * when it declares none (TEN-30). The static demo form declares nothing, so
 * the demo budget is unchanged; a static form built for the 30-minute
 * condition sets the sitting clock here, in the one place the static build
 * chooses it, so the record and the countdown cannot disagree.
 *
 * A HOSTED sitting is NOT covered by this. The exam service serves the form
 * and owns the sitting clock; this build still opens the session on its own
 * budgets, so a hosted 30-minute form would be recorded as the condition it
 * is and run against whatever budget the session was started with. Closing
 * that needs the service to carry a per-track budget into `attempt_started`,
 * which is the private repo's decision to make.
 */
export function t3FormBudgetSeconds(): number | undefined {
  return t3TimeBudgetSeconds(T3_SCENARIO as T3PresentationConfig);
}

export function trackConfig(
  trackId: "t1" | "t2" | "t3" | "t4",
  locale: string = "en",
  attemptId?: string,
): unknown {
  switch (trackId) {
    case "t1": return undefined;             // plugin defaults carry the demo brief
    case "t2": {
      const items = t2Items(locale, attemptId);
      // Short demo deck: full sensitivity points at the deck's ATTAINABLE
      // corrected d′ — the log-linear correction caps a perfect run well
      // below the operational 3.0 ceiling on a 4-item binary block, which
      // would truncate the 0-100 scale against the unchanged demo cohort.
      const binary = items.filter((i) => i.type !== "provenance");
      const nSignal = binary.filter((i) => i.signal === i.key).length;
      const nNoise = binary.length - nSignal;
      const ceiling = Math.min(D_PRIME_CEILING, maxAttainableDPrime(nSignal, nNoise));
      return { items, ...(ceiling > 0 ? { dPrimeCeiling: ceiling } : {}) };
    }
    case "t3": return t3Scenario();
    case "t4": return undefined;             // plugin defaults carry the demo brief
  }
}
