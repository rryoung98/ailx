/**
 * T3's reliance rates, on the report, with their intervals — TEN-35.
 *
 * Presentational only. The rows, the band, the intervals and every sentence
 * come from the pure `relianceReportFromRaw` (@ailx/track-t3), so this file
 * cannot print a rate the derivation did not produce.
 *
 * The rule this card exists to enforce: a reliance rate never appears in
 * front of a candidate without its 95% interval and the band beside it. Eight
 * planted errors put a wide interval on every one of these numbers, and the
 * two-decimal rate on its own reads as a precision the instrument does not
 * have. `apps/web/test/reliance.test.tsx` fails if a rate loses its interval.
 */
import { formatInterval, formatRate, relianceReportFromRaw } from "@ailx/track-t3";

export function RelianceCard({ raw }: { raw: Record<string, number> }) {
  const r = relianceReportFromRaw(raw);
  if (!r) return null;
  return (
    <section
      data-testid="t3-reliance"
      aria-labelledby="reliance-heading"
      style={{ marginTop: "1rem", borderTop: "1px solid var(--border)", paddingTop: "0.8rem" }}
    >
      <h4 id="reliance-heading" style={{ margin: 0, fontSize: "0.9rem" }}>
        Calibrated reliance
      </h4>
      <p className="small muted" style={{ margin: "0.2rem 0 0.6rem" }} data-testid="reliance-band">
        Band: <strong>{r.band}</strong>. The band is read from both tails, never from the index.
        It moves no points.
      </p>
      {r.rows.map((row) => (
        <div
          key={row.key}
          data-reliance-row={row.key}
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(9rem, 1fr) 3.5rem 11rem",
            gap: "0.6rem",
            alignItems: "baseline",
            margin: "0.3rem 0",
          }}
        >
          <span className="small muted">{row.label}</span>
          <span className="small mono" style={{ textAlign: "right" }}>{formatRate(row.point)}</span>
          <span className="small mono faint" data-reliance-interval="">
            {formatInterval(row.interval)}
          </span>
          <span className="faint small" style={{ gridColumn: "1 / -1" }}>{row.detail}</span>
        </div>
      ))}
      {r.underpoweredNote ? (
        <p
          className="small"
          data-testid="reliance-underpowered"
          style={{ margin: "0.6rem 0 0", color: "var(--warn, #b45309)" }}
        >
          {r.underpoweredNote}
        </p>
      ) : null}
      <p className="faint small" style={{ margin: "0.6rem 0 0" }}>{r.precisionNote}</p>
      <p className="faint small" style={{ margin: "0.3rem 0 0" }}>{r.reliabilityNote}</p>
    </section>
  );
}
