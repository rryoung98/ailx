import { readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** apps/web, resolved from this file. */
export const WEB_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * The directories a browser's own code lives in: `app/` routes,
 * `components/`, `features/` and `lib/`.
 *
 * Guards that scan "the frontend" must scan all of them. Before this list
 * existed each guard walked `app/` and `lib/` by hand, so a component moved
 * out of `lib/` would leave every one of those guards without a word. A
 * missing directory throws rather than shrinking the scan in silence.
 */
export const BROWSER_ROOTS = ["app", "components", "features", "lib"] as const;

/**
 * Every source file under BROWSER_ROOTS, as an absolute path.
 *
 * `mjs` is matched by default; pass a narrower pattern when a guard only
 * means TypeScript.
 */
export function browserSources(pattern = /\.(ts|tsx|mjs)$/): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      if (name === "node_modules" || name === ".next" || name === "out" || name === "dist") continue;
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (pattern.test(name)) out.push(full);
    }
  };
  for (const root of BROWSER_ROOTS) walk(join(WEB_ROOT, root));
  return out;
}
