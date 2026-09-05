/**
 * SHARE TEXT — the words that travel with a share link, in one place.
 *
 * The share URL is not the share. What a stranger sees in a feed is a
 * sentence, and that sentence decides whether the card is ever opened
 * (docs/SHARING.md §4: "a paste with no preview does not spread" — the same
 * is true of a paste with no words). So the copy is DERIVED, once, from the
 * frozen payload, and every network gets a variant of the SAME message
 * rather than its own hardcoded string.
 *
 * HONESTY (docs/POSITIONING.md). The text carries the player TYPE, its
 * character and — when the owner shared it — the fact that they built
 * something. It deliberately carries NO band, NO track number, NO percentile
 * and NO judged result: the summit judging pipeline does not exist, and a
 * number in a feed reads as certification whatever the caveat next to it
 * says. `shareTextForbidden` is asserted over every generated string in
 * `packages/report/test/shareText.test.ts`.
 *
 * PRIVACY. Everything here reads the already-allowlisted `SharePayload` and
 * nothing else — a share text cannot widen what a share link exposes,
 * because it has nothing else to read (docs/SHARING.md §1).
 *
 * Pure: no clock, no network, no `window`. The React that renders the buttons
 * lives in `apps/web/components/ShareTargets.tsx`.
 */
import { playerCharacter } from "./character.js";
import { dailyGrid, dailyTally, type DailyCard, type DailyResult } from "./daily.js";
import type { SharePayload } from "./share.js";

/** The networks we build an intent URL for. `native` is the OS share sheet. */
export const SHARE_NETWORKS = ["x", "linkedin", "whatsapp"] as const;
export type ShareNetwork = (typeof SHARE_NETWORKS)[number];
/** Every voice the copy is written in, including the OS sheet's. */
export type ShareChannel = ShareNetwork | "native";

/**
 * WHOSE card is being shared.
 *
 * The report renders "mine": the owner is posting their own result. The share
 * VIEW is opened by whoever holds the link — often the owner on a phone, but
 * possibly a reader passing it on — so it renders "theirs" and never puts a
 * first-person claim in a stranger's mouth.
 */
export type SharePerspective = "mine" | "theirs";

/**
 * X counts any link as 23 characters regardless of length (t.co), so the text
 * budget is 280 − 23 − one separating space. Kept a little under to leave the
 * poster room to add a word.
 */
export const X_TEXT_MAX = 240;

/** The one-line title the OS share sheet and the page metadata both use. */
export function shareTitle(payload: SharePayload): string {
  const { code, name } = payload.playerType;
  return `${name} (${code}) — AILX player type`;
}

/** The parts every variant is built from. One derivation, four voices. */
export interface ShareCopyParts {
  code: string;
  name: string;
  /** The type's own line, ending in a full stop. */
  tagline: string;
  /** "the sextant" — the character's drawing, or null for an unknown code. */
  character: string | null;
  /** Did the owner share their own built site with the card? */
  hasSite: boolean;
}

/** Trim trailing punctuation-free taglines into a sentence. */
function sentence(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat === "") return "";
  return /[.!?]$/.test(flat) ? flat : `${flat}.`;
}

export function shareCopyParts(payload: SharePayload): ShareCopyParts {
  const character = playerCharacter(payload.playerType.code);
  return {
    code: payload.playerType.code,
    name: payload.playerType.name,
    tagline: sentence(payload.playerType.tagline),
    // The slug is the drawing's stable id ("loupe-with-toolbelt"); as words it
    // is the thing in the picture, which is what makes the card recognisable.
    character: character === null ? null : `the ${character.slug.replace(/-/g, " ")}`,
    hasSite: payload.site !== null,
  };
}

/**
 * Shorten to a hard limit on a word boundary, with an ellipsis. Only X needs
 * it; the others accept far more than we write.
 */
export function clampShareText(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/**
 * "a Cartographer", but "The Full-Stack Skeptic" untouched — several type
 * names already carry their own article, and "a The Full-Stack Skeptic" is
 * exactly the kind of seam a stranger reads as machine-written.
 */
export function withArticle(name: string): string {
  if (/^(the|a|an)\s/i.test(name)) return name;
  return `${/^[aeiou]/i.test(name) ? "an" : "a"} ${name}`;
}

/** "I am a Cartographer (MSVD), the sextant." / "A Cartographer (MSVD), …" */
function identityLine(p: ShareCopyParts, perspective: SharePerspective): string {
  const who = `${p.name} (${p.code})`;
  const face = p.character === null ? "" : `, ${p.character}`;
  return perspective === "mine"
    ? `My AILX player type: ${who}${face}.`
    : `An AILX player type: ${who}${face}.`;
}

/** The artifact clause, only when a site really rode along with the card. */
function builtLine(p: ShareCopyParts, perspective: SharePerspective): string | null {
  if (!p.hasSite) return null;
  return perspective === "mine"
    ? "The site I built with a model is on the card."
    : "The site they built with a model is on the card.";
}

/**
 * The text for one channel. The URL is NOT included: every caller either
 * passes it as its own parameter (X, the Web Share API) or appends it once
 * (`shareIntentUrl`), so the link can never appear twice in one post.
 */
export function shareText(
  payload: SharePayload,
  channel: ShareChannel,
  perspective: SharePerspective = "mine",
): string {
  const p = shareCopyParts(payload);
  const id = identityLine(p, perspective);
  const built = builtLine(p, perspective);
  const mine = perspective === "mine";

  switch (channel) {
    case "x": {
      // Short and punchy: identity, the type's own line, one invitation.
      const parts = [id, p.tagline, built, "Four rounds with an AI. Find your own type:"];
      return clampShareText(parts.filter((s) => s !== null && s !== "").join(" "), X_TEXT_MAX);
    }
    case "linkedin":
      // Professional, and careful: a completed run is the claim, never a rank.
      return [
        mine
          ? "I finished a full AILX run: four rounds of working with AI. Build with it, tell real media from synthetic, hold a line against an assistant that is wrong on purpose, direct a generation to a brief."
          : "AILX is four rounds of working with AI: build with it, tell real media from synthetic, hold a line against an assistant that is wrong on purpose, direct a generation to a brief.",
        `${id} ${p.tagline}`,
        built,
        "AILX reports a player type and the work behind it — no ranking, no number.",
      ]
        .filter((s) => s !== null)
        .join("\n\n");
    case "whatsapp":
      // Casual, one person to one person.
      return [
        mine
          ? `I did the AILX run — apparently I am ${p.character === null ? withArticle(p.name) : `${p.character}: ${withArticle(p.name)}`}.`
          : `Have a look at this AILX card — ${p.character === null ? withArticle(p.name) : `${p.character}, ${withArticle(p.name)}`}.`,
        p.tagline,
        built,
        mine ? "See which one you get:" : "You can play a run yourself:",
      ]
        .filter((s) => s !== null)
        .join(" ");
    case "native":
      // The OS sheet shows title + text + url separately; keep the text tight.
      return [id, p.tagline, built].filter((s) => s !== null).join(" ");
  }
}

/**
 * The link that opens a network's composer with our text already in it.
 *
 * X takes text and url as separate parameters and renders the card from the
 * url. LinkedIn's `share-offsite` endpoint DROPS any text you give it (the
 * `summary`/`title` parameters were removed in 2021), so the feed composer is
 * used instead — it is the only LinkedIn surface that still accepts words,
 * and the URL inside the text is what LinkedIn unfurls. WhatsApp takes one
 * `text` field and linkifies the URL in it.
 */
export function shareIntentUrl(
  network: ShareNetwork,
  payload: SharePayload,
  url: string,
  perspective: SharePerspective = "mine",
): string {
  const text = shareText(payload, network, perspective);
  switch (network) {
    case "x":
      return `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
    case "linkedin":
      return `https://www.linkedin.com/feed/?shareActive=true&text=${encodeURIComponent(`${text}\n\n${url}`)}`;
    case "whatsapp":
      return `https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}`;
  }
}

/** Human label and accessible name for each target. Rendered, so it is copy. */
export const SHARE_NETWORK_LABEL: Record<ShareNetwork, string> = {
  x: "X",
  linkedin: "LinkedIn",
  whatsapp: "WhatsApp",
};

/**
 * Words a share text must never contain, whatever the payload says.
 *
 * This is the honesty rule as a testable predicate rather than a review
 * habit: bands, percentiles, scores and grades are the vocabulary of a
 * certification we do not issue yet, and the four track numbers are shape,
 * not a headline. Used by the tests over every generated variant.
 */
export const SHARE_TEXT_FORBIDDEN: readonly RegExp[] = [
  /percentile/i,
  /\bscored?\b/i,
  /\bgrade[sd]?\b/i,
  /\bcertifi/i,
  /\bdistinction\b/i,
  /\bmerit\b/i,
  /\bpass(ed|ing)?\b/i,
  /\btop \d/i,
  /\b\d+(\.\d+)?\s*(%|percent|points?|\/\s*100)/i,
];

/** The forbidden phrases a text contains, empty when it is clean. */
export function shareTextViolations(text: string): string[] {
  return SHARE_TEXT_FORBIDDEN.filter((re) => re.test(text)).map((re) => re.source);
}

// ---------------------------------------------------------------------------
// THE DAILY CHALLENGE
// ---------------------------------------------------------------------------

/**
 * The daily's share text: the grid, the tally, the streak, and an invitation.
 *
 * It lives in this module and not next to the grid because ONE module owns
 * share copy — the honesty rules below (`SHARE_TEXT_FORBIDDEN`) are asserted
 * over every string this file can emit, and a second copy site is how a
 * sentence that says more than it may gets shipped.
 *
 * WHAT IT MAY SAY. The puzzle number (public), the grid (a vector of
 * hit/miss/skip and nothing else — see ./daily.ts rule 1), how many calls
 * were right, and how many days in a row the player has come back. Nothing
 * else exists in the input types, so nothing else can be written.
 *
 * WHAT IT MAY NOT SAY, and cannot: which card was which, what any answer was,
 * a percentile, a rank, a cohort position, or any suggestion that a streak is
 * evidence of a better eye. `packages/report/test/daily.test.ts` asserts the
 * first three against the real pool (no id, stem, tell or body of any card may
 * appear in any generated string) and `efficacyClaims.test.ts` the last.
 */
export interface DailyShare {
  /** Puzzle number, as frozen on the round. */
  number: number;
  results: readonly DailyResult[];
  /** Consecutive days, from `dailyStreak().current`. 0 or 1 says nothing. */
  streak: number;
}

/**
 * The one sentence that says what a streak is, wherever a streak is shown.
 * A constant, not page copy, for the same reason `PRACTICE_EFFICACY_NOTE` is
 * one: two surfaces both invite the question, and a wording that drifts
 * between them is how an unevidenced claim gets back in.
 */
export const DAILY_STREAK_MEANING =
  "A streak counts the days you came back. It is not evidence your eye got better; "
  + "no result says this kind of practice does that.";

/** The daily's own one-line pitch. Same words on every surface (DRY). */
export const DAILY_PITCH = "Five calls, one minute. The same five for everyone today.";

/** "4 of 5", plus the skipped cards named rather than quietly dropped. */
export function dailyTallyLine(results: readonly DailyResult[]): string {
  const { hits, called, dealt } = dailyTally(results);
  const skipped = dealt - called;
  const base = `${hits} of ${called}`;
  if (skipped === 0) return base;
  return `${base} · ${skipped === 1 ? "1 card" : `${skipped} cards`} never loaded`;
}

/** "· 6-day streak", or nothing at all below two days. */
function streakClause(streak: number): string | null {
  return streak >= 2 ? `${streak}-day streak` : null;
}

/** The title the OS share sheet and the page metadata both use. */
export function dailyShareTitle(share: DailyShare): string {
  return `AILX Daily #${share.number}`;
}

export function dailyShareText(share: DailyShare, channel: ShareChannel): string {
  const head = dailyShareTitle(share);
  const grid = dailyGrid(share.results);
  const tally = [dailyTallyLine(share.results), streakClause(share.streak)]
    .filter((s) => s !== null)
    .join(" · ");

  switch (channel) {
    case "x":
      // Three short lines: the hook, the picture, the fact. The URL is added
      // by `shareIntentUrl`'s own parameter, never inside the text.
      return clampShareText([head, grid, tally, DAILY_PITCH].join("\n"), X_TEXT_MAX);
    case "linkedin":
      return [
        `${head} — ${tally}`,
        grid,
        "The AILX daily is five calls: photograph or generated image, person or model, genuine "
          + "message or not. Everyone gets the same five, and it takes about a minute.",
        DAILY_STREAK_MEANING,
        "It is a game on published practice material. It is not an AILX sitting and reaches no result.",
      ].join("\n\n");
    case "whatsapp":
      return `${head} — ${tally}\n${grid}\n${DAILY_PITCH} Have a go:`;
    case "native":
      return `${head}\n${grid}\n${tally}`;
  }
}

/** The composer link for one network, same three rules as {@link shareIntentUrl}. */
export function dailyShareIntentUrl(network: ShareNetwork, share: DailyShare, url: string): string {
  const text = dailyShareText(share, network);
  switch (network) {
    case "x":
      return `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
    case "linkedin":
      return `https://www.linkedin.com/feed/?shareActive=true&text=${encodeURIComponent(`${text}\n\n${url}`)}`;
    case "whatsapp":
      return `https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}`;
  }
}

/**
 * Every fragment of a card that would spoil the day if it travelled: the
 * item's id, the words on it, and the tell that gives the answer away.
 *
 * Shipped rather than kept in the test file because the app asserts it too
 * (`apps/web/test/dailyChallenge.test.tsx`): the leak rule is about a
 * RENDERED string leaving the page, and the page is where a future "share
 * what you saw" button would be added by somebody who never read this module.
 */
export function dailyCardSpoilers(card: DailyCard): string[] {
  const words = [card.id, card.tell, ...card.options];
  if (card.material.kind === "image") words.push(card.material.alt);
  else words.push(card.material.text, ...(card.material.title === undefined ? [] : [card.material.title]));
  return words.filter((w) => w.trim() !== "");
}

/**
 * The spoilers a text contains, empty when it is clean. Substring match, and
 * deliberately not word-boundary-clever: a partial quotation of a card is a
 * leak too.
 */
const MIN_SPOILER_LENGTH = 24;

export function dailyShareLeaks(text: string, pool: readonly DailyCard[]): string[] {
  const hay = text.toLowerCase();
  const hits = new Set<string>();
  for (const card of pool) {
    // An id is a leak at any length; the rest matter once they are long
    // enough to identify a card, so an option label ("AI-generated") cannot
    // false-positive on ordinary copy.
    if (hay.includes(card.id.toLowerCase())) hits.add(card.id);
    for (const spoiler of dailyCardSpoilers(card)) {
      if (spoiler.length >= MIN_SPOILER_LENGTH && hay.includes(spoiler.toLowerCase())) {
        hits.add(spoiler);
      }
    }
  }
  return [...hits];
}
