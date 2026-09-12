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
 * AND THE PERCENTAGE IS NOT PORTABLE EITHER, which is the trap, because a
 * percentage LOOKS like a normalised machine-independent number and is not one.
 * PR #72 measured 11% / 14% of tolerance spent on a laptop and 21% / 22% in CI —
 * same tree, same procedure, roughly DOUBLE. Someone who would never quote a raw
 * byte total from a laptop will happily quote a percentage from one. Every figure
 * in a review, an issue or a commit message needs to say where it was measured.
 *
 * So every measurement is printed on SUCCESS as well as failure, prefixed
 * `[bundle]`. To re-baseline: read the numbers out of a green CI run on `main`,
 * put them here, and say in the commit message which run they came from.
 * Raising one is allowed and expected — with the measurement and the reason.
 *
 * ONE TEST FOR WHETHER A RAISE IS HONEST, added 2026-09-09 after this gate came
 * 92 bytes from failing on already-shipped work: RE-BASELINE ONLY WHEN EVERY
 * COMPONENT OF THE DELTA IS UNDERSTOOD AND INTENDED. In likelihood order, a
 * raise is NOT honest when the numbers came from a laptop (see TEN-90 above);
 * when a PAGE budget is raised to absorb an unexplained page regression — the
 * TEN-216 report.html jump was found by bisecting and fixed by moving an
 * import, and the number was never the remedy; when the raise shares a commit
 * with the change that needed it; when the delta was not decomposed; or when
 * it is the second raise on one branch.
 *
 * A baseline is a statement about what is SHIPPED. `main` is a fact and a PR
 * head is a proposal, which is why the procedure above says main: baselining on
 * a branch turns one accepted delta into a permanent entitlement for everyone
 * after it.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = fileURLToPath(new URL("..", import.meta.url));

/**
 * Measured on `w/deps`, both builds run clean. See the header for the two margins.
 *
 * THE MARGINS ARE THE GATE, and until 2026-09-09 nothing pinned them. Every
 * budget in this file is `baseline × margin`, so editing `1.02` to `1.12` raises
 * all of them at once, moves the half-mark up so the alarm goes QUIET, and
 * passes every other assertion here — one character, no measurement, no run id,
 * no decomposition. The header's five honesty conditions were all about
 * BASELINES, which left the hole exactly where the cheapest dishonest edit
 * lives. They are pinned below, and widening one is the sixth condition.
 */
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
    allJsGzip: 707_329,
    sharedGzip: 178_261,
    pages: {
      "report.html": 311_014,
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
    allJsGzip: 833_671,
    sharedGzip: 214_951,
    pages: {
      "report.html": 353_611,
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

/**
 * ONE LINE PER MODE, EVERY RUN, OUTSIDE THE PER-MODE SKIP.
 *
 * The first version of this lived inside the per-mode `describe`, which is
 * `describe.skip` when a build is absent — so in the one case it was written for
 * (telling "under half the tolerance" from "never measured") it printed nothing
 * at all. The sentence "silence carries evidence" was true about intent and
 * false about mechanism, and the mechanism was a `describe.skip` three lines up.
 *
 * So it lives here, at module level, and it says the missing case OUT LOUD. A
 * run that measured nothing now looks different from a run that measured and was
 * content.
 */
describe("every run says where the tolerance stands", () => {
  it("prints a line per mode, measured or not", () => {
    for (const mode of MODES) {
      const cap = budget(mode.allJsGzip, TOTAL_MARGIN);
      const half = Math.round(mode.allJsGzip * (1 + (TOTAL_MARGIN - 1) / 2));
      const measurable = existsSync(mode.marker) && existsSync(mode.staticDir);
      if (!measurable) {
        console.log(
          `[bundle] tolerance ${mode.name}: NOT MEASURED — no build output at ${mode.staticDir}`,
        );
        continue;
      }
      const measured = walk(mode.staticDir, /\.js$/).reduce((n, f) => n + gz(f), 0);
      const spent = Math.round(((measured - mode.allJsGzip) / (cap - mode.allJsGzip)) * 100);
      console.log(
        `[bundle] tolerance ${mode.name}: ${spent}% spent ` +
          `(${measured} B, baseline ${mode.allJsGzip}, half-mark ${half}, budget ${cap})`,
      );
    }
    expect(MODES.length).toBe(2);
  });
});

describe("the margins are the gate", () => {
  /**
   * Every budget here is `baseline × margin`, so the margins are the only
   * numbers that move ALL of them. Widening one raises every budget, lifts the
   * half-mark so the alarm stops speaking, and breaks nothing else — the
   * cheapest dishonest edit in the file, and the one the baseline conditions in
   * the header did not cover.
   *
   * Pinned here so a widening cannot be quiet. Changing a margin is a decision
   * about what this repo will ship to a candidate on a slow connection, and it
   * belongs in front of a reviewer with a reason, exactly like a re-baseline.
   */
  it("pins the two margins, so widening one cannot be silent", () => {
    expect(TOTAL_MARGIN, "widening the total margin raises every total budget").toBe(1.02);
    expect(PAGE_MARGIN, "widening the page margin raises every page AND shared budget").toBe(1.05);
  });

  it("pins what budget() DOES with a margin, not only the margin", () => {
    // The pins above fix the INPUTS. `budget` consumes them, and until this test
    // it was free: `(m, margin) => Math.round(m * margin * 1.05)` keeps
    // TOTAL_MARGIN at 1.02, keeps half < budget, passes both pins above, and
    // raises the static budget to 757549. Pin the function too.
    expect(budget(1000, TOTAL_MARGIN), "budget() must be baseline x margin, nothing more").toBe(1020);
    expect(budget(1000, PAGE_MARGIN), "budget() must be baseline x margin, nothing more").toBe(1050);
    expect(budget(707_329, TOTAL_MARGIN)).toBe(721_476);
  });

  it("keeps the half-mark strictly inside the budget for any margin", () => {
    // The alarm is only useful while it fires BEFORE the gate does.
    for (const mode of MODES) {
      const half = Math.round(mode.allJsGzip * (1 + (TOTAL_MARGIN - 1) / 2));
      expect(half, `${mode.name} half-mark`).toBeGreaterThan(mode.allJsGzip);
      expect(half, `${mode.name} half-mark`).toBeLessThan(budget(mode.allJsGzip, TOTAL_MARGIN));
    }
  });
});

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

    /**
     * HALF-TOLERANCE ALARM, and it is the point of this file more than the
     * budget below is.
     *
     * `measured + 2%` is a TOLERANCE around a measurement, not a limit. Read
     * only as pass/fail it can never say "too much" — only "more than the last
     * time someone looked". The proof is dated: on 2026-09-09 `main` measured
     * 707329 B against a 707421 B budget in CI (run 34424902483). NO SINGLE PR
     * HAD EVER FAILED THIS GATE, and it stood 92 bytes from red on work that
     * was already shipped. The drift was not hidden; nothing surfaced it.
     *
     * AND IT WORKED ON ITS FIRST RUN. Added for the static export, it
     * immediately fired on the HOSTED build in the same CI job — 816373 B
     * against a 810889 B half-mark — which nobody had looked at. Main's hosted
     * total measured 817237 B against an 818917 B budget: 1680 bytes left, a
     * second cliff found by a warning rather than by a blocked branch.
     *
     * So this fires at HALF the tolerance — a warning with a name, long before
     * an unlucky branch is blocked by drift it did not cause. It is deliberately
     * a SOFT signal: it prints and does not fail, because a hard failure at 1%
     * is the same guard one notch tighter and would be suspended the first time
     * a feature legitimately lands. The durable fix is to fail on the DELTA
     * against main's last CI total, which attributes growth to its author and
     * does not depend on the floor at all (TEN-274).
     */
    it("warns once a PAGE has spent half its own tolerance", () => {
      /**
       * THE ALARM WATCHED TWO NUMBERS AND IGNORED SIXTEEN.
       *
       * Every half-mark added with the total alarm was computed from
       * `mode.allJsGzip` with `TOTAL_MARGIN` — so the two TOTALS were watched
       * and the eight pages per mode were not. That is exactly how
       * `report.html` reached 92.7% of its page margin on `main` (311014 of a
       * 312099 budget, 1085 B left; hosted 90.2%, 1651 B left) with NO single
       * PR ever failing it: nothing was looking.
       *
       * The page margin is wider (5% against 2%), which makes silence here
       * cheaper to accumulate, not dearer — a page can absorb several
       * kilobytes before anything objects, and then one ordinary PR pays for
       * all of it.
       *
       * Soft, like the total alarm and for the same reason: a hard failure at
       * half is the same guard one notch tighter, and would be suspended the
       * first time a page legitimately grows. And unconditional per page, so a
       * page that is FINE is also on the record — silence must not be
       * indistinguishable from "not measured".
       */
      for (const [file, baseline] of Object.entries(mode.pages)) {
        const cap = budget(baseline, PAGE_MARGIN);
        const half = Math.round(baseline * (1 + (PAGE_MARGIN - 1) / 2));
        const html = htmlFiles.find((f) => f.endsWith(`/${file}`));
        if (html === undefined) continue; // the per-page budget below fails loudly for a missing page
        const scripts = scriptsOf(html, mode).filter((f) => existsSync(f));
        const measured = scripts.reduce((n, f) => n + gz(f), 0);
        const spent = Math.round(((measured - baseline) / (cap - baseline)) * 100);
        console.log(`[bundle] tolerance ${mode.name} ${file}: ${spent}% spent (${measured} B, baseline ${baseline}, half-mark ${half}, budget ${cap})`);
        if (measured > half) {
          console.log(
            `[bundle] WARNING ${mode.name} ${file}: ${measured} B gzip has spent over HALF its page ` +
              `tolerance (half-mark ${half}, budget ${cap}). Find the growth, or re-baseline from a ` +
              "green CI run on main — see TEN-274.",
          );
        }
      }
      // Reports; the page budgets below judge.
      expect(Object.keys(mode.pages).length).toBeGreaterThan(5);
    });

    it("warns once the build has spent HALF its tolerance", () => {
      const measured = jsFiles.reduce((n, f) => n + gz(f), 0);
      const cap = budget(mode.allJsGzip, TOTAL_MARGIN);
      const half = Math.round(mode.allJsGzip * (1 + (TOTAL_MARGIN - 1) / 2));
      if (measured > half) {
        console.log(
          `[bundle] WARNING ${mode.name}: ${measured} B gzip has spent over HALF the ` +
            `tolerance (half-mark ${half}, budget ${cap}). ` +
            "Re-baseline from a green CI run on main, or find the growth — see TEN-274.",
        );
      }
      // Deliberately no assertion on `measured`: this reports, the budget below
      // judges. The assertion is on the MARGINS, which are the real gate — see
      // "the margins are the gate" below.
      expect(half).toBeLessThan(cap);
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
