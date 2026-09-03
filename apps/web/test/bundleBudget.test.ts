/**
 * A BUDGET FOR WHAT THE BROWSER DOWNLOADS.
 *
 * `docs/ADR-orpc.md` rejected oRPC partly for +21.7 kB gzip on one page, and
 * `docs/ADR-zod-tanstack.md` accepted zod only after a split that cut its cost
 * from +24.5 kB to +7.7 kB. Both decisions turned on a number somebody
 * measured by hand. Nothing stopped the NEXT 22 kB arriving unmeasured, and a
 * budget nobody enforces is a sentence in a document.
 *
 * This test enforces it. It is deliberately the SAME method as the two ADRs,
 * so a failure here is comparable with the tables in them:
 *
 *   - gzip level 9 over the bytes actually served, not "First Load JS". Next's
 *     per-page number under-reports — ADR-zod-tanstack §3.1 records a page
 *     Next called unchanged while it had gained 17 kB of async script.
 *   - per page: the gzipped sum of EVERY `<script src>` the prerendered HTML
 *     requests. That is much bigger than Next's number in absolute terms; it
 *     is the figure that moves when a dependency lands.
 *   - shared: the scripts every prerendered page requests. A dependency the
 *     root layout mounts shows up here and is paid on every page.
 *
 * BOTH build modes, because they ship different code:
 *   static export   `pnpm --filter @ailx/web build`            -> apps/web/out
 *   hosted          `AILX_BACKEND=1 pnpm --filter @ailx/web build` -> apps/web/.next
 * `rm -rf apps/web/.next apps/web/out` between them (AGENTS.md — a build over
 * the other mode's leftovers fails for reasons that name nothing real).
 *
 * TO RE-MEASURE: run either build and read the failure message, which always
 * prints the measured bytes next to the budget. There is no separate script to
 * drift from the check.
 *
 * TWO MARGINS, and the difference is the point.
 *
 *   - a PAGE budget is its measurement + 5% (9-17 kB on the big pages): wide
 *     enough that a chunk-boundary shuffle does not cry wolf.
 *   - the TOTAL client-JS budget is its measurement + 2% (14-16 kB). It is
 *     tighter because it is the only one that sees a chunk no page requests up
 *     front. A page budget counts the `<script src>`s in the prerendered HTML,
 *     so a library reached through `await import(...)` after hydration —
 *     `app/report/page.tsx` does exactly that with `@ailx/track-t4` — is
 *     invisible to it and lands in the total instead.
 *
 * WHAT THIS CANNOT DO. It measures the build output it finds. It cannot tell a
 * fresh artefact from yesterday's, and it SKIPS a mode whose output is absent,
 * so a local `pnpm test` with no build checks nothing. That is not the CI
 * story: `.github/workflows/ci.yml` runs the static build and then the hosted
 * build BEFORE `pnpm test:coverage` — for `bundleSecrecy.test.ts`, which needs
 * the same two trees — so on every PR both halves run against output built
 * from that commit.
 *
 * WHERE THE BASELINES COME FROM, and this matters more than it looks. They must
 * be measured IN CI, from the workflow's own two builds. The first set was taken
 * on a laptop and CI built the same commit about 34 kB bigger, so every branch
 * failed the total by a few hundred bytes while changing nothing that ships —
 * one of them changed a YAML number and some prose (TEN-90). A budget
 * calibrated somewhere the gate never runs is not a budget.
 *
 * So every measurement is printed on SUCCESS as well as failure, prefixed
 * `[bundle]`. To re-baseline: read the numbers out of a green CI run on `main`,
 * put them here, and say in the commit message which run they came from.
 * Raising one is allowed and expected — with the measurement and the reason.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = fileURLToPath(new URL("..", import.meta.url));

/** Measured on `w/deps`, both builds run clean. See the header for the two margins. */
const PAGE_MARGIN = 1.05;
const TOTAL_MARGIN = 1.02;
const budget = (measured: number, margin: number): number => Math.round(measured * margin);

interface Mode {
  name: string;
  /** Where the client JS lives. */
  staticDir: string;
  /** Where the prerendered HTML lives. */
  htmlRoot: string;
  /** Resolves a `<script src>` (basePath and all) to a file on disk. */
  resolve: (src: string) => string;
  /** Only measure this mode when this path exists — see `present`. */
  marker: string;
  /** gzip bytes of every JS file under `staticDir`, measured today. */
  allJsGzip: number;
  /** gzip bytes of the scripts EVERY prerendered page requests. */
  sharedGzip: number;
  /** gzip bytes of every script a named page requests. */
  pages: Record<string, number>;
}

const MODES: Mode[] = [
  {
    name: "static export (apps/web/out)",
    staticDir: join(webRoot, "out/_next/static"),
    htmlRoot: join(webRoot, "out"),
    // basePath is `/ailx` on Pages, so the href is `/ailx/_next/static/...`.
    resolve: (src) => join(webRoot, "out", src.slice(src.indexOf("/_next/") + 1)),
    marker: join(webRoot, "out/_next/static"),
    allJsGzip: 693_550,
    sharedGzip: 178_261,
    pages: {
      "report.html": 297_237,
      "exam.html": 278_801,
      "validate.html": 270_265,
      "wall.html": 240_018,
      "index.html": 237_852,
      "daily.html": 237_091,
      "practice.html": 183_043,
      "methodology.html": 178_423,
    },
  },
  {
    name: "hosted build (apps/web/.next)",
    staticDir: join(webRoot, ".next/static"),
    htmlRoot: join(webRoot, ".next/server/app"),
    resolve: (src) => join(webRoot, ".next", src.slice(src.indexOf("/_next/") + "/_next/".length)),
    // `.next/static` also exists after a STATIC export, and its bytes are the
    // static export's. The one route handler compiles in the hosted build and
    // only there, so its output is what tells the two `.next` apart.
    marker: join(webRoot, ".next/server/app/s/[token]/card.png"),
    allJsGzip: 802_860,
    sharedGzip: 214_951,
    pages: {
      "report.html": 338_345,
      "exam.html": 322_133,
      "validate.html": 308_275,
      "wall.html": 276_634,
      "daily.html": 273_930,
      "index.html": 274_465,
      "practice.html": 219_741,
      "methodology.html": 215_116,
    },
  },
];

const gz = (file: string): number => gzipSync(readFileSync(file), { level: 9 }).length;

function walk(dir: string, match: RegExp, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, match, out);
    else if (match.test(entry)) out.push(full);
  }
  return out;
}

/** The scripts one prerendered page requests, resolved to files on disk. */
function scriptsOf(html: string, mode: Mode): string[] {
  const srcs = new Set<string>();
  for (const m of readFileSync(html, "utf8").matchAll(/<script[^>]+src="([^"]+)"/g)) {
    const src = (m[1] as string).split("?")[0] as string;
    if (src.includes("/_next/")) srcs.add(mode.resolve(src));
  }
  return [...srcs];
}

for (const mode of MODES) {
  const present = existsSync(mode.marker) && existsSync(mode.staticDir);
  const run = present ? describe : describe.skip;
  run(`${mode.name} stays inside its budget`, () => {
    const jsFiles = present ? walk(mode.staticDir, /\.js$/) : [];
    const htmlFiles = present ? walk(mode.htmlRoot, /\.html$/) : [];

    it("found a build to measure", () => {
      // A budget over an empty tree passes on anything. Sentinels, not faith.
      expect(jsFiles.length, `no JS under ${mode.staticDir}`).toBeGreaterThan(10);
      expect(htmlFiles.length, `no prerendered HTML under ${mode.htmlRoot}`).toBeGreaterThan(5);
    });

    it("ships no more client JS in total than budgeted", () => {
      const measured = jsFiles.reduce((n, f) => n + gz(f), 0);
      // Printed on SUCCESS too, and this is not noise. The baselines below were
      // first taken on a laptop, and CI builds the same commit ~34 kB bigger
      // (TEN-90), so every branch failed by a few hundred bytes and the gate
      // said nothing about WHY. A number you can only read when it breaks is a
      // number nobody can re-baseline honestly.
      console.log(
        `[bundle] ${mode.name}: total ${measured} B gzip over ${jsFiles.length} files ` +
          `(baseline ${mode.allJsGzip}, budget ${budget(mode.allJsGzip, TOTAL_MARGIN)})`,
      );
      expect(
        measured,
        `all JS under ${mode.staticDir}: ${measured} B gzip, budget ` +
          `${budget(mode.allJsGzip, TOTAL_MARGIN)} B (baseline ${mode.allJsGzip} + 2%)`,
      ).toBeLessThanOrEqual(budget(mode.allJsGzip, TOTAL_MARGIN));
    });

    it("ships no more JS on EVERY page than budgeted", () => {
      // The scripts common to every prerendered page: what the root layout and
      // the framework cost before a page adds anything of its own.
      const perPage = htmlFiles.map((h) => new Set(scriptsOf(h, mode)));
      const shared = [...(perPage[0] as Set<string>)].filter((f) =>
        perPage.every((set) => set.has(f)),
      );
      const measured = shared.reduce((n, f) => n + gz(f), 0);
      console.log(
        `[bundle] ${mode.name}: shared ${measured} B gzip over ${shared.length} files ` +
          `(baseline ${mode.sharedGzip}, budget ${budget(mode.sharedGzip, PAGE_MARGIN)})`,
      );
      expect(shared.length, "no script is common to every page — the scan is broken").toBeGreaterThan(0);
      expect(
        measured,
        `shared by all ${perPage.length} prerendered pages: ${measured} B gzip over ` +
          `${shared.length} files, budget ${budget(mode.sharedGzip, PAGE_MARGIN)} B ` +
          `(baseline ${mode.sharedGzip} + 5%)`,
      ).toBeLessThanOrEqual(budget(mode.sharedGzip, PAGE_MARGIN));
    });

    for (const [page, baseline] of Object.entries(mode.pages)) {
      it(`${page} stays inside its budget`, () => {
        const file = htmlFiles.find((f) => f.endsWith(`/${page}`));
        // A page that disappears must fail LOUDLY: a missing file is not a
        // page that got smaller, and this budget would happily pass on it.
        expect(file, `${page} is not in ${mode.htmlRoot}`).toBeDefined();
        const scripts = scriptsOf(file as string, mode);
        const missing = scripts.filter((f) => !existsSync(f));
        expect(missing, `${page} requests scripts that are not on disk`).toEqual([]);
        const measured = scripts.reduce((n, f) => n + gz(f), 0);
        console.log(`[bundle] ${mode.name}: ${page} ${measured} B gzip (baseline ${baseline})`);
        expect(
          measured,
          `${page}: ${measured} B gzip over ${scripts.length} scripts, ` +
            `budget ${budget(baseline, PAGE_MARGIN)} B (baseline ${baseline} + 5%)`,
        ).toBeLessThanOrEqual(budget(baseline, PAGE_MARGIN));
      });
    }
  });
}
