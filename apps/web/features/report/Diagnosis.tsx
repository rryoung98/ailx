/**
 * The diagnosis section of the report: what you are good at, what to fix, and
 * the next thing to actually do about it.
 *
 * Presentational only. Every sentence, every ordering rule and the honesty
 * qualifier come from the pure `diagnose` (@ailx/report), so this file cannot
 * invent a claim and the wording is tested without a DOM.
 *
 * TONE: warm, unlike /verify (docs/UX-DIRECTION.md). Diagnosis is the
 * playful, coachy surface; the credential is the serious one.
 */
import Link from "next/link";
import { diagnose, type ShareProcess } from "@ailx/report";
import type { TrackRawScores } from "@ailx/session";

export function Diagnosis({
  trackRaw,
  process = null,
}: {
  trackRaw: TrackRawScores;
  process?: ShareProcess | null;
}) {
  const d = diagnose({ trackRaw, process });
  return (
    <section className="card" aria-labelledby="diagnosis-heading" style={{ marginBottom: "2rem" }}>
      <p className="eyebrow" style={{ margin: 0 }}>diagnosis · what to do next</p>
      <h2 id="diagnosis-heading" style={{ margin: "0.2rem 0 0" }}>Where you actually are</h2>
      <p className="diagnosis-summary">{d.summary}</p>

      <ul className="diagnosis-findings">
        {d.findings.map((f) => (
          <li key={f.track} className={f.level === "watch" ? "diagnosis-watch" : "diagnosis-strength"}>
            <span className="mono">{f.code}</span>
            <span>
              {f.headline}{" "}
              <span className="faint small">
                {f.name} · {f.value.toFixed(1)}
              </span>
            </span>
            <span className="small verdict">{f.level === "watch" ? "to work on" : "strong"}</span>
          </li>
        ))}
      </ul>

      {d.process.length > 0 ? (
        <>
          <h3 style={{ margin: "1.4rem 0 0.2rem" }}>How you worked</h3>
          <ul className="share-points">
            {d.process.map((n) => (
              <li key={n.headline}>
                <span>
                  <strong>{n.headline}.</strong> {n.detail}
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      <h3 style={{ margin: "1.4rem 0 0.2rem" }}>Do this next</h3>
      <ul className="diagnosis-actions">
        {d.actions.map((a) => (
          <li key={a.track} className={`diagnosis-action${a.drill ? " drill" : ""}`}>
            <Link className="btn small-btn" href={a.href} style={{ justifySelf: "start" }}>
              {a.label} →
            </Link>
            <span className="small muted">{a.detail}</span>
          </li>
        ))}
      </ul>

      <p className="faint small" style={{ margin: "1rem 0 0" }}>{d.basis}</p>
    </section>
  );
}
