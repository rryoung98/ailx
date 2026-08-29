/**
 * Dual-mode build.
 *
 * Default — static export for the GitHub Pages showcase. Route-handler files
 * are named `route.api.ts`, which the default pageExtensions do NOT treat as
 * route files, so the export contains no API surface at all.
 *
 * AILX_BACKEND=1 — server build (hosted backend). "api.ts" joins
 * pageExtensions, so `app/api/**\/route.api.ts` compile into real Next.js
 * route handlers, and `output: "export"` is dropped.
 */
const serverMode = process.env.AILX_BACKEND === "1";
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? (serverMode ? "" : "/ailx");
export default {
  ...(serverMode
    ? { pageExtensions: ["api.ts", "js", "jsx", "ts", "tsx"] }
    : { output: "export" }),
  basePath,
  images: { unoptimized: true },
  env: {
    NEXT_PUBLIC_BASE_PATH: basePath,
    NEXT_PUBLIC_AILX_BACKEND: serverMode ? "1" : "",
  },
};
