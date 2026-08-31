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
 * lives in `apps/web/lib/ShareTargets.tsx`.
 */
import { playerCharacter } from "./character.js";
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
          ? "I finished a full AILX run — four rounds of working with AI: building something with it, telling real media from synthetic, holding a line against an assistant that is wrong on purpose, and directing a generation to a brief."
          : "AILX is four rounds of working with AI: building something with it, telling real media from synthetic, holding a line against an assistant that is wrong on purpose, and directing a generation to a brief.",
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
