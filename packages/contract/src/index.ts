/**
 * `@ailx/contract` — the BROWSER-FACING API CONTRACT of the AILX exam service.
 *
 * WHY THIS PACKAGE EXISTS. The exam backend is private (it holds the
 * operational bank, the keys and the marking scheme); the frontend is public.
 * But both must spell the same wire shapes, the same URL conventions and the
 * same input normalization, and a type copied into two repositories is a type
 * that drifts. So the contract is ONE package, vendored into the private repo
 * by `tools/src/syncShared.ts` and compared byte for byte in CI.
 *
 * WHAT MAY LIVE HERE. Types that cross the wire, and PURE functions and
 * constants over them: no `node:` import, no `pg`, no `process.env`, no
 * clock, no randomness, no network. Anything that reads a row, verifies an
 * identity or touches a disk stays in `@ailx/backend`, in the private repo.
 *
 * WHAT MAY NEVER LIVE HERE. Anything that reveals the operational bank: an
 * answer key, a rubric weight, a judge prompt, a sampler internal, or
 * `score()` itself (whose SOURCE the `scorers[]` audit digest
 * content-addresses). The browser holds no marking scheme — that is the whole
 * point of the split, and `apps/web/test/bundleSecrecy.test.ts` keeps biting.
 */
export { type ApiResult, FORBIDDEN_RESULT, UNAUTHORIZED_RESULT } from "./api.js";
export { clampInt } from "./clamp.js";
export { DEV_USER_COOKIE, DEV_USER_HEADER, type HeaderMap } from "./identity.js";
export {
  DEFAULT_REPO_NAME,
  SITE_INDEX,
  T1_SITE_RESPONSE_KIND,
  canonicalSitePath,
  siteUrlPath,
} from "./site-url.js";
export {
  SHARE_STATUSES,
  SHARE_TOKEN_BYTES,
  SHARE_TOKEN_RE,
  shareCardPath,
  shareUrlPath,
  type ShareStatus,
} from "./share-url.js";
export {
  needsHumanApproval,
  type OwnerShare,
  type PublishResult,
  type ShareRecord,
} from "./share.js";
export { type CredentialRecord, type OwnerCredential } from "./credential.js";
export {
  GALLERY_MAX_PAGE_SIZE,
  GALLERY_PAGE_SIZE,
  GALLERY_SORTS,
  PLAYER_TYPE_CODE_RE,
  REJECT_REASON_MAX,
  REVIEW_DECISIONS,
  parseGalleryQuery,
  publicEntry,
  type GalleryEntry,
  type GalleryFacet,
  type GalleryListing,
  type GalleryQuery,
  type GallerySort,
  type PublicGalleryEntry,
  type ReviewDecision,
} from "./gallery.js";
export {
  CASE_LANES,
  CASE_MAX_PAGE_SIZE,
  CASE_PAGE_SIZE,
  COMMENT_BODY_MAX,
  COMMENT_ROLES,
  COMMENT_VISIBILITIES,
  candidateMayReply,
  normalizeCommentBody,
  parseCaseQuery,
  type CandidateComment,
  type CandidateThread,
  type CaseLane,
  type CaseListing,
  type CaseQuery,
  type CommentAudience,
  type CommentRole,
  type CommentVisibility,
  type ModerationCase,
  type ModerationCaseDetail,
  type ModerationComment,
} from "./moderation.js";
export { T1_LIMITS } from "./t1.js";
