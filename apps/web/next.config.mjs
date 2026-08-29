/**
 * Dual-mode build.
 *
 * Default — static export for the GitHub Pages showcase. Route-handler files
 * are named `route.api.ts`, which the default pageExtensions do NOT treat as
 * route files, so the export contains no API surface at all.
 *
 * AILX_BACKEND=1 — server build (hosted backend). "api.ts" and "api.tsx" join
 * pageExtensions, so `app/api/**\/route.api.ts` compile into real Next.js
 * route handlers, `app/**\/page.api.tsx` compile into real server-only PAGES,
 * and `output: "export"` is dropped.
 *
 * The `.api.tsx` page extension is the PAGE twin of the long-standing
 * `route.api.ts` rule: without it there is no mechanism keeping a server-only
 * page (one that reads the database) out of the GitHub Pages export, and such
 * a page would either break the export or ship a dead route. One naming
 * convention, both file kinds.
 */
const serverMode = process.env.AILX_BACKEND === "1";
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? (serverMode ? "" : "/ailx");
export default {
  ...(serverMode
    ? { pageExtensions: ["api.ts", "api.tsx", "js", "jsx", "ts", "tsx"] }
    : { output: "export" }),
  basePath,
  images: { unoptimized: true },
  env: {
    NEXT_PUBLIC_BASE_PATH: basePath,
    NEXT_PUBLIC_AILX_BACKEND: serverMode ? "1" : "",
  },
};
