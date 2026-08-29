/**
 * Compatibility re-export. Track metadata moved to `@ailx/report` (it reaches
 * the audit export, so FRONTEND.md §2.1 puts it inside the purity sandbox).
 * Import `@ailx/report` directly in new code; this file exists only so the
 * in-flight Playwright fixtures keep resolving.
 */
export { TRACK_LIST, TRACK_META, type TrackComponentMeta, type TrackMeta } from "@ailx/report";
