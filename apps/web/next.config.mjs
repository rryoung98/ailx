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
import { fileURLToPath } from "node:url";

const serverMode = process.env.AILX_BACKEND === "1";
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? (serverMode ? "" : "/ailx");

/**
 * Why the server build has to prune one traced file.
 *
 * Next traces every app entry into `.next/server/<entry>.js.nft.json`, and for
 * app entries it ALWAYS lists `<entry>_client-reference-manifest.js`
 * (next-trace-entrypoints-plugin). The webpack side only emits that manifest
 * when the client entry name ends in `/page` (with an optional extra dot
 * suffix) or exactly `/route` (flight-manifest-plugin).
 *
 * Our route handlers are `route.api.ts`. The client-entry bundle path strips
 * only the LAST extension, so the entry is named `.../route.api`: the page
 * rule tolerates the extra `.api` (which is why `page.api.tsx` pages are
 * fine), the route rule does not. Result: the trace promises a file Next never
 * writes. `next build` does not care — the loader reads that manifest with
 * "missing is ok" — but Vercel's builder lstats every traced file and the
 * deploy dies with ENOENT on the first API route.
 *
 * So drop the dangling reference instead of faking the file. Nothing is lost:
 * a route handler only needs a client reference manifest for `use cache`,
 * which no AILX route uses, and the runtime already treats it as optional.
 * Delete this the day Next matches `/route(\.[^/]+)?$/` like it does `/page`.
 */
const dropMissingRouteManifests = {
  "/api/**": ["**/*_client-reference-manifest.js"],
};

/**
 * The static export must not carry an auth SDK it can never mount.
 *
 * `app/layout.tsx` is ONE file for both builds, so the import of
 * `@clerk/nextjs` is in the graph of both — and an import is enough to bundle
 * it, whether or not `isClerkEnabled()` ever renders the provider. Resolving
 * the package to a tiny stub in the export build is the only way to keep the
 * GitHub Pages bundle free of it without splitting the layout in two.
 *
 * The server build resolves the real package, obviously. `middleware.api.ts`
 * and `app/sign-in/**\/page.api.tsx` are hosted-only by NAME (pageExtensions
 * above), so nothing outside `lib/auth/*` needs the alias.
 */
const clerkStub = fileURLToPath(new URL("./lib/auth/clerkStub.tsx", import.meta.url));
const stubClerk = {
  webpack: (config) => {
    config.resolve.alias = { ...config.resolve.alias, "@clerk/nextjs": clerkStub };
    return config;
  },
  turbopack: { resolveAlias: { "@clerk/nextjs": "./lib/auth/clerkStub.tsx" } },
};

export default {
  ...(serverMode
    ? {
        pageExtensions: ["api.ts", "api.tsx", "js", "jsx", "ts", "tsx"],
        outputFileTracingExcludes: dropMissingRouteManifests,
      }
    : { output: "export", ...stubClerk }),
  basePath,
  images: { unoptimized: true },
  env: {
    NEXT_PUBLIC_BASE_PATH: basePath,
    NEXT_PUBLIC_AILX_BACKEND: serverMode ? "1" : "",
  },
};
