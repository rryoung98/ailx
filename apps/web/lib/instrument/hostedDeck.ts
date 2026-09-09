/**
 * HOSTED CONTENT: what a hosted sitting presents, as the server dealt it —
 * the T2 deck from `GET /api/attempts/:id/items`, and the T1/T3/T4 form from
 * `GET /api/attempts/:id/track/:trackId`.
 *
 * WHY THIS EXISTS: `lib/instrument/instrument.ts` builds a deck out of the bundled
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
import { isWithheldItem, type WithheldItem } from "@ailx/contract";
import type { TrackId } from "@ailx/session";
import {
  browserApiOptions,
  fetchServerDeck,
  fetchServerTrackView,
  postT3Assist,
  postTranscriptTurn,
  type PresentedTrackView,
} from "../data/persistence";
import type { PresentedDeck } from "../data/persistence";

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
  // A withheld item cannot be sat: it has no stem, no options and no
  // material. Presenting the rest would sit a SHORTER deck than the one the
  // exposure log records, which is the silent shortening TEN-61 exists to
  // stop, so this refuses and says how much of the deck is missing. The
  // REVIEW path does not come through here — it reports the withheld items
  // to the candidate instead (see {@link fetchServerReview}).
  const withheld = withheldFrom(deck.items);
  if (withheld.length > 0) {
    throw new Error(
      `the server withheld ${withheld.length} of ${deck.items.length} dealt T2 items ` +
        `(${withheld.map((w) => `${w.id}: ${w.withheld}`).join(", ")}) — ` +
        "a deck missing an item it dealt is not this sitting's deck",
    );
  }
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

/** The REVIEW view of a finalized hosted deck, as the report may hold it. */
export interface ServerReview {
  /**
   * Every item the sitting was DEALT, withheld ones included. This is the
   * number the candidate sat, and it is the only honest denominator: an item
   * the bank later lost must not make the deck look shorter than it was
   * (TEN-61).
   */
  dealt: number;
  /** Answer keys, by item id. A withheld item contributes none. */
  keys: Record<string, number>;
  /** The dealt items the service can no longer serve, in dealt order. */
  withheld: readonly WithheldItem[];
}

/**
 * The REVIEW view of a FINALIZED hosted attempt, or null when the server has
 * none to give (static demo, a run it never created, or an attempt still open
 * — during a sitting it serves no key at all, by design).
 *
 * This is the review phase, where the candidate is entitled to the marking
 * scheme for their OWN deck: the server decides that from
 * `attempts.finalized_at`, never from anything the browser asks for.
 *
 * The keys and the withheld list come off ONE response on purpose. They are
 * two readings of the same deck, and fetching them twice would let the report
 * count a deck the keys never came from.
 */
export async function fetchServerReview(attemptId: string): Promise<ServerReview | null> {
  const deck = await fetchServerDeck(attemptId);
  if (deck === null || deck.phase !== "review") return null;
  const keys: Record<string, number> = {};
  for (const item of deck.items) {
    if (typeof item.id === "string" && typeof item.key === "number") keys[item.id] = item.key;
  }
  return { dealt: deck.items.length, keys, withheld: withheldFrom(deck.items) };
}

/**
 * The withheld entries of a served deck, in dealt order.
 *
 * An entry that CLAIMS the withheld arm but fails validation — a reason this
 * build cannot name, a missing id, a `yourChoice` that is not an option index
 * — is kept as `unavailable` rather than dropped. Dropping it would leave the
 * item counted in `dealt` and named nowhere, which is the silent omission
 * this whole change exists to stop; `unavailable` says the honest thing, that
 * the item is gone and we cannot say why.
 */
function withheldFrom(items: ReadonlyArray<Record<string, unknown>>): WithheldItem[] {
  return items.flatMap((raw) => {
    if (isWithheldItem(raw)) return [raw];
    if (raw.phase !== "withheld") return [];
    return [
      {
        phase: "withheld" as const,
        id: typeof raw.id === "string" && raw.id.length > 0 ? raw.id : "(unidentified item)",
        withheld: "unavailable" as const,
      },
    ];
  });
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
 * Transcript turns that have not reached the service yet, as a number the
 * exam chrome can read.
 *
 * These rows are what the SERVER's T3 score reads for stances, so a dropped
 * one is a scored stance the candidate will never be credited with. `record()`
 * used to end in `.catch(console.warn)`: one transient failure removed the
 * turn from the evidence for good, and nothing on screen said so (TEN-122).
 *
 * A module-level store, like the mirror's own (`lib/data/persistence.ts`),
 * because the bridge is built per track mount and the page has to be able to
 * ask the question after the track is over.
 */
let outstandingTurns = 0;
const turnListeners = new Set<() => void>();

export function outstandingTranscriptTurns(): number {
  return outstandingTurns;
}

export function subscribeTranscriptTurns(listener: () => void): () => void {
  turnListeners.add(listener);
  return () => void turnListeners.delete(listener);
}

/**
 * COUNTED, not assigned from one queue's length: a resumed sitting can build
 * a second bridge for the same attempt while the first still holds a turn,
 * and a count written from either queue alone would hide the other's.
 */
function addOutstandingTurns(delta: number): void {
  if (delta === 0) return;
  outstandingTurns = Math.max(0, outstandingTurns + delta);
  for (const listener of turnListeners) listener();
}

/**
 * What a candidate is told while a T3 turn is still in this browser. Said
 * once, and said HERE rather than in the page, for two reasons: the count and
 * the sentence about the count belong together, and a Next.js page module may
 * export nothing but a page (a second export fails `next build` outright).
 */
export function turnsOutstandingCopy(n: number): string {
  return (
    `${n} T3 ${n === 1 ? "turn has" : "turns have"} not reached the exam service yet, and the `
    + "service scores your challenges from those. Foray is still sending them, so finishing "
    + "waits until they land. Keep this tab open."
  );
}

/** Tests only: a fresh module state without reloading the module. */
export function resetTranscriptTurns(): void {
  addOutstandingTurns(-outstandingTurns);
}

/**
 * How long the queue waits before re-posting a turn that failed. Capped and
 * additive rather than exponential: the candidate is still in the track, and
 * a stance that lands late is worth far more than one that lands politely.
 *
 * THE LAST DELAY REPEATS for as long as the tab is open. The queue never
 * gives up, because giving up is the state the page cannot describe: the
 * notice says Foray is still sending and finalize stays shut, so a queue that
 * had stopped trying would make that sentence false and leave nothing working
 * towards opening the button again.
 */
export const TURN_RETRY_DELAYS_MS = [1_000, 3_000, 10_000] as const;

const retryDelayMs = (attempt: number): number =>
  TURN_RETRY_DELAYS_MS[Math.min(attempt, TURN_RETRY_DELAYS_MS.length - 1)];

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The seam the hosted T3 Runner talks to the exam service through.
 *
 * Transcript mirroring is SERIALIZED, in the same shape as the response
 * mirror in `lib/data/persistence.ts` — but no longer fire-and-forget. A turn
 * that fails is RETRIED (the server row is keyed by seq, so a re-post of one
 * that did land is a no-op), and while any turn is still outstanding the page
 * says so and will not let the run be finalized: finalizing is the moment the
 * server stops accepting evidence, and doing it with a stance still in this
 * browser is how the score is computed from less than the candidate did.
 */
export function hostedT3Bridge(attemptId: string): T3Hosted {
  const opts = browserApiOptions();
  let queue: Promise<unknown> = Promise.resolve();
  /** The wire shape of a turn, taken from the poster so the two cannot drift. */
  type PendingTurn = Parameters<typeof postTranscriptTurn>[4];
  const pending: PendingTurn[] = [];

  /**
   * Post the head of the queue until it lands. NOTHING IS DROPPED and nothing
   * is given up on: a turn that has not landed stays counted, which is what
   * keeps the notice up and finalize shut, and it is still being re-posted,
   * which is what makes that notice true.
   */
  async function drain(): Promise<void> {
    while (pending.length > 0) {
      const body = pending[0];
      for (let attempt = 0; ; attempt++) {
        if (attempt > 0) await wait(retryDelayMs(attempt - 1));
        try {
          await postTranscriptTurn(window.localStorage, opts, attemptId, "t3", body);
          break;
        } catch (err) {
          // Loud for a developer, and — through the count — visible to the
          // candidate. Never swallowed.
          console.warn("[ailx t3] transcript turn not mirrored, retrying", err);
        }
      }
      pending.shift();
      addOutstandingTurns(-1);
    }
  }

  return {
    assist: async (req) => {
      const reply = await postT3Assist(window.localStorage, opts, attemptId, req);
      return { text: reply.text, claimRefs: reply.claimRefs };
    },
    record: (turn: T3Turn) => {
      pending.push({
        seq: turn.seq,
        verb: turn.verb,
        object: turn.object,
        ...(turn.text !== undefined ? { text: turn.text } : {}),
        ...(turn.claimIds !== undefined ? { claimRefs: turn.claimIds } : {}),
      });
      addOutstandingTurns(1);
      // Serialized: the rows are an ordered transcript, and a second pass
      // must not overtake the one still retrying.
      queue = queue.then(() => drain());
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
 * server's run at all" test and the failure rule live in `lib/data/persistence.ts`,
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
