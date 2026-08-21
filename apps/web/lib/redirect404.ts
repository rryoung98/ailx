/**
 * 404 recovery for the static Pages export: the site exports flat HTML
 * (`/ailx/exam.html`), so `/ailx/exam/` (trailing slash) 404s. GitHub Pages
 * serves our 404 page for every unknown path — compute the once-only
 * redirect target, or null when the path is genuinely unknown.
 */
export function redirectTarget(pathname: string, search: string, hash: string): string | null {
  // Strip one or more trailing slashes (never the root or the basePath root).
  const stripped = pathname.replace(/\/+$/, "");
  if (stripped === pathname) return null; // nothing to fix — a real 404
  if (stripped === "" || stripped === "/ailx") return null; // roots already resolve
  return `${stripped}${search}${hash}`;
}
