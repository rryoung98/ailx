/**
 * HOSTED DECK: the T2 deck a hosted sitting presents, as served by
 * `GET /api/attempts/:id/items`.
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
import { fetchServerDeck, type PresentedDeck } from "./persistence";

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
