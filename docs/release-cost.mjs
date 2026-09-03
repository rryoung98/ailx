#!/usr/bin/env node
/**
 * Cost model for one AILX population release (docs/SAMPLING.md §13).
 *
 * Not part of the build or the test run: docs/ is outside the vitest workspace
 * and outside every tsconfig. Run it by hand when an assumption changes:
 *
 *   node docs/release-cost.mjs
 *   node docs/release-cost.mjs --check
 *   node docs/release-cost.mjs --months=24 --contingency=0.25
 *
 * Every input carries a label. SOURCED means a primary source was read and is
 * cited on the line. OURS means we chose the number and can argue for it.
 * GUESS means nobody has checked it. No line here is FIRM, because FIRM means
 * a signed vendor quote and we hold none. That is the point of §13.
 *
 * Written for TEN-42: §13 costed the fieldwork and the contractors and left
 * out the person who runs the release.
 */

const ARGS = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v === undefined ? "true" : v];
  }),
);
/** Positive finite numbers only: `--months=0` prints Infinity, `--months=nope` prints NaN. */
const num = (name, fallback) => {
  if (ARGS[name] === undefined) return fallback;
  const v = Number(ARGS[name]);
  if (!Number.isFinite(v) || v <= 0) {
    throw new Error(`--${name} must be a positive finite number, got "${ARGS[name]}"`);
  }
  return v;
};

/** GBP -> USD. ECB reference rate for 2026-09-01, read through api.frankfurter.dev. SOURCED. */
export const GBP_USD = 1.3531;

export const DEFAULTS = {
  /**
   * Months the measurement operator is needed. OURS. Procurement and contracting,
   * short-form build and pilot, fieldwork, weighting and NRBA, publication. A wave
   * that fields in four months still runs for eighteen.
   */
  months: 18,
  /** Billable hours in a full-time contractor year: 2,080 less leave and holiday. OURS. */
  hoursPerYear: 1880,
  /** Contingency on the whole release. OURS. Stated, never folded into a line. */
  contingency: 0.2,
};

/**
 * Route A — employ the operator.
 *
 * Salary band OURS, anchored on two SOURCED points:
 *   - BLS OEWS May 2025 (released 2026-05-15, USDL-26-0725), SOC 15-2041
 *     Statisticians: median $105,650, 75th $141,490, 90th $174,050.
 *     SOC 19-3022 Survey Researchers is lower: median $69,460, 90th $130,860.
 *   - OPM 2026 GS, Washington-Baltimore locality (table 2026-DCB, +33.94%):
 *     GS-14 step 1 $143,913, step 5 $163,104.
 * Load OURS from a SOURCED ratio: BLS ECEC March 2026 (released 2026-06-12,
 * USDL-26-0827), management and professional occupations, benefits are 32.3% of
 * total compensation, i.e. 47.7% on top of wages.
 */
export const EMPLOYED = { salaryLow: 140_000, salaryHigh: 175_000, load: 0.477 };

/**
 * Route B — contract the operator.
 *
 * Rate band OURS, from SOURCED awarded ceiling rates on the GSA schedule
 * (buy.gsa.gov/pricing, index of 2026-09-02): "Survey Methodologist" n=6,
 * median $152.20/hr, range $127.79-$172.21; "Senior Statistician" n=18, median
 * $144.88/hr; "Statistician" n=51, median $122.31/hr. A schedule rate is loaded
 * already, so no overhead multiplier applies.
 * fte OURS: a contractor covering procurement and accountability, not the whole job.
 */
export const CONTRACTED = { rateLow: 130, rateHigh: 175, fte: 0.6 };

/**
 * Route C — second the operator from a university.
 *
 * Salary band SOURCED: UCL 2025/26 non-clinical spine, Grade 9 (Associate
 * Professor / Reader) £63,606-£80,525 excluding London allowance. UCEA advised
 * implementation of the 2025-26 spine from 2025-08-01.
 * On-costs SOURCED: employer Class 1 NI 15% above £5,000 (gov.uk, 2025/26) plus
 * USS employer 14.5% (Schedule of Contributions 2023) = ~29% on salary.
 * Overhead OURS, from a SOURCED US comparator: Georgia Tech / GTRC ONR agreement
 * of 2024-04-02, organized research on-campus F&A 57.4% capped and 66.5%
 * uncapped on MTDC. A UK indirect rate per academic FTE is UNVERIFIED and not
 * published in the OfS Annual TRAC 2024-25, so the US band stands in for it.
 * fte OURS: a secondment is normally a buy-out of part of a post.
 */
export const SECONDED = {
  salaryLowGbp: 63_606,
  salaryHighGbp: 80_525,
  onCosts: 0.29,
  overheadLow: 0.574,
  overheadHigh: 0.665,
  fte: 0.5,
};

/** @param {number} months @param {typeof EMPLOYED} o */
export function employedCost(months = DEFAULTS.months, o = EMPLOYED) {
  const years = months / 12;
  return withMid({
    route: "employed",
    low: o.salaryLow * (1 + o.load) * years,
    high: o.salaryHigh * (1 + o.load) * years,
  });
}

/** A line may state its own centre; otherwise the centre is the midpoint of its range. */
function withMid(l) {
  return { ...l, mid: l.mid ?? (l.low + l.high) / 2 };
}

/** @param {number} months @param {typeof CONTRACTED} o */
export function contractedCost(months = DEFAULTS.months, o = CONTRACTED, hoursPerYear = DEFAULTS.hoursPerYear) {
  const hours = (months / 12) * hoursPerYear * o.fte;
  return withMid({ route: "contracted", low: o.rateLow * hours, high: o.rateHigh * hours, hours });
}

/** @param {number} months @param {typeof SECONDED} o */
export function secondedCost(months = DEFAULTS.months, o = SECONDED, fx = GBP_USD) {
  const years = (months / 12) * o.fte;
  const low = o.salaryLowGbp * (1 + o.onCosts) * (1 + o.overheadLow) * years * fx;
  const high = o.salaryHighGbp * (1 + o.onCosts) * (1 + o.overheadHigh) * years * fx;
  return withMid({ route: "seconded", low, high });
}

/**
 * Per-complete fieldwork, from §13.1. Every one is an ESTIMATE and none is a
 * quote. The Japan and Korea premium is OURS and §13.1 says plainly that
 * nothing supports it.
 */
export const COUNTRIES = {
  US: { n: 2000, low: 75, mid: 120, high: 200, english: true },
  UK: { n: 2000, low: 70, mid: 110, high: 190, english: true },
  JP: { n: 1500, low: 150, mid: 250, high: 500, english: false },
  KR: { n: 1500, low: 150, mid: 250, high: 500, english: false },
};

/** Non-fieldwork lines, from §13.2. Translation is charged per non-English country. */
export const NON_FIELDWORK = [
  { name: "Panel short-form build", low: 60_000, high: 120_000, label: "ESTIMATE" },
  { name: "Sampling and weighting contractor", low: 80_000, high: 150_000, label: "ESTIMATE" },
  { name: "NRBA production and publication", low: 30_000, high: 60_000, label: "ESTIMATE" },
  { name: "Advisory board + external psychometric review", low: 30_000, high: 60_000, label: "ESTIMATE" },
  { name: "LLM judging at panel scale", low: 10_000, high: 30_000, label: "ESTIMATE" },
  { name: "Microdata publication, documentation, replication code", low: 20_000, high: 40_000, label: "ESTIMATE" },
].map(withMid);

/** Translation and localisation, §13.2, per non-English country. */
export const TRANSLATION = withMid({ low: 30_000, high: 60_000, label: "ESTIMATE" });

export const SHAPES = {
  A: { countries: ["US"], n: { US: 3000 } },
  B: { countries: ["US", "UK"] },
  C: { countries: ["US", "UK", "JP", "KR"] },
};

/** @param {{countries: string[], n?: Record<string, number>}} shape */
export function lines(shape) {
  const out = [];
  for (const code of shape.countries) {
    const c = COUNTRIES[code];
    if (!c) throw new Error(`unknown country ${code}`);
    const n = shape.n?.[code] ?? c.n;
    out.push(
      withMid({
        name: `${code} fieldwork, n = ${n.toLocaleString("en-US")} at $${c.mid}`,
        low: n * c.low,
        mid: n * c.mid,
        high: n * c.high,
        label: "ESTIMATE",
      }),
    );
    if (!c.english) out.push({ ...TRANSLATION, name: `${code} translation and localisation` });
  }
  return [...out, ...NON_FIELDWORK];
}

/**
 * @param {{low:number,mid?:number,high:number}} operator
 * @param {{lines?: ReturnType<typeof lines>, contingency?: number}} [opts]
 */
export function release(operator, opts = {}) {
  const ls = opts.lines ?? lines(SHAPES.B);
  const contingency = opts.contingency ?? DEFAULTS.contingency;
  const op = withMid(operator);
  const sum = (k) => ls.reduce((s, l) => s + l[k], 0) + op[k];
  const [subLow, subMid, subHigh] = [sum("low"), sum("mid"), sum("high")];
  return {
    subLow,
    subMid,
    subHigh,
    contLow: subLow * contingency,
    contMid: subMid * contingency,
    contHigh: subHigh * contingency,
    low: subLow * (1 + contingency),
    mid: subMid * (1 + contingency),
    high: subHigh * (1 + contingency),
  };
}

/** The $0.8M scenario: drop the UK, cut US n to 1,500, keep every method line. */
export const SHORTFALL = { countries: ["US"], n: { US: 1500 } };

const usd = (x) => `$${Math.round(x).toLocaleString("en-US")}`;
const m = (x) => `$${(x / 1_000_000).toFixed(2)}M`;

/** `node docs/release-cost.mjs --check` — the arithmetic the doc rests on, asserted. */
function check() {
  const eq = (got, want, what) => {
    if (Math.abs(got - want) > 1) throw new Error(`${what}: got ${got}, want ${want}`);
  };
  // Operator, 18 months.
  const e = employedCost(18);
  eq(e.low, 140_000 * 1.477 * 1.5, "employed low");
  eq(e.low, 310_170, "employed low, rounded");
  eq(e.high, 387_712, "employed high, rounded");
  const c = contractedCost(18);
  eq(c.hours, 1692, "contracted hours at 0.6 FTE over 18 months");
  eq(c.low, 219_960, "contracted low");
  eq(c.high, 296_100, "contracted high");
  const s = secondedCost(18);
  eq(s.low, 131_064, "seconded low");
  eq(s.high, 175_520, "seconded high");
  eq(s.mid, (s.low + s.high) / 2, "a route centre is its midpoint");
  // Cheapest route is the 0.5 FTE secondment, dearest is the employed hire.
  if (!(s.low < c.low && c.low < e.low)) throw new Error("route ordering changed");
  // Duration is linear, so a 12-month release costs two thirds of an 18-month one.
  eq(employedCost(12).low, (e.low * 2) / 3, "employed cost is linear in months");

  // Shape B, and the gap against the old $0.8-1.2M.
  const noOperator = release({ low: 0, high: 0 }, { contingency: 0 });
  eq(noOperator.low, 520_000, "no-operator low");
  eq(noOperator.high, 1_240_000, "no-operator high");
  eq(noOperator.mid, 805_000, "no-operator centre, i.e. the old ask");
  const cheap = release(s);
  const dear = release(e);
  eq(cheap.low, 781_277, "cheapest route low");
  eq(cheap.mid, 1_149_950, "cheapest route centre");
  eq(dear.high, 1_953_254, "dearest route high");
  eq(dear.mid, 1_384_729, "dearest route centre");
  if (!(cheap.mid > noOperator.mid)) throw new Error("the operator has to move the centre");
  // Contingency is added, never hidden: subtotal + contingency = total.
  eq(cheap.subLow + cheap.contLow, cheap.low, "contingency is additive");
  eq(cheap.subMid + cheap.contMid, cheap.mid, "contingency is additive at the centre");
  // $0.8M does not buy US+UK on any of the three routes.
  for (const t of [cheap, release(c), dear]) {
    if (t.mid < 800_000) throw new Error("a US+UK centre fell inside the old ask");
  }

  // Shape A is cheaper than B, and B than C. C carries two translation lines.
  const A = release(e, { lines: lines(SHAPES.A) });
  const C = release(e, { lines: lines(SHAPES.C) });
  if (!(A.mid < dear.mid && dear.mid < C.mid)) throw new Error("shape ordering changed");
  eq(A.mid, 1_264_730, "shape A centre, US only at n = 3,000");
  eq(C.mid, 2_392_730, "shape C centre, four countries");
  eq(lines(SHAPES.C).filter((l) => l.name.includes("translation")).length, 2, "two non-English countries");
  eq(lines(SHAPES.B).filter((l) => l.name.includes("translation")).length, 0, "US+UK needs no translation");
  eq(C.mid - dear.mid, 1_008_000, "the JP+KR phase on top of wave 1");

  // The shortfall shape only just fits, and only at the bottom of the fieldwork range.
  const short = release(contractedCost(12), { lines: lines(SHORTFALL) });
  eq(short.mid, 836_424, "US-only shortfall centre");
  if (!(short.mid > 800_000)) throw new Error("the US-only centre should still exceed $0.8M");
  if (!(short.low < 800_000)) throw new Error(`shortfall low ${short.low} should fit in $0.8M`);

  // Bad inputs.
  let threw = false;
  try {
    lines({ countries: ["ZZ"] });
  } catch {
    threw = true;
  }
  if (!threw) throw new Error("an unknown country should be rejected");
  for (const bad of ["0", "-1", "nope", ""]) {
    ARGS.months = bad;
    threw = false;
    try {
      num("months", DEFAULTS.months);
    } catch {
      threw = true;
    }
    if (!threw) throw new Error(`--months=${JSON.stringify(bad)} should be rejected`);
  }
  delete ARGS.months;
  console.log("release-cost self-check: ok");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (ARGS.check !== undefined) {
    check();
    process.exit(0);
  }
  const months = num("months", DEFAULTS.months);
  const contingency = num("contingency", DEFAULTS.contingency);
  const routes = [employedCost(months), contractedCost(months), secondedCost(months)];

  console.log(`\nMeasurement operator, ${months} months\n`);
  for (const r of routes) {
    console.log(`  ${r.route.padEnd(11)} ${usd(r.low)} - ${usd(r.high)}, centre ${usd(r.mid)}`);
  }

  console.log(`\nShape B, US + UK, contingency ${(contingency * 100).toFixed(0)}%\n`);
  for (const l of lines(SHAPES.B)) {
    console.log(
      `  ${l.name.padEnd(52)} ${usd(l.low).padStart(9)} - ${usd(l.high).padStart(9)}` +
        `  centre ${usd(l.mid).padStart(9)}  ${l.label}`,
    );
  }
  for (const r of routes) {
    const t = release(r, { contingency });
    console.log(
      `\n  operator ${r.route.padEnd(11)} subtotal ${m(t.subLow)}-${m(t.subHigh)}` +
        `  + contingency ${m(t.contLow)}-${m(t.contHigh)}` +
        `  = ${m(t.low)}-${m(t.high)}, centre ${m(t.mid)}`,
    );
  }

  console.log("\nRelease shapes, employed operator\n");
  for (const [name, shape] of Object.entries(SHAPES)) {
    const t = release(employedCost(months), { lines: lines(shape), contingency });
    console.log(`  ${name}  ${shape.countries.join("+").padEnd(14)} ${m(t.low)}-${m(t.high)}, centre ${m(t.mid)}`);
  }

  const short = release(contractedCost(12), { lines: lines(SHORTFALL), contingency });
  console.log(
    `\nShortfall shape (US only, n = 1,500, contracted operator 12 months): ` +
      `${m(short.low)}-${m(short.high)}, centre ${m(short.mid)}`,
  );
  const old = release({ low: 0, high: 0 }, { contingency: 0 });
  console.log(
    `Same lines with no operator and no contingency: ${m(old.low)}-${m(old.high)}, ` +
      `centre ${m(old.mid)}  <- the old $0.8-1.2M\n`,
  );
}
