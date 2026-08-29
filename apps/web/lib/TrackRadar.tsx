/**
 * Four-track radar — hand-rolled SVG (no chart library, FRONTEND.md §7).
 *
 * ONE definition: the report renders it for the candidate and the share view
 * renders it for whoever they sent the link to. It is a plain function of its
 * props (no hooks, no browser API), so it is safe in a server component too.
 */
import { TRACK_IDS } from "@ailx/session";

export function TrackRadar({
  values,
  label = "Track score radar",
  size = 260,
}: {
  values: Record<(typeof TRACK_IDS)[number], number>;
  label?: string;
  size?: number;
}) {
  const C = 110, R = 82;
  const at = (i: number, r: number): [number, number] => {
    const a = (Math.PI * 2 * i) / 4 - Math.PI / 2;
    return [C + r * Math.cos(a), C + r * Math.sin(a)];
  };
  const pts = TRACK_IDS.map((t, i) => at(i, (Math.max(0, Math.min(100, values[t])) / 100) * R));
  const ring = (f: number) => TRACK_IDS.map((_, i) => at(i, R * f).join(",")).join(" ");
  return (
    <svg viewBox="0 0 220 220" style={{ width: "100%", maxWidth: size }} role="img" aria-label={label}>
      {[0.25, 0.5, 0.75, 1].map((f) => (
        <polygon key={f} points={ring(f)} fill="none" stroke="var(--border)" strokeWidth="1" />
      ))}
      {TRACK_IDS.map((t, i) => {
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
  );
}
