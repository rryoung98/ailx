/**
 * Test double for next/font/google: vitest has no Next build pipeline, so
 * font loaders resolve to stable class/variable names (layout renders the
 * same structure it ships with).
 */
type FontRet = { className: string; variable: string; style: Record<string, string> };
function loader(name: string): () => FontRet {
  return () => ({ className: `font-${name}`, variable: `--font-${name}`, style: {} });
}
export const Fraunces = loader("serif");
export const Caveat = loader("script");
