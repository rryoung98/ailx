/**
 * The share WIRE CONTRACT — the record an owner is shown, the publication
 * result, and the pure rule that decides whether entering the public gallery
 * needs a human.
 *
 * Pure by construction: reading, stamping and serving a share row stay
 * server-side (`@ailx/backend` `share.ts`). `needsHumanApproval` lives here
 * because the browser must be able to say "this will wait for a reviewer"
 * with the SAME rule the server enforces on the STORED payload — one
 * definition, so the UI can never promise what the gate will refuse.
 */

import type { SharePayload } from "@ailx/report";
import { z } from "zod";
import { sharePayloadSchema } from "./gallery.js";
import { SHARE_STATUSES, type ShareStatus } from "./share-url.js";

export interface ShareRecord {
  id: string;
  status: ShareStatus;
  /**
   * The capability token. Returned to the OWNER (so they can re-copy their
   * link) and carried on PUBLISHED gallery entries (which their owner chose
   * to make public); never on the anonymous `/api/share/:token` read.
   */
  token: string;
  /** Who approved publication: "auto:card", a human approver ref, or null. */
  approvedBy: string | null;
  /** True when a HUMAN must approve before this may be publicly listed. */
  needsHumanApproval: boolean;
  createdAt: string;
  revokedAt: string | null;
  submittedAt: string | null;
  approvedAt: string | null;
  /** The named human who refused publication, or null. */
  rejectedBy: string | null;
  rejectedAt: string | null;
  /** Why it was refused, shown verbatim to the candidate. */
  rejectReason: string | null;
  /** Anonymous view count (day-granular rows; no visitor identity exists). */
  views: number;
  payload: SharePayload;
}

/** The owner's view: their own link, minus who decided about it. */
export type OwnerShare = Omit<ShareRecord, "approvedBy" | "rejectedBy">;

export interface PublishResult {
  status: ShareStatus;
  /** True when the caller must now wait for a human approver. */
  awaitingApproval: boolean;
}

/**
 * Does entering the PUBLIC gallery need a human?
 *
 * Derived from the STORED payload — never from a request field, so no client
 * can talk its way past the gate:
 *  - a player-type card is a derived figure over four aggregate numbers, with
 *    no candidate-authored bytes in it: auto-publish;
 *  - a share carrying the candidate's built SITE hosts arbitrary user HTML on
 *    our origin, which is exactly what spec §12's approval-required gallery
 *    rule exists for: a human approves it or it stays unpublished;
 *  - a share carrying the candidate's own NOTE puts authored text on a public
 *    wall. It is escaped and length-capped, so it is not an XSS question — it
 *    is a moderation question, and the same human answers it.
 */
export function needsHumanApproval(payload: { site: string | null; note?: string | null }): boolean {
  return payload.site !== null || (payload.note ?? null) !== null;
}

/**
 * The ANONYMOUS read of a share, `GET /share/:token` — what a stranger who
 * holds the token is served, and the only part of a share row a reader
 * without an account may see.
 *
 * A SCHEMA rather than an interface, because `/s/<token>` dereferences the
 * payload during render: an unrecognised body used to throw a TypeError into
 * the root error boundary, on the growth loop's own page, instead of saying
 * the service answered with something unreadable (TEN-216). The payload's
 * deep shape has one parser already (`sharePayloadSchema`), so this delegates
 * to it rather than re-spelling it.
 */
export const sharedViewSchema = z.strictObject({
  status: z.enum(SHARE_STATUSES),
  createdAt: z.string(),
  views: z.number(),
  payload: sharePayloadSchema,
});

/** What `/s/<token>` renders. Inferred, so there is ONE definition. */
export type SharedView = z.infer<typeof sharedViewSchema>;

/** `GET /share/:token`. */
export const shareViewResponseSchema = z.strictObject({ share: sharedViewSchema });
