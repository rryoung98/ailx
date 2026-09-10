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
 * exam chrome can read — and, since TEN-122's follow-up, as rows that OUTLIVE
 * this tab.
 *
 * These rows are what the SERVER's T3 score reads for stances, so a dropped
 * one is a scored stance the candidate will never be credited with. `record()`
 * used to end in `.catch(console.warn)`: one transient failure removed the
 * turn from the evidence for good, and nothing on screen said so (TEN-122).
 *
 * The retry fixed the failing POST and left the RELOAD. The queue was memory
 * only, so a refresh, a crash or a closed tab took the outstanding turns with
 * it: the count fell to 0, the "not sent yet" notice vanished, Finish enabled,
 * and the stance had still never reached the service — TEN-122's own end
 * state, reached by a different door. So the queue is PERSISTED, per attempt,
 * exactly as the response mirror next door persists `syncedThrough`
 * (`lib/data/persistence.ts`), and `resumeTranscriptTurns()` picks it up on
 * the next load.
 *
 * A module-level store, like the mirror's own, because the bridge is built per
 * track mount and the page has to be able to ask the question after the track
 * is over. ONE queue per attempt, not one per bridge: a resumed sitting can
 * build a second bridge for an attempt whose first bridge still holds a turn,
 * and two queues over the same rows would post them twice and count them
 * twice.
 */

/**
 * Where an attempt's un-landed turns wait for the next load. Same spelling
 * convention as the mirror's `foray:sync:v1:` key; no legacy `ailx:` twin to
 * migrate, because this key never existed under the old name.
 */
export const transcriptTurnsKey = (attemptId: string): string => `foray:t3-turns:v1:${attemptId}`;

/** The wire shape of a turn, taken from the poster so the two cannot drift. */
type PendingTurn = Parameters<typeof postTranscriptTurn>[4];

interface TurnQueue {
  pending: PendingTurn[];
  /** True while `drainQueue` is walking this queue; only one walker at a time. */
  draining: boolean;
  /** Bumped when the attempt is discarded, so an in-flight drain stops. */
  epoch: number;
}

const queues = new Map<string, TurnQueue>();
let outstandingTurns = 0;
const turnListeners = new Set<() => void>();
/** False once a write to localStorage has failed: the queue is memory-only. */
let turnsPersisted = true;

export function outstandingTranscriptTurns(): number {
  return outstandingTurns;
}

export function subscribeTranscriptTurns(listener: () => void): () => void {
  turnListeners.add(listener);
  return () => void turnListeners.delete(listener);
}

/**
 * Will an outstanding turn survive a reload?
 *
 * Almost always yes — that is what the persisted queue is for. It is NO when
 * a write to localStorage failed (quota, private mode, a storage-less
 * embedding), and the candidate is told the difference rather than being
 * promised a resume this browser cannot do (see {@link turnsOutstandingCopy}).
 */
export function transcriptTurnsSurviveReload(): boolean {
  return turnsPersisted;
}

/** Shape check for a queue read back out of localStorage (never trusted). */
function isPendingTurn(value: unknown): value is PendingTurn {
  if (typeof value !== "object" || value === null) return false;
  const t = value as Record<string, unknown>;
  return (
    typeof t.seq === "number" && Number.isFinite(t.seq) &&
    typeof t.verb === "string" && t.verb.length > 0 &&
    typeof t.object === "string" &&
    (t.text === undefined || typeof t.text === "string") &&
    (t.claimRefs === undefined ||
      (Array.isArray(t.claimRefs) && t.claimRefs.every((r) => typeof r === "string")))
  );
}

function readPendingTurns(attemptId: string): PendingTurn[] {
  try {
    const raw = window.localStorage.getItem(transcriptTurnsKey(attemptId));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    // A row that does not validate is DROPPED rather than posted: it came back
    // through localStorage, which any tab or extension can rewrite, and the
    // service would refuse it anyway. The rows that do validate still go.
    return Array.isArray(parsed) ? parsed.filter(isPendingTurn) : [];
  } catch {
    return [];
  }
}

function writePendingTurns(attemptId: string, turns: readonly PendingTurn[]): void {
  try {
    const key = transcriptTurnsKey(attemptId);
    if (turns.length === 0) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify(turns));
  } catch {
    // Quota, private mode, or no storage at all. The queue still retries in
    // this tab; what it can no longer promise is the reload, so the notice
    // stops promising it too.
    turnsPersisted = false;
    for (const listener of turnListeners) listener();
  }
}

/**
 * The queue for `attemptId`, resumed from storage the first time it is asked
 * for in this page load.
 */
function queueFor(attemptId: string): TurnQueue {
  let q = queues.get(attemptId);
  if (!q) {
    q = { pending: readPendingTurns(attemptId), draining: false, epoch: 0 };
    queues.set(attemptId, q);
    recountTurns();
  }
  return q;
}

/**
 * COUNTED across every queue, not read off one: a sitting can hold a queue for
 * more than one attempt in a page load, and a count taken from either alone
 * would hide the other's.
 */
function recountTurns(): void {
  let total = 0;
  for (const q of queues.values()) total += q.pending.length;
  if (total === outstandingTurns) return;
  outstandingTurns = total;
  for (const listener of turnListeners) listener();
}

/**
 * What a candidate is told while a T3 turn is still in this browser. Said
 * once, and said HERE rather than in the page, for two reasons: the count and
 * the sentence about the count belong together, and a Next.js page module may
 * export nothing but a page (a second export fails `next build` outright).
 *
 * TWO sentences about the tab, because there are two truths and the copy may
 * only claim the one that holds. The queue is normally on disk, so a reload
 * resumes it; when the write failed there is nothing to come back to, and
 * saying "keep this tab open" is then the whole of the promise.
 */
export function turnsOutstandingCopy(n: number, survivesReload = transcriptTurnsSurviveReload()): string {
  return (
    `${n} T3 ${n === 1 ? "turn has" : "turns have"} not reached the exam service yet, and the `
    + "service scores your challenges from those. Foray is still sending them, so finishing "
    + "waits until they land. "
    + (survivesReload
      ? "Keep this tab open if you can; if it closes, Foray takes them up again next time you open your run in this browser."
      : "This browser would not let Foray save them, so they live in this tab only — closing it loses them.")
  );
}

/**
 * The turns queued for an attempt that is being THROWN AWAY.
 *
 * `Discard this run` clears the log, the checkpoints and the site submission;
 * a queue left behind would keep posting a discarded run's stances, and — far
 * worse on screen — would keep the notice up and Finish shut on the run that
 * replaces it. The rows go with the run they belong to.
 */
export function discardTranscriptTurns(attemptId: string): void {
  const q = queues.get(attemptId);
  if (q) {
    q.pending.length = 0;
    q.epoch += 1; // an in-flight drain stops instead of shifting a new turn off
    queues.delete(attemptId);
  }
  try {
    window.localStorage.removeItem(transcriptTurnsKey(attemptId));
  } catch {
    // Nothing to remove from a storage that will not answer.
  }
  recountTurns();
}

/**
 * Take up an attempt's un-landed turns after a page load, and keep posting.
 *
 * Called by the exam page as soon as it knows which attempt this browser is
 * sitting — NOT by the T3 track mount, because the screen that has to know is
 * the finish screen, and a candidate who reloads on it never mounts T3 again.
 * A no-op with nothing stored, which is every static-demo run.
 */
export function resumeTranscriptTurns(attemptId: string): void {
  const q = queueFor(attemptId);
  if (q.pending.length === 0) return;
  void drainQueue(attemptId, browserApiOptions());
}

/**
 * Tests only: forget the in-memory queues, exactly as a PAGE LOAD does.
 *
 * The persisted rows are deliberately left alone — that is what makes this a
 * reload rather than a discard, and it is how `test/t3Transcript.test.tsx`
 * reproduces the tab that closed with a turn outstanding. Use
 * {@link discardTranscriptTurns} when the rows are meant to go too.
 */
export function resetTranscriptTurns(): void {
  // A drain from the previous test is still walking its own queue object; the
  // epoch bump stops it writing to the storage the next test just installed.
  for (const q of queues.values()) q.epoch += 1;
  queues.clear();
  turnsPersisted = true;
  recountTurns();
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
 * Post the head of `attemptId`'s queue until it lands, then the next one.
 *
 * NOTHING IS DROPPED and nothing is given up on: a turn that has not landed
 * stays counted, which is what keeps the notice up and finalize shut, and it
 * is still being re-posted, which is what makes that notice true. It is also
 * still on disk, so a reload that ends this walk resumes it.
 *
 * SERIALIZED per attempt — the rows are an ordered transcript, and a second
 * walker must not overtake the one still retrying — which is what `draining`
 * is for, and why a second bridge for the same attempt starts no second walk.
 */
async function drainQueue(attemptId: string, opts: ReturnType<typeof browserApiOptions>): Promise<void> {
  const q = queueFor(attemptId);
  if (q.draining) return;
  q.draining = true;
  const epoch = q.epoch;
  try {
    while (q.pending.length > 0 && q.epoch === epoch) {
      const body = q.pending[0];
      for (let attempt = 0; ; attempt++) {
        if (attempt > 0) await wait(retryDelayMs(attempt - 1));
        // Checked before every attempt, not only between turns: a run
        // discarded mid-wait must stop posting at the next attempt rather
        // than after one more.
        if (q.epoch !== epoch) return;
        try {
          await postTranscriptTurn(window.localStorage, opts, attemptId, "t3", body);
          break;
        } catch (err) {
          // Loud for a developer, and — through the count — visible to the
          // candidate. Never swallowed.
          console.warn("[ailx t3] transcript turn not mirrored, retrying", err);
        }
      }
      // The run was discarded while this turn was in flight: the rows are gone
      // and the queue is not ours to shift.
      if (q.epoch !== epoch) break;
      q.pending.shift();
      writePendingTurns(attemptId, q.pending);
      recountTurns();
    }
  } finally {
    q.draining = false;
  }
}

/**
 * The seam the hosted T3 Runner talks to the exam service through.
 *
 * Transcript mirroring is SERIALIZED, in the same shape as the response
 * mirror in `lib/data/persistence.ts` — but no longer fire-and-forget. A turn
 * that fails is RETRIED (the server row is keyed by seq, so a re-post of one
 * that did land is a no-op), it is written to localStorage before the first
 * post so a reload cannot lose it, and while any turn is still outstanding
 * the page says so and will not let the run be finalized: finalizing is the
 * moment the server stops accepting evidence, and doing it with a stance
 * still in this browser is how the score is computed from less than the
 * candidate did.
 */
export function hostedT3Bridge(attemptId: string): T3Hosted {
  const opts = browserApiOptions();
  return {
    assist: async (req) => {
      const reply = await postT3Assist(window.localStorage, opts, attemptId, req);
      return { text: reply.text, claimRefs: reply.claimRefs };
    },
    record: (turn: T3Turn) => {
      const q = queueFor(attemptId);
      q.pending.push({
        seq: turn.seq,
        verb: turn.verb,
        object: turn.object,
        ...(turn.text !== undefined ? { text: turn.text } : {}),
        ...(turn.claimIds !== undefined ? { claimRefs: turn.claimIds } : {}),
      });
      // Persisted BEFORE the first post is attempted: a turn that is only in
      // memory is a turn a reload loses, which is the defect this queue was
      // rebuilt for.
      writePendingTurns(attemptId, q.pending);
      recountTurns();
      void drainQueue(attemptId, opts);
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
