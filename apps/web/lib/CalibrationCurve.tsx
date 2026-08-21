"use client";

/**
 * CalibrationCurve — inline-SVG reliability diagram for T2: mean stated
 * confidence per bin (x) against observed accuracy (y), with the identity
 * diagonal as the perfect-calibration reference. Renders ONLY persisted,
 * answered responses (see lib/calibration.ts); empty bins are simply not
 * plotted — nothing is imputed.
 */

import * as React from "react";
import type { CalibrationBin } from "./calibration";

const W = 340;
const H = 240;
const PAD = { l: 40, r: 12, t: 12, b: 34 };

function sx(v: number): number {
  return PAD.l + v * (W - PAD.l - PAD.r);
}
function sy(v: number): number {
  return H - PAD.b - v * (H - PAD.t - PAD.b);
}

export function CalibrationCurve({ bins }: { bins: ReadonlyArray<CalibrationBin> }) {
  const filled = bins.filter((b) => b.n > 0);
  if (filled.length === 0) return null;
  const total = filled.reduce((a, b) => a + b.n, 0);
  const pts = filled.map((b) => [sx(b.meanConfidence), sy(b.accuracy), b] as const);
  return (
    <figure style={{ margin: "0.9rem 0 0" }} data-testid="calibration-curve">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="calibration-svg"
        role="img"
        aria-label={`Calibration curve: ${total} answered responses across ${filled.length} confidence bins`}
      >
        {/* gridlines + axis labels */}
        {[0, 0.25, 0.5, 0.75, 1].map((v) => (
          <g key={v}>
            <line x1={sx(0)} y1={sy(v)} x2={sx(1)} y2={sy(v)} stroke="var(--border)" strokeWidth="1" />
            <text x={sx(0) - 6} y={sy(v) + 3} textAnchor="end" fontSize="9" fill="var(--faint)" fontFamily="var(--mono)">
              {Math.round(v * 100)}%
            </text>
            <text x={sx(v)} y={H - PAD.b + 14} textAnchor="middle" fontSize="9" fill="var(--faint)" fontFamily="var(--mono)">
              {Math.round(v * 100)}
            </text>
          </g>
        ))}
        <text x={(sx(0) + sx(1)) / 2} y={H - 4} textAnchor="middle" fontSize="9.5" fill="var(--muted)">
          stated confidence
        </text>
        <text
          x={10} y={(sy(0) + sy(1)) / 2} textAnchor="middle" fontSize="9.5" fill="var(--muted)"
          transform={`rotate(-90 10 ${(sy(0) + sy(1)) / 2})`}
        >
          observed accuracy
        </text>
        {/* perfect-calibration diagonal */}
        <line
          x1={sx(0)} y1={sy(0)} x2={sx(1)} y2={sy(1)}
          stroke="var(--border-strong)" strokeWidth="1" strokeDasharray="4 4"
        />
        {/* observed curve */}
        {pts.length > 1 && (
          <polyline
            points={pts.map(([x, y]) => `${x},${y}`).join(" ")}
            fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinejoin="round"
          />
        )}
        {pts.map(([x, y, b]) => (
          <g key={`${b.lo}-${b.hi}`}>
            <circle cx={x} cy={y} r={3 + Math.min(5, Math.sqrt(b.n))} fill="var(--accent)" fillOpacity="0.28" />
            <circle cx={x} cy={y} r="3" fill="var(--accent)" />
            <title>{`confidence ${b.lo}–${b.hi}: ${b.n} response${b.n === 1 ? "" : "s"}, ${Math.round(b.accuracy * 100)}% correct`}</title>
          </g>
        ))}
      </svg>
      <figcaption className="faint small" style={{ marginTop: "0.2rem" }}>
        Reliability diagram from the {total} answered, persisted T2 response{total === 1 ? "" : "s"} —
        dot size = bin count; the dashed diagonal is perfect calibration. Lapses earn no point here.
      </figcaption>
    </figure>
  );
}
