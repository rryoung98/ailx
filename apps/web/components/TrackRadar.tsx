/**
 * Track radar — hand-rolled SVG (no chart library, FRONTEND.md §7).
 *
 * ONE definition: the report renders it for the candidate, the share view
 * renders it for whoever they sent the link to, and the public gallery
 * renders it on a card. It is a plain function of its props (no hooks, no
 * browser API), so it is safe in a server component too.
 *
 * EVERY SPOKE IS DRAWN AGAINST ITS OWN TRACK'S MAXIMUM (TEN-120). It used to
 * be `Math.min(100, values[t]) / 100`, and no track is worth 100: T1 is 135,
 * T2 is 80, T3 is 160 and T4 issues no points at all. So T3 was clipped —
 * every score from 100 to 160 drew the same outer vertex — and a perfect T2
 * drew at four fifths of the ring beside a T1 at 100/135 drawing full, which
 * made the stronger performance look weaker. This is the figure that gets
 * screenshotted; the numeric surface was fixed first
 * (`formatTrackScore`, packages/report/src/judging.ts) and said why.
 *
 * The maxima come from `TRACK_META`, which derives them from
 * `SCORE_ALLOCATION` in `@ailx/core`. This file holds no copy of the
 * allocation and must never grow one.
 */
import { TRACK_IDS, type TrackId } from "@ailx/session";
import { TRACK_META } from "@ailx/report";

/**
 * The tracks that carry a score, in instrument order. T4 is a SHOWCASE: it
 * is run and recorded and it issues no points, so a spoke for it would be a
 * score it does not have. It is named under the figure instead, in the same
 * words `formatTrackScore` uses for the number.
 */
const SCORED_TRACKS: readonly TrackId[] = TRACK_IDS.filter((t) => TRACK_META[t].scored);
const SHOWCASE_TRACKS: readonly TrackId[] = TRACK_IDS.filter((t) => !TRACK_META[t].scored);

/**
 * One track's position on its OWN axis, 0 to 1. Never a /100 fraction.
 *
 * A showcase track has a maximum of 0, so it has no position at all: 0 is
 * the honest answer and nothing draws it (see `SHOWCASE_TRACKS`).
 */
function fraction(trackId: TrackId, value: number): number {
  const max = TRACK_META[trackId].points;
  if (!(max > 0) || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value / max));
}

/**
 * The same fraction as a CSS width percentage, for the bar charts that stand
 * beside this radar (the share card, the report). Exported so a bar and a
 * spoke cannot end up on different axes — which is exactly how the numeric
 * surface and the graphical one came to disagree (TEN-120).
 */
export function trackFillPercent(trackId: TrackId, value: number): number {
  return fraction(trackId, value) * 100;
}

/** `T1 88.9 / 135, T2 52.9 / 80, …` — the figure, for somebody who cannot see it. */
function shapeLabel(values: Record<TrackId, number>): string {
  const scored = SCORED_TRACKS.map(
    (t) => `${t.toUpperCase()} ${values[t].toFixed(1)} / ${TRACK_META[t].points}`,
  ).join(", ");
  const showcase = SHOWCASE_TRACKS.map(
    (t) => `${t.toUpperCase()} ${values[t].toFixed(1)}, showcase, not scored`,
  ).join(", ");
  return `Track shape: ${[scored, showcase].filter((s) => s !== "").join("; ")}`;
}

export function TrackRadar({
  values,
  size = 260,
}: {
  values: Record<TrackId, number>;
  size?: number;
}) {
  const C = 110, R = 82;
  const n = SCORED_TRACKS.length;
  const at = (i: number, r: number): [number, number] => {
    const a = (Math.PI * 2 * i) / n - Math.PI / 2;
    return [C + r * Math.cos(a), C + r * Math.sin(a)];
  };
  const pts = SCORED_TRACKS.map((t, i) => at(i, fraction(t, values[t]) * R));
  const ring = (f: number) => SCORED_TRACKS.map((_, i) => at(i, R * f).join(",")).join(" ");
  return (
    <div>
      <svg viewBox="0 0 220 220" style={{ width: "100%", maxWidth: size }} role="img" aria-label={shapeLabel(values)}>
        {[0.25, 0.5, 0.75, 1].map((f) => (
          <polygon key={f} points={ring(f)} fill="none" stroke="var(--border)" strokeWidth="1" />
        ))}
        {SCORED_TRACKS.map((t, i) => {
          const [lx, ly] = at(i, R);
          const [tx, ty] = at(i, R + 16);
          return (
            <g key={t}>
              <line x1={C} y1={C} x2={lx} y2={ly} stroke="var(--border)" strokeWidth="1" />
              <text x={tx} y={ty + 4} textAnchor="middle" fill="var(--muted)" fontSize="11" fontFamily="var(--mono)">
                {t.toUpperCase()}
              </text>
            </g>
          );
        })}
        <polygon
          points={pts.map((p) => p.join(",")).join(" ")}
          fill="var(--accent)" fillOpacity="0.25" stroke="var(--accent)" strokeWidth="2"
        />
        {pts.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r="3.5" fill="var(--accent)" />)}
      </svg>
      {/* Said out loud, because a track that is simply ABSENT from a figure
          reads as a track that was not sat. It was, and it issues no points. */}
      <p className="faint small" style={{ margin: "0.2rem 0 0", textAlign: "center" }}>
        {SHOWCASE_TRACKS.map((t) => t.toUpperCase()).join(" · ")} · showcase, not scored
      </p>
    </div>
  );
}
