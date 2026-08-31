/**
 * Share-link URL and token conventions — client-safe (no node imports), so
 * the browser UI and the server agree on ONE spelling of both.
 *
 * The token is the capability: 32 random bytes, base64url, 43 chars. It is
 * STORED, so the owner can re-copy their own link and a published gallery
 * card can point at the view it came from (docs/SHARING.md §2). The URL is
 * short on purpose (`/s/<token>`) because it is meant to be pasted into a
 * message, and `/s/` is not `/api/` — the share VIEW is a page, not an API.
 */

/** 32 bytes of entropy in base64url — 43 chars, no padding. */
export const SHARE_TOKEN_BYTES = 32;
export const SHARE_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

/**
 * Share lifecycle. Monotone: a link only ever moves right, and `revoked`
 * absorbs from anywhere. `unlisted` needs no human approval (it is not
 * publicly listed); `submitted` -> `published` is the spec's
 * approval-required public-gallery gate and a human performs it, and
 * `submitted` -> `rejected` is the same human refusing it, on the record,
 * with a reason the candidate is shown.
 */
export const SHARE_STATUSES = [
  "unlisted",
  "submitted",
  "published",
  "rejected",
  "revoked",
] as const;
export type ShareStatus = (typeof SHARE_STATUSES)[number];

/** Canonical path of a share view. `root` carries any basePath prefix. */
export function shareUrlPath(token: string, root = ""): string {
  return `${root}/s/${token}`;
}

/** Canonical path of a share's social-preview image (server mode only). */
export function shareCardPath(token: string, apiRoot = "/api"): string {
  return `${apiRoot}/share/${token}/card.png`;
}
