#!/usr/bin/env python3
# /// script
# requires-python = ">=3.11"
# dependencies = ["numpy>=2.0", "scipy>=1.13"]
# ///
"""Sample size and power for the T3 transfer study (docs/TRANSFER-STUDY.md §3).

Analysis, not shipped code. It is Python and lives outside the pnpm workspace,
so no test or build gate in this repo runs it.

Re-run:  uv run research/transfer_study_power.py
         uv run research/transfer_study_power.py --reps 4000 --seed 7

Everything here is simulated. A closed-form power formula is wrong for
`reliance.index`, because the index is a difference of two proportions measured
on the SAME candidate from two different event pools, so its sampling variance
carries both pools' binomial noise while its true variance depends on how the
two traits covary. The simulation makes that visible instead of assuming it.

Generative model, stated once and used everywhere below.

  Candidate i, sitting t (t = 1, 2, at least 14 days apart, disjoint forms):

      logit(p_over[i,t])  = mu_over  + b_over[i]  + s_over[i,t]
      logit(p_under[i,t]) = mu_under + b_under[i] + s_under[i,t]

  b_* is the stable candidate trait, drawn with SD sigma_b and trait
  correlation RHO_TRAIT between over and under. s_* is sitting-level state
  noise, SD sigma_s, independent across sittings. The latent reliability of a
  rate is sigma_b^2 / (sigma_b^2 + sigma_s^2); that is the "true ICC" column,
  the number we would measure with infinitely many events per sitting.

  Counts are then drawn: k_over ~ BetaBinomial(E_err, p_over, rho_event),
  k_under ~ BetaBinomial(E_ok, p_under, rho_event). rho_event is the
  correlation between events WITHIN one sitting. Buc,inca, Malaya & Gajos
  (CSCW 2021) found people "develop general heuristics about whether and when
  to follow the AI suggestions" rather than judging each item, so the events
  are not independent trials of one skill; rho_event = 0 recovers the binomial
  case and is reported as the optimistic bound.

  Observed rates are k/E. reliance.index = over - under, as in
  packages/tracks/t3-reasoning.

Sources for the assumption ranges (private repo docs/EVIDENCE-CALIBRATED-
RELIANCE.md §3 and §5, docs/EVIDENCE-RELIABILITY-AND-TIME-PRESSURE.md):

  * Karvelis et al., PLoS ONE 19(11):e0312255 (2024): advice taking, 39
    participants, 153 trials, two sessions, ICC < 0.5. The only direct
    test-retest of an advice-taking rate.
  * Hedge, Powell & Sumner, Behav. Res. Methods 50:1166-1186 (2018):
    difference scores are "generally lower in reliability than their
    components".
  * Enkavi et al., PNAS (2019): behavioural task DVs median ICC 0.311,
    contrast DVs median ICC 0.174.
  * Rosbach et al., MELBA 2026 (arXiv:2603.11821): weight of advice 0.48 ->
    0.54 under a 10 s timer, SD 0.13, t(27) = 2.55, p = .017.
  * Rosbach et al. (arXiv:2411.00998): the RATE of error adoption did not
    move under time pressure (p = 0.19), only its severity.
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass

import numpy as np
from scipy import stats

# ---------------------------------------------------------------------------
# Assumptions. Every one of them is varied in the sensitivity section.
# ---------------------------------------------------------------------------

MU_OVER = 0.40  # mean over-reliance rate: accepts 40% of planted errors
MU_UNDER = 0.20  # mean under-reliance rate: rejects 20% of correct advice
RHO_TRAIT = 0.0  # correlation of the two candidate traits
RHO_EVENT = 0.10  # within-sitting correlation between events
TRUE_ICCS = (0.3, 0.4, 0.5, 0.6, 0.7)
N_GRID = (30, 50, 75, 100, 150, 200, 300, 400, 600, 800, 1200)
EVENT_GRID = (8, 12, 16, 20, 30, 40, 60, 97, 150)
ALPHA = 0.05


def logit(p: float) -> float:
    return float(np.log(p / (1 - p)))


def expit(x: np.ndarray) -> np.ndarray:
    return 1.0 / (1.0 + np.exp(-x))


# ---------------------------------------------------------------------------
# Data generation
# ---------------------------------------------------------------------------


def _sigmas(true_icc: float, sigma_total: float = 1.0) -> tuple[float, float]:
    """Split a total latent SD into trait and state parts at a target ICC."""
    sigma_b = sigma_total * np.sqrt(true_icc)
    sigma_s = sigma_total * np.sqrt(1 - true_icc)
    return float(sigma_b), float(sigma_s)


def beta_binomial(
    rng: np.random.Generator, n_events: int, p: np.ndarray, rho_event: float
) -> np.ndarray:
    """Counts out of n_events with within-sitting event correlation rho_event.

    rho_event = 0 is the plain binomial. Otherwise draw the sitting's realised
    rate from Beta(alpha, beta) with mean p and intraclass correlation
    rho_event = 1 / (alpha + beta + 1), then draw the count binomially.
    """
    if rho_event <= 0:
        return rng.binomial(n_events, p)
    concentration = (1.0 - rho_event) / rho_event
    a = np.clip(p * concentration, 1e-6, None)
    b = np.clip((1.0 - p) * concentration, 1e-6, None)
    return rng.binomial(n_events, rng.beta(a, b))


@dataclass(frozen=True)
class Design:
    true_icc: float
    n_errors: int = 20  # planted errors per sitting (over-reliance denominator)
    n_correct: int = 20  # correct-advice opportunities (under-reliance denom.)
    rho_trait: float = RHO_TRAIT
    rho_event: float = RHO_EVENT
    mu_over: float = MU_OVER
    mu_under: float = MU_UNDER


def simulate_sittings(
    rng: np.random.Generator, design: Design, reps: int, n: int
) -> dict[str, np.ndarray]:
    """Return observed rates, shape (reps, n, 2 sittings), per measure."""
    sigma_b, sigma_s = _sigmas(design.true_icc)
    cov = np.array([[1.0, design.rho_trait], [design.rho_trait, 1.0]])
    trait = rng.multivariate_normal([0.0, 0.0], cov, size=(reps, n)) * sigma_b
    state = rng.normal(0.0, sigma_s, size=(reps, n, 2, 2))

    lo = logit(design.mu_over) + trait[:, :, None, 0] + state[:, :, :, 0]
    lu = logit(design.mu_under) + trait[:, :, None, 1] + state[:, :, :, 1]
    p_over, p_under = expit(lo), expit(lu)

    k_over = beta_binomial(rng, design.n_errors, p_over, design.rho_event)
    k_under = beta_binomial(rng, design.n_correct, p_under, design.rho_event)
    over = k_over / design.n_errors
    under = k_under / design.n_correct
    return {"over": over, "under": under, "index": over - under}


# ---------------------------------------------------------------------------
# ICC(2,1), two-way random effects, single measure, k = 2 occasions.
# Point estimate and CI follow Shrout & Fleiss (1979) as restated by
# McGraw & Wong (1996).
# ---------------------------------------------------------------------------


def icc21(x: np.ndarray) -> np.ndarray:
    """x: (reps, n, 2) -> ICC(2,1) per rep."""
    n, k = x.shape[1], x.shape[2]
    grand = x.mean(axis=(1, 2), keepdims=True)
    row = x.mean(axis=2, keepdims=True)
    col = x.mean(axis=1, keepdims=True)
    ms_r = (k * ((row - grand) ** 2).sum(axis=(1, 2))) / (n - 1)
    ms_c = (n * ((col - grand) ** 2).sum(axis=(1, 2))) / (k - 1)
    ms_e = ((x - row - col + grand) ** 2).sum(axis=(1, 2)) / ((n - 1) * (k - 1))
    return (ms_r - ms_e) / (ms_r + (k - 1) * ms_e + k * (ms_c - ms_e) / n)


def icc21_ci(x: np.ndarray, alpha: float = ALPHA) -> tuple[np.ndarray, ...]:
    """Point estimate and 95% CI per rep for x of shape (reps, n, 2)."""
    n, k = x.shape[1], x.shape[2]
    grand = x.mean(axis=(1, 2), keepdims=True)
    row = x.mean(axis=2, keepdims=True)
    col = x.mean(axis=1, keepdims=True)
    ms_r = (k * ((row - grand) ** 2).sum(axis=(1, 2))) / (n - 1)
    ms_c = (n * ((col - grand) ** 2).sum(axis=(1, 2))) / (k - 1)
    ms_e = ((x - row - col + grand) ** 2).sum(axis=(1, 2)) / ((n - 1) * (k - 1))
    est = (ms_r - ms_e) / (ms_r + (k - 1) * ms_e + k * (ms_c - ms_e) / n)

    r = np.clip(est, 1e-6, 1 - 1e-6)
    a = (k * r) / (n * (1 - r))
    b = 1 + (k * r * (n - 1)) / (n * (1 - r))
    v = ((a * ms_c + b * ms_e) ** 2) / (
        (a * ms_c) ** 2 / (k - 1) + (b * ms_e) ** 2 / ((n - 1) * (k - 1))
    )
    f_l = stats.f.ppf(1 - alpha / 2, n - 1, v)
    f_u = stats.f.ppf(1 - alpha / 2, v, n - 1)
    lower = (n * (ms_r - f_l * ms_e)) / (
        f_l * (k * ms_c + (k * n - k - n) * ms_e) + n * ms_r
    )
    upper = (n * (f_u * ms_r - ms_e)) / (
        k * ms_c + (k * n - k - n) * ms_e + n * f_u * ms_r
    )
    return est, np.clip(lower, -1, 1), np.clip(upper, -1, 1)


# ---------------------------------------------------------------------------
# Question 1 and 5: ICC per measure against n, and the index's penalty
# ---------------------------------------------------------------------------


def q1_icc_table(rng: np.random.Generator, reps: int) -> str:
    """Candidates needed for an ICC(2,1) that decides anything.

    Three columns, three different jobs:
      * CI width <= 0.30 - the coefficient is reportable at all;
      * upper bound < 0.5 - the study can say the rate is NOT usable, which is
        the pre-committed consequence in docs/TRANSFER-STUDY.md §3.2;
      * lower bound > 0.5 - the study can say it IS usable.
    The 0.5 line is applied to the OBSERVED ICC, because that is the number the
    study reports and the number §3.2 pre-commits against.
    """
    rows = [
        "| events per sitting | true latent ICC | measure | observed ICC (median) | n for CI width <= 0.30 | n to rule 0.5 OUT (upper < 0.5) | n to rule 0.5 IN (lower > 0.5) |",
        "|---|---|---|---|---|---|---|",
    ]
    for events in (20, 40, 97):
        for true_icc in TRUE_ICCS:
            design = Design(true_icc=true_icc, n_errors=events, n_correct=events)
            for measure in ("over", "under", "index"):
                observed: float | None = None
                n_width = n_out = n_in = "> 1200"
                for n in N_GRID:
                    data = simulate_sittings(rng, design, reps, n)[measure]
                    est, lo, hi = icc21_ci(data)
                    if observed is None:
                        observed = float(np.median(est))
                    if n_width == "> 1200" and float(np.median(hi - lo)) <= 0.30:
                        n_width = str(n)
                    if n_out == "> 1200" and float(np.mean(hi < 0.5)) >= 0.80:
                        n_out = str(n)
                    if n_in == "> 1200" and float(np.mean(lo > 0.5)) >= 0.80:
                        n_in = str(n)
                    if "> 1200" not in (n_width, n_out, n_in):
                        break
                rows.append(
                    f"| {events} | {true_icc:.1f} | `reliance.{measure}` | "
                    f"{observed:.2f} | {n_width} | {n_out} | {n_in} |"
                )
    return "\n".join(rows)


def q6_pilot(rng: np.random.Generator, reps: int) -> str:
    """What a 30-candidate pilot buys before committing to the full study."""
    rows = [
        "| true latent ICC | measure | pilot ICC (median) | pilot CI width | P(CI upper < 0.5) | P(CI covers 0 to 0.5, i.e. tells us nothing) |",
        "|---|---|---|---|---|---|",
    ]
    for true_icc in (0.3, 0.5, 0.7):
        design = Design(true_icc=true_icc)
        data = simulate_sittings(rng, design, reps, 30)
        for measure in ("over", "under", "index"):
            est, lo, hi = icc21_ci(data[measure])
            rows.append(
                f"| {true_icc:.1f} | `reliance.{measure}` | {float(np.median(est)):.2f} | "
                f"{float(np.median(hi - lo)):.2f} | {float(np.mean(hi < 0.5)):.2f} | "
                f"{float(np.mean((lo < 0.0) & (hi > 0.5))):.2f} |"
            )
    return "\n".join(rows)


def q5_index_penalty(rng: np.random.Generator, reps: int) -> str:
    rows = [
        "| true latent ICC | trait correlation | ICC over | ICC under | ICC index | CI width at n = 200: over | CI width at n = 200: index |",
        "|---|---|---|---|---|---|---|",
    ]
    for true_icc in (0.4, 0.6):
        for rho_trait in (-0.3, 0.0, 0.3):
            design = Design(true_icc=true_icc, rho_trait=rho_trait)
            data = simulate_sittings(rng, design, reps, 200)
            iccs = {m: float(np.median(icc21(data[m]))) for m in data}
            widths = {}
            for m in ("over", "index"):
                _, lo, hi = icc21_ci(data[m])
                widths[m] = float(np.median(hi - lo))
            rows.append(
                f"| {true_icc:.1f} | {rho_trait:+.1f} | {iccs['over']:.2f} | "
                f"{iccs['under']:.2f} | {iccs['index']:.2f} | "
                f"{widths['over']:.2f} | {widths['index']:.2f} |"
            )
    return "\n".join(rows)


# ---------------------------------------------------------------------------
# Question 2: events per sitting against the width of a rate's interval
# ---------------------------------------------------------------------------


def wald_halfwidth(p: float, n_eff: float, alpha: float = ALPHA) -> float:
    """The textbook normal-approximation half-width, z * sqrt(p(1-p)/n).

    This is the figure quoted as "about +/-0.35 at 8 events" in
    docs/TRANSFER-STUDY.md §3.3 and in the private repo's
    docs/EVIDENCE-CALIBRATED-RELIANCE.md §3. It is kept here so the two
    documents can be reconciled: Wald is wider than Wilson at small n, and
    Wilson is the interval a study should actually report.
    """
    z = stats.norm.ppf(1 - alpha / 2)
    return float(z * np.sqrt(p * (1 - p) / n_eff))


def wilson_halfwidth(p: float, n_eff: float, alpha: float = ALPHA) -> float:
    z = stats.norm.ppf(1 - alpha / 2)
    denom = 1 + z * z / n_eff
    half = (z / denom) * np.sqrt(p * (1 - p) / n_eff + z * z / (4 * n_eff * n_eff))
    return float(half)


def q2_event_table(rng: np.random.Generator, reps: int) -> str:
    rows = [
        "| planted errors per sitting | +/- Wald (the quoted figure) | +/- Wilson, independent events | +/- Wilson, rho_event = 0.10 | +/- Wilson, rho_event = 0.20 | empirical +/- at rho = 0.10 |",
        "|---|---|---|---|---|---|",
    ]
    for e in EVENT_GRID:
        cells = []
        for rho in (0.0, 0.10, 0.20):
            n_eff = e / (1 + (e - 1) * rho)
            cells.append(wilson_halfwidth(0.5, n_eff))
        p = np.full((max(reps, 20000), 1), 0.5)
        draws = beta_binomial(rng, e, p, 0.10) / e
        emp = float((np.percentile(draws, 97.5) - np.percentile(draws, 2.5)) / 2)
        rows.append(
            f"| {e} | {wald_halfwidth(0.5, e):.3f} | {cells[0]:.3f} | "
            f"{cells[1]:.3f} | {cells[2]:.3f} | {emp:.3f} |"
        )
    return "\n".join(rows)


# ---------------------------------------------------------------------------
# Question 3: correlating AILX rates against RAIR / RSR from the two-stage block
# ---------------------------------------------------------------------------


def q3_correlation_table(rng: np.random.Generator, reps: int) -> str:
    """n for the correlation between two noisy measures of correlated traits.

    rho_true is the correlation of the underlying constructs. Both measures are
    attenuated by their own reliability, so the correlation the study can
    actually observe is rho_true * sqrt(rel_ailx * rel_rair).
    """
    rows = [
        "| true construct r | reliability of each measure | observable r (attenuated) | n for CI half-width <= 0.15 | n for CI lower bound > 0.20 (80% of the time) |",
        "|---|---|---|---|---|",
    ]
    for rho_true in (0.3, 0.5, 0.7):
        for rel in (0.4, 0.6):
            observable = rho_true * rel  # sqrt(rel*rel) = rel
            n_width, n_decide = "> 1200", "> 1200"
            for n in N_GRID:
                z = np.arctanh(np.clip(observable, -0.999, 0.999))
                # sampling distribution of Fisher z is N(z, 1/(n-3))
                se = 1 / np.sqrt(n - 3)
                half = float(
                    (np.tanh(z + 1.96 * se) - np.tanh(z - 1.96 * se)) / 2
                )
                if n_width == "> 1200" and half <= 0.15:
                    n_width = str(n)
                # power to put the whole interval above 0.20, by simulation
                r_hat = np.tanh(rng.normal(z, se, size=reps))
                zz = np.arctanh(np.clip(r_hat, -0.999, 0.999))
                lower = np.tanh(zz - 1.96 * se)
                if n_decide == "> 1200" and float(np.mean(lower > 0.20)) >= 0.80:
                    n_decide = str(n)
                if n_width != "> 1200" and n_decide != "> 1200":
                    break
            rows.append(
                f"| {rho_true:.1f} | {rel:.1f} | {observable:.2f} | {n_width} | {n_decide} |"
            )
    return "\n".join(rows)


# ---------------------------------------------------------------------------
# Question 4: timed vs untimed arms
# ---------------------------------------------------------------------------


def q4_arm_table(rng: np.random.Generator, reps: int) -> str:
    """Per-arm n for 80% power on a between-arm difference in over-reliance.

    The only published effect is Rosbach et al. 2026: weight of advice 0.48 ->
    0.54 with SD 0.13, t(27) = 2.55, p = .017, a paired 10 s countdown in
    computational pathology. Read as a between-subject standardised effect that
    is 0.06 / 0.13 = 0.46. AILX's arms are between-subject and the outcome is a
    RATE, not a weight, so the assumed shift is 0.48 -> 0.54 on the rate.
    """
    rows = [
        "| assumed shift in over-reliance rate | events per sitting | rho_event | n per arm for 80% power |",
        "|---|---|---|---|",
    ]
    for shift in (0.06, 0.03):
        for n_errors in (8, 20, 40):
            for rho in (0.0, 0.10):
                need = "> 2000"
                for n in (25, 50, 75, 100, 150, 200, 250, 300, 350, 400, 500, 600, 800, 1000, 1400, 2000):
                    sig = _arm_power(rng, reps, n, n_errors, shift, rho)
                    if sig >= 0.80:
                        need = str(n)
                        break
                rows.append(f"| {shift:+.2f} | {n_errors} | {rho:.2f} | {need} |")
    return "\n".join(rows)


def _arm_power(
    rng: np.random.Generator,
    reps: int,
    n_per_arm: int,
    n_errors: int,
    shift: float,
    rho_event: float,
) -> float:
    """Two-sample t-test on the observed rate, both arms n_per_arm."""
    sigma_b, sigma_s = _sigmas(0.5)
    base = logit(0.48)
    out = []
    for mu in (base, logit(0.48 + shift)):
        lat = mu + rng.normal(0, np.hypot(sigma_b, sigma_s), size=(reps, n_per_arm))
        p = expit(lat)
        out.append(beta_binomial(rng, n_errors, p, rho_event) / n_errors)
    t, pval = stats.ttest_ind(out[1], out[0], axis=1)
    return float(np.mean(pval < ALPHA))


# ---------------------------------------------------------------------------
# Self-checks. If these fail the numbers above are not trustworthy.
# ---------------------------------------------------------------------------


def self_checks(rng: np.random.Generator, reps: int) -> list[str]:
    out = []
    # 1. ICC estimator recovers the latent ICC when events are effectively free.
    design = Design(true_icc=0.6, n_errors=5000, n_correct=5000, rho_event=0.0)
    est = float(np.median(icc21(simulate_sittings(rng, design, 200, 400)["over"])))
    out.append(f"ICC estimator with 5000 events recovers 0.60: {est:.3f}")
    assert 0.55 <= est <= 0.65, est
    # 2. CI coverage of the true observed-ICC value is near 95%.
    design = Design(true_icc=0.5)
    data = simulate_sittings(rng, design, reps, 200)["over"]
    truth = float(np.median(icc21(simulate_sittings(rng, design, 200, 20000)["over"])))
    _, lo, hi = icc21_ci(data)
    cov = float(np.mean((lo <= truth) & (truth <= hi)))
    out.append(f"CI coverage of the attenuated truth {truth:.3f} at n=200: {cov:.3f}")
    assert 0.88 <= cov <= 0.99, cov
    # 3. The Wald half-width at 8 events reproduces the documented +/-0.35, and
    #    Wilson is narrower, which is why both are reported in Q2.
    wald = wald_halfwidth(0.5, 8)
    wilson = wilson_halfwidth(0.5, 8)
    out.append(
        f"half-width at 8 independent events: Wald {wald:.3f}, Wilson {wilson:.3f}"
    )
    assert 0.33 <= wald <= 0.36, wald
    assert wilson < wald
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--reps", type=int, default=2000)
    ap.add_argument("--seed", type=int, default=20260902)
    args = ap.parse_args()
    rng = np.random.default_rng(args.seed)

    print(f"# T3 transfer-study power, reps={args.reps}, seed={args.seed}\n")
    print("## Self-checks\n")
    for line in self_checks(rng, args.reps):
        print(f"- {line}")
    print(
        f"\nStanding assumptions: mean over-reliance {MU_OVER}, mean under-reliance "
        f"{MU_UNDER}, 20 planted errors and 20 correct-advice events per sitting, "
        f"two sittings, event correlation {RHO_EVENT}, trait correlation {RHO_TRAIT}."
    )
    print("\n## Q1 - candidates for a usable ICC(2,1)\n")
    print(q1_icc_table(rng, args.reps))
    print("\n## Q2 - events per sitting against a rate's 95% interval\n")
    print(q2_event_table(rng, args.reps))
    print("\n## Q3 - correlating over/under against RAIR and RSR\n")
    print(q3_correlation_table(rng, args.reps))
    print("\n## Q4 - timed vs untimed arms\n")
    print(q4_arm_table(rng, args.reps))
    print("\n## Q5 - what the index costs against its components\n")
    print(q5_index_penalty(rng, args.reps))
    print("\n## Q6 - what a 30-candidate pilot buys\n")
    print(q6_pilot(rng, args.reps))


if __name__ == "__main__":
    main()
