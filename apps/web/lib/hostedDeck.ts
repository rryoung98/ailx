/**
 * HOSTED CONTENT: what a hosted sitting presents, as the server dealt it —
 * the T2 deck from `GET /api/attempts/:id/items`, and the T1/T3/T4 form from
 * `GET /api/attempts/:id/track/:trackId`.
 *
 * WHY THIS EXISTS: `lib/instrument.ts` builds a deck out of the bundled
 * RELEASED-PRACTICE tier, which is the only bank a browser may hold. In
 * hosted mode that is the wrong deck — the candidate must sit the OPERATIONAL
 * bank, which lives behind the server-only `@ailx/instrument` and reaches the
 * browser only through the redacted item view (docs/ARCHITECTURE.md §2.1,
 * §4). So hosted mode asks the server what it dealt, and presents exactly
 * that; the server is the authority on what was shown, and on what it means.
 *
 * Nothing here re-derives a deck, and nothing here holds a key: during a
 * sitting the response carries no `key` and no `rationale` at all.
 */
import { validateT2PresentationConfig, type T2PresentationConfig } from "@ailx/track-t2";
import {
  validateT3PresentationConfig,
  type T3Hosted,
  type T3PresentationConfig,
  type T3RevealedPlant,
  type T3Turn,
} from "@ailx/track-t3";
import type { TrackId } from "@ailx/session";
import {
  browserApiOptions,
  fetchServerDeck,
  fetchServerTrackView,
  postT3Assist,
  postTranscriptTurn,
  type PresentedTrackView,
} from "./persistence";
import type { PresentedDeck } from "./persistence";

/** A `RedactedItem` as it arrives on the wire. */
type WireItem = Record<string, unknown>;

/**
 * Wire item → presented item. An explicit copy, not a spread: `phase`,
 * `yourChoice` and `correct` are transport/report facts, not deck content,
 * and a field the server adds tomorrow must be opted IN here rather than
 * silently becoming part of what the Runner is handed.
 *
 * `key`/`rationale`/`teaching` are copied only when the server sent them,
 * which it does only after `attempts.finalized_at` — the review phase, where
 * the replay may legitimately teach the answer.
 */
function presentedItem(raw: WireItem): Record<string, unknown> {
  const item: Record<string, unknown> = {
    id: raw.id,
    type: raw.type,
    stem: raw.stem,
    material: raw.material,
    options: raw.options,
    difficulty: raw.difficulty,
  };
  for (const field of ["signal", "exposureSeconds", "key", "rationale", "teaching"] as const) {
    if (raw[field] !== undefined) item[field] = raw[field];
  }
  return item;
}

/**
 * The presentation config for a server-dealt deck. Validated with the
 * PRESENTATION validator: a sitting deck has no marking scheme, and
 * demanding one would refuse the only deck a candidate may be shown.
 */
export function t2ConfigFromDeck(deck: PresentedDeck): T2PresentationConfig {
  if (deck.items.length === 0) {
    throw new Error("the server dealt this attempt no T2 items");
  }
  return validateT2PresentationConfig({ items: deck.items.map(presentedItem) });
}

/**
 * The hosted T2 deck for `attemptId`, or null when this run's deck is this
 * build's own (static demo, or a server-mode run the backend never created).
 * Throws DeckMismatchError when the dealt deck is not the recorded one, and
 * a plain Error when the server cannot be reached — the caller must not
 * substitute a locally built deck for either.
 */
export async function fetchHostedT2Config(
  attemptId: string,
): Promise<T2PresentationConfig | null> {
  const deck = await fetchServerDeck(attemptId);
  return deck === null ? null : t2ConfigFromDeck(deck);
}

/**
 * The answer keys for a FINALIZED hosted attempt, or null when the server has
 * none to give (static demo, a run it never created, or an attempt still open
 * — during a sitting it serves no key at all, by design).
 *
 * This is the review phase, where the candidate is entitled to the marking
 * scheme for their OWN deck: the server decides that from
 * `attempts.finalized_at`, never from anything the browser asks for.
 */
export async function fetchServerAnswerKeys(
  attemptId: string,
): Promise<Record<string, number> | null> {
  const deck = await fetchServerDeck(attemptId);
  if (deck === null || deck.phase !== "review") return null;
  const keys: Record<string, number> = {};
  for (const item of deck.items) {
    if (typeof item.id === "string" && typeof item.key === "number") keys[item.id] = item.key;
  }
  return Object.keys(keys).length > 0 ? keys : null;
}

// ---------------------------------------------------------------------------
// Hosted TRACK FORMS (t1 / t3 / t4)
// ---------------------------------------------------------------------------

const str = (v: unknown, what: string): string => {
  if (typeof v !== "string" || v.length === 0) throw new Error(`the server's track view has no ${what}`);
  return v;
};
const num = (v: unknown, fallback: number): number =>
  typeof v === "number" && Number.isFinite(v) ? v : fallback;

/**
 * The T3 SITTING scenario, as the Runner may hold it: an explicit copy of the
 * five presented fields and nothing else. Same discipline as
 * {@link presentedItem}, and here it is the whole measurement — a field the
 * server adds tomorrow must be opted IN, never spread in, because the fields
 * this view is defined by NOT carrying (`plantedErrors`, every `truth`, every
 * trigger `topic`) are the answer key of the track.
 *
 * `hosted` is the seam the Runner reaches the server through. Its presence is
 * also what makes the local simulator unreachable: the presentation validator
 * refuses a config that carries both a hosted seam and a plant list.
 */
export function t3ConfigFromView(
  view: Record<string, unknown>,
  hosted: T3Hosted,
): T3PresentationConfig {
  return validateT3PresentationConfig({
    title: str(view.title, "T3 title"),
    brief: str(view.brief, "T3 brief"),
    sourceTitle: str(view.sourceTitle, "T3 source title"),
    sourceExcerpt: str(view.sourceExcerpt, "T3 source excerpt"),
    minWords: num(view.minWords, 120),
    hosted,
  });
}

/**
 * The T4 brief, audience and quotas as the server dealt them. Withheld from
 * the WORLD rather than from the candidate (CONTRACT §1): a published brief
 * lets a candidate pre-generate a set before the clock starts. The rubric,
 * present only in the review view, is deliberately not copied — the direction
 * judge's marking scheme is not the Runner's business.
 */
export function t4ConfigFromView(view: Record<string, unknown>): Record<string, unknown> {
  return {
    brief: str(view.brief, "T4 brief"),
    audience: str(view.audience, "T4 audience"),
    finalImageQuota: num(view.finalImageQuota, 3),
    finalVideoQuota: num(view.finalVideoQuota, 1),
    noteMaxChars: num(view.noteMaxChars, 1200),
  };
}

/** The plants a REVIEW view revealed; [] on a sitting view, which has none. */
function plantsOf(v: PresentedTrackView): readonly T3RevealedPlant[] {
  const raw = v.view.plants;
  if (v.phase !== "review" || !Array.isArray(raw)) return [];
  return raw.flatMap((p) => {
    const o = p as Record<string, unknown>;
    return typeof o?.ref === "string" && typeof o?.claim === "string" && typeof o?.truth === "string"
      ? [{
          ref: o.ref,
          claim: o.claim,
          truth: o.truth,
          surfaced: o.surfaced === true,
          stance: (o.stance === "challenged" || o.stance === "accepted" ? o.stance : "ignored") as
            T3RevealedPlant["stance"],
        }]
      : [];
  });
}

/**
 * The seam the hosted T3 Runner talks to the exam service through.
 *
 * Transcript mirroring is SERIALIZED and best-effort in the same shape as the
 * response mirror in `lib/persistence.ts`: these rows are what the server's
 * score reads for stances, and re-posting the same seq is a no-op there, so
 * ordering matters and a duplicate does not.
 */
export function hostedT3Bridge(attemptId: string): T3Hosted {
  const opts = browserApiOptions();
  let queue: Promise<unknown> = Promise.resolve();
  return {
    assist: async (req) => {
      const reply = await postT3Assist(window.localStorage, opts, attemptId, req);
      return { text: reply.text, claimRefs: reply.claimRefs };
    },
    record: (turn: T3Turn) => {
      queue = queue
        .then(() =>
          postTranscriptTurn(window.localStorage, opts, attemptId, "t3", {
            seq: turn.seq,
            verb: turn.verb,
            object: turn.object,
            ...(turn.text !== undefined ? { text: turn.text } : {}),
            ...(turn.claimIds !== undefined ? { claimRefs: turn.claimIds } : {}),
          }),
        )
        .catch((err: unknown) => {
          // The local log and checkpoint already hold this turn, and the
          // server row is keyed by seq, so a retry costs nothing — but a
          // silent loss would cost the candidate their stance, so say so.
          console.warn("[ailx t3] transcript turn not mirrored", err);
        });
    },
    reveal: async () => {
      const v = await fetchServerTrackView(attemptId, "t3");
      // Sitting (or a run the server never created): nothing is revealed.
      return v === null || v.phase !== "review" ? null : plantsOf(v);
    },
  };
}

/**
 * The config a HOSTED run presents for `trackId`, or null when this run's
 * content is this build's own — static demo, or a server-mode run the backend
 * never created. ONE entry point for every track: the fetch, the "is this the
 * server's run at all" test and the failure rule live in `lib/persistence.ts`,
 * and only the per-track shaping differs.
 *
 * T1 is deliberately never fetched: its brief is PUBLIC by design (an open
 * build task, identical for every candidate, published in the spec). What T1
 * withholds is its marking scheme, and that never reached the browser in the
 * first place — commit 78e3cef took the judge prompts out of the bundle.
 */
export async function fetchHostedTrackConfig(
  attemptId: string,
  trackId: TrackId,
): Promise<unknown | null> {
  if (trackId === "t1") return null;
  if (trackId === "t2") return fetchHostedT2Config(attemptId);
  const view = await fetchServerTrackView(attemptId, trackId);
  if (view === null) return null;
  return trackId === "t3"
    ? t3ConfigFromView(view.view, hostedT3Bridge(attemptId))
    : t4ConfigFromView(view.view);
}
