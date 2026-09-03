#!/usr/bin/env node
/**
 * Cost model for T1 comparative judgement (docs/COMPARATIVE-JUDGEMENT.md).
 *
 * Not part of the build or the test run: docs/ is outside the vitest workspace
 * and outside every tsconfig. Run it by hand when an assumption changes:
 *
 *   node docs/cj-cost.mjs
 *   node docs/cj-cost.mjs --r=26 --seconds=60 --expert-rate=90 --panel=20
 *
 * Every default is an assumption, and each one is named in the doc beside the
 * number it produces. The two sourced inputs are r (Verhavert et al. 2019,
 * .90 at 26-37 comparisons per representation) and the refusal to use adaptive
 * pairing (Bramley 2015). Everything else here is a stated guess.
 */

const ARGS = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v === undefined ? "true" : v];
  }),
);
/** Positive finite numbers only: `--panel=0` used to print Infinity, `--r=nope` used to print NaN. */
const num = (name, fallback) => {
  if (ARGS[name] === undefined) return fallback;
  const v = Number(ARGS[name]);
  if (!Number.isFinite(v) || v <= 0) {
    throw new Error(`--${name} must be a positive finite number, got "${ARGS[name]}"`);
  }
  return v;
};

export const DEFAULTS = {
  /** Comparisons per artefact. Spec AILX-Spec-2026.1.md: r = 30. */
  r: 30,
  /** Seconds per forced-choice pair. Spec estimate, ~75 s. A guess. */
  seconds: 75,
  /** Standing expert panel size, if experts judge instead of candidates. A guess. */
  panel: 10,
  /** USD per expert hour, loaded. A guess. */
  expertRate: 60,
  /** USD per model-jury comparison: two screenshots plus a prompt to a VLM. A guess. */
  modelRate: 0.02,
  cohorts: [100, 500, 5000, 10000],
};

/**
 * @param {number} n candidates (one artefact each)
 * @param {typeof DEFAULTS} o
 */
export function costRow(n, o = DEFAULTS) {
  // Each comparison shows two artefacts, so it credits r for two of them.
  const total = (n * o.r) / 2;
  const perCandidateRater = o.r / 2; // independent of n
  const perExpert = total / o.panel; // linear in n
  const raterHours = (total * o.seconds) / 3600;
  return {
    n,
    total,
    perCandidateRater,
    candidateMinutes: (perCandidateRater * o.seconds) / 60,
    perExpert,
    expertHoursEach: (perExpert * o.seconds) / 3600,
    raterHours,
    expertUsd: raterHours * o.expertRate,
    modelUsd: total * o.modelRate,
  };
}


/** `node docs/cj-cost.mjs --check` — the arithmetic this doc rests on, asserted. */
function check() {
  const eq = (got, want, what) => {
    if (Math.abs(got - want) > 1e-9) throw new Error(`${what}: got ${got}, want ${want}`);
  };
  const a = costRow(500, DEFAULTS);
  eq(a.total, 7500, "N=500, r=30 total comparisons"); // the TEN-10 correction: not 30,000
  eq(a.perCandidateRater, 15, "per candidate-rater");
  eq(a.candidateMinutes, 18.75, "candidate minutes");
  // Per candidate-rater is flat in N; total and per-expert are linear.
  const b = costRow(10000, DEFAULTS);
  eq(b.perCandidateRater, a.perCandidateRater, "per candidate-rater is flat in N");
  eq(b.total / a.total, 20, "total is linear in N");
  eq(b.perExpert / a.perExpert, 20, "per expert is linear in N");
  eq(b.expertUsd / b.raterHours, DEFAULTS.expertRate, "expert cost is rater-hours priced");
  eq(b.modelUsd, b.total * DEFAULTS.modelRate, "model cost is per comparison");
  // r halves the artefact budget and the rater budget together.
  eq(costRow(500, { ...DEFAULTS, r: 15 }).total, a.total / 2, "total is linear in r");
  for (const bad of ["0", "-1", "nope", ""]) {
    ARGS.r = bad;
    let threw = false;
    try {
      num("r", DEFAULTS.r);
    } catch {
      threw = true;
    }
    if (!threw) throw new Error(`--r=${JSON.stringify(bad)} should be rejected`);
  }
  delete ARGS.r;
  console.log("cj-cost self-check: ok");
}

const opts = {
  ...DEFAULTS,
  r: num("r", DEFAULTS.r),
  seconds: num("seconds", DEFAULTS.seconds),
  panel: num("panel", DEFAULTS.panel),
  expertRate: num("expert-rate", DEFAULTS.expertRate),
  modelRate: num("model-rate", DEFAULTS.modelRate),
};

const int = (x) => Math.round(x).toLocaleString("en-US");
const one = (x) => x.toFixed(1);
const usd = (x) => `$${Math.round(x).toLocaleString("en-US")}`;

if (import.meta.url === `file://${process.argv[1]}`) {
  if (ARGS.check !== undefined) {
    check();
    process.exit(0);
  }
  console.log(
    `r=${opts.r}, ${opts.seconds}s per pair, expert panel of ${opts.panel} at $${opts.expertRate}/h, model at $${opts.modelRate}/comparison\n`,
  );
  console.log(
    "| N | Total comparisons | Per candidate-rater | Candidate time | Per expert (panel of " +
      opts.panel +
      ") | Expert time each | Total rater-hours | Expert cost | Model-jury cost |",
  );
  console.log("|---|---|---|---|---|---|---|---|---|");
  for (const n of opts.cohorts) {
    const c = costRow(n, opts);
    console.log(
      `| ${int(c.n)} | ${int(c.total)} | ${int(c.perCandidateRater)} | ${one(c.candidateMinutes)} min | ${int(c.perExpert)} | ${one(c.expertHoursEach)} h | ${int(c.raterHours)} | ${usd(c.expertUsd)} | ${usd(c.modelUsd)} |`,
    );
  }
}
