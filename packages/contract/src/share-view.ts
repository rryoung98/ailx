/**
 * The ANONYMOUS read of a share, `GET /share/:token`, as a SCHEMA.
 *
 * Its own module, and not part of `share.ts`, for a measured reason: the
 * report page imports `needsHumanApproval` from `share.ts`, and while these
 * schemas lived there that one import pulled `zod` and the whole gallery
 * payload parser onto a page that validates nothing. It cost ~25 kB gzip on
 * `/report` and broke `apps/web/test/bundleBudget.test.ts`. A schema module
 * that only schema readers import keeps that edge off the report graph.
 */

import { z } from "zod";
import { sharePayloadSchema } from "./gallery.js";
import { SHARE_STATUSES } from "./share-url.js";

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
