"use client";

/**
 * THE COMPOSITE CARD. ONE CARD, WHOEVER ISSUED THE NUMBER (TEN-92).
 *
 * This is the report's composite presentation, lifted out of `app/report/page.tsx`
 * unchanged so a hosted sitting can use it instead of growing a second one.
 * A second card would be a second set of caveats to keep true, and the
 * caveats are the part that matters: the cohort here is 44 generated runs,
 * not people, and the band is a position in that fixture.
 *
 * WHAT CHANGES WITH THE SOURCE, AND WHY. A local composite is replayed from
 * this browser's own log, so the browser holds the whole cohort and every
 * track: it draws the dot strip and the radar. A hosted composite arrives as
 * a number with its sources, so the card draws the bars it was sent, cites
 * the score rows behind them, and says the exam service issued it. It draws
 * no strip, because the browser was sent no distribution and will not invent
 * one.
 */
import { TOTAL_POINTS } from "@ailx/core";
import { CUTLINE_BANDS } from "@ailx/contract";
import { useEffect, useState } from "react";
import { TrackRadar } from "../../components/TrackRadar";
import type { CompositeCardView } from "./compositeView";

/**
 * The dots are a SYNTHETIC calibration cohort shipped with the demo, not
 * people. The page used to say so in a small pill next to a percentile-shaped
 * number, which is exactly the part that survives a screenshot; the strip now
 * carries the qualification itself, in the same words the diagnosis below
 * uses (@ailx/report `diagnosis.ts`).
 */
export const COHORT_CAPTION =
  "Every dot is a synthetic demo run generated for this fixture, not a person. " +
  "Where you sit among them is not a percentile and not a rank against real " +
  "players — the judging pipeline is not built yet.";

/**
 * The same caveat where there are no dots to caption.
 *
 * A hosted composite is standardized against the SAME seeded fixture, so the
 * candidate is owed the same sentence. It names the seed, because a reader who
 * wants to check which cohort produced their band can only do that if the card
 * says which one it was.
 */
export function serviceCohortCaption(cohortSize: number, seed: string): string {
  return (
    `Standardized against a seeded synthetic demo cohort: ${cohortSize - 1} generated runs, ` +
    `seed ${seed}. They are not people and not a sample of anyone, so your band is a ` +
    `position in that fixture and not a rank among players. The exam service holds the ` +
    `cohort, so this page draws no distribution for it.`
  );
}

/** rAF count-up — the score reveal is the reward (§13). */
function useCountUp(target: number, ms = 1400): number {
  const [v, setV] = useState(0);
  useEffect(() => {
    if (target === 0) return;
    let raf = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / ms);
      const eased = 1 - (1 - p) ** 3;
      setV(target * eased);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return v;
}

function DistStrip({ cohort, mine }: { cohort: number[]; mine: number }) {
  return (
    <figure className="dist-figure" data-testid="dist-strip">
      <svg viewBox="0 0 400 56" className="dist-strip" role="img" aria-label={`Position among ${cohort.length} synthetic demo runs. ${COHORT_CAPTION}`}>
        <line x1="10" y1="40" x2="390" y2="40" stroke="var(--border-strong)" strokeWidth="1" />
        {[0, 25, 50, 75, 100].map((x) => (
          <text key={x} x={10 + x * 3.8} y="53" fontSize="9" fill="var(--faint)" textAnchor="middle" fontFamily="var(--mono)">{x}</text>
        ))}
        {cohort.map((c, i) => (
          <circle key={i} cx={10 + c * 3.8} cy={40 - 6 - (i % 5) * 4} r="2.6"
            fill={Math.abs(c - mine) < 0.01 ? "var(--accent)" : "var(--faint)"}
            opacity={Math.abs(c - mine) < 0.01 ? 1 : 0.45} />
        ))}
        <line x1={10 + mine * 3.8} y1="6" x2={10 + mine * 3.8} y2="42" stroke="var(--accent)" strokeWidth="2" />
        <text x={10 + mine * 3.8} y="4" fontSize="9" fill="var(--accent)" textAnchor="middle" fontFamily="var(--mono)" dominantBaseline="hanging">you</text>
      </svg>
      <figcaption className="dist-caption small">
        <strong>Synthetic demo cohort — {cohort.length} generated runs.</strong> {COHORT_CAPTION}
      </figcaption>
    </figure>
  );
}

/**
 * The rows the service derived the number from, by their stored ids.
 *
 * "Byte-identically recomputable from stored inputs" is the project's first
 * invariant, and on a hosted report the browser cannot demonstrate it: the
 * evidence is on the service's side of the boundary. Naming the exact `scores`
 * rows is what a reader can check instead of taking the sentence on trust.
 */
function SourceRows({ view }: { view: CompositeCardView }) {
  if (view.origin.kind !== "server") return null;
  return (
    <div data-testid="composite-sources" style={{ marginTop: "0.6rem" }}>
      <p className="faint small mono" style={{ margin: 0 }} data-testid="composite-attribution">
        issued by the exam service · scoredBy server · this browser did not compute it, so it
        claims no local replay of it
      </p>
      {view.origin.sources.map((s) => (
        <p key={s.scoreId} className="faint small mono" style={{ margin: "0.2rem 0 0" }}
          data-testid={`composite-source-${s.trackId}`}>
          {s.trackId.toUpperCase()} score {s.scoreId} · {s.scaled.toFixed(1)} · weight{" "}
          {s.weight.toFixed(3)}
          {s.rubricVersion === "" ? "" : ` · marking ${s.rubricVersion.slice(0, 12)}…`}
          {s.scoringDigest === "" ? "" : ` · scoring ${s.scoringDigest.slice(0, 12)}…`}
        </p>
      ))}
    </div>
  );
}

export function CompositeCard({ view }: { view: CompositeCardView }) {
  const [showBand, setShowBand] = useState(false);
  const [copied, setCopied] = useState(false);
  const counted = useCountUp(view.composite);
  useEffect(() => {
    const id = window.setTimeout(() => setShowBand(true), 1100);
    return () => window.clearTimeout(id);
  }, []);

  return (
    <div className="share-card" style={{ marginBottom: "2rem" }} data-testid={`composite-card-${view.origin.kind}`}>
      <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: "1rem", alignItems: "center" }}>
        <div>
          <div className="eyebrow">run {view.attemptId} · synthetic demo cohort n = {view.cohortSize}</div>
          {/* The rAF count-up is decorative for AT: hide the animated
              number and expose the final value + band once, politely. */}
          <div aria-hidden="true" className="composite-number" style={{ fontSize: "3.4rem", fontWeight: 800, fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>
            {counted.toFixed(1)}
          </div>
          <span className="sr-only" role="status">
            {showBand
              ? `Composite score ${view.composite.toFixed(1)} out of 100. Band: ${view.band}.`
              : ""}
          </span>
          <div className="muted small">composite · standardized on the synthetic demo cohort · mean 50 · SD 15</div>
          <div className="muted small">
            raw {view.rawTotal.toFixed(1)} / {TOTAL_POINTS}
          </div>
          {view.percentile <= 0.5 / view.cohortSize + 1e-9 ? (
            <div className="faint small" style={{ maxWidth: "34ch" }}>
              Floor of this demo cohort: every run below all {view.cohortSize - 1} synthetic
              peers lands on the same standardized value. The raw points above still move.
            </div>
          ) : null}
          {showBand ? (
            <div aria-hidden="true" className={`reveal-band pop-in band-${view.band}`}>{view.band}</div>
          ) : (
            <div aria-hidden="true" className="reveal-band" style={{ opacity: 0.15 }}>····</div>
          )}
        </div>
        {view.origin.kind === "local" ? <TrackRadar values={view.origin.trackRaw} /> : null}
      </div>
      {view.origin.kind === "local" ? (
        <DistStrip cohort={view.origin.cohortComposites} mine={view.composite} />
      ) : (
        <p className="dist-caption small" data-testid="composite-cohort-caption">
          <strong>Synthetic demo cohort — {view.cohortSize - 1} generated runs.</strong>{" "}
          {serviceCohortCaption(view.cohortSize, view.cohortSeed)}
        </p>
      )}
      <div className="share-track-bars" data-testid="share-track-bars">
        {view.bars.map((b) => (
          <div className="row" key={b.trackId}>
            <span className="mono" style={{ color: "var(--accent)" }}>{b.trackId.toUpperCase()}</span>
            <div className="meter"><div style={{ width: `${Math.max(0, Math.min(100, b.value))}%` }} /></div>
            <span className="mono" style={{ textAlign: "right" }}>{b.value.toFixed(1)}</span>
          </div>
        ))}
      </div>
      <p className="faint small mono" style={{ margin: "0.4rem 0 0" }}>
        quota-derived band cutlines (this synthetic cohort):{" "}
        {CUTLINE_BANDS.map((b) => `${b} ≥ ${view.bandCutlines[b]?.toFixed(1) ?? "—"}`).join(" · ")}{" "}
        — bands are quota-authoritative (spec §04), not fixed thresholds.
      </p>
      <SourceRows view={view} />
      <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap", marginTop: "0.6rem" }}>
        <button className="btn small-btn" onClick={() => {
          navigator.clipboard?.writeText(view.shareText).then(() => {
            setCopied(true); window.setTimeout(() => setCopied(false), 1500);
          });
        }}>{copied ? "copied ✓" : "copy summary"}</button>
        <span className="badge demo">demo cohort</span>
      </div>
    </div>
  );
}
