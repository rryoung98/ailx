import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { handleProgress } from "@ailx/backend";
import {
  MIN_TREND_DAYS,
  REST_WINDOW_DAYS,
  TRACK_META,
  PRACTICE_MIN_ANSWERS,
  type PracticeDayPoint,
  type ProgressReport,
  type SittingPoint,
} from "@ailx/report";
import { TRACK_IDS, type TrackId } from "@ailx/session";
import { withApiContext } from "../../lib/server/api";
import styles from "./progress.module.css";

/**
 * /progress — one person's trajectory, and nothing they did not do.
 *
 * Server-only (`page.api.tsx`): it reads the store, so in the static export
 * this page does not exist at all rather than shipping a route that cannot
 * work. The same page-twin rule as /gallery, /world and /review.
 *
 * The honesty rules, which are the reason this page is short:
 *  - The STREAK is recomputed here from server-stamped practice sessions on
 *    every render. Nothing stores a counter, and no client can assert one.
 *  - PRACTICE ACCURACY is the server's own grading of practice answers.
 *  - SITTINGS are each run's OWN scorer output, projected from its stored
 *    event log — advisory (FRONTEND.md §4.7), and said so on the page. The
 *    judging pipeline is not built and `scores` is empty, so there is no
 *    percentile, no composite and no cohort comparison anywhere here.
 *  - A figure with too little behind it says so instead of drawing a zero.
 *
 * Charts are hand-rolled SVG (FRONTEND.md §7: no chart library).
 */

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "AILX — your progress",
  description: "Your practice streak, your accuracy over time, and what actually changed between sittings.",
  robots: { index: false, follow: false },
};

/** One colour per track, from the token palette — no new hexes. */
const TRACK_STROKE: Readonly<Record<TrackId, string>> = {
  t1: "var(--accent)",
  t2: "var(--merit)",
  t3: "var(--pass)",
  t4: "var(--distinction)",
};

const VIEW = { w: 640, h: 180, padX: 34, padY: 18 };

function x(i: number, n: number): number {
  return n <= 1 ? VIEW.padX : VIEW.padX + (i / (n - 1)) * (VIEW.w - VIEW.padX * 2);
}

/** value is 0-1; y is inverted so 100% is at the top. */
function y(value: number): number {
  return VIEW.padY + (1 - value) * (VIEW.h - VIEW.padY * 2);
}

const points = (values: readonly number[]): string =>
  values.map((v, i) => `${x(i, values.length).toFixed(1)},${y(v).toFixed(1)}`).join(" ");

/** Shared chart chrome: a 0/50/100 grid and its labels. */
function Grid() {
  return (
    <>
      {[0, 0.5, 1].map((v) => (
        <g key={v}>
          <line className={styles.sparkGrid} x1={VIEW.padX} x2={VIEW.w - VIEW.padX} y1={y(v)} y2={y(v)} />
          <text className={styles.sparkLabel} x={4} y={y(v) + 3}>
            {v * 100}
          </text>
        </g>
      ))}
      <line className={styles.sparkAxis} x1={VIEW.padX} x2={VIEW.padX} y1={y(1)} y2={y(0)} />
    </>
  );
}

function AccuracyChart({ days }: { days: readonly PracticeDayPoint[] }) {
  const scored = days.filter((d): d is PracticeDayPoint & { accuracy: number } => d.accuracy !== null);
  const label = scored
    .map((d) => `${d.day}: ${Math.round(d.accuracy * 100)} per cent over ${d.answered} cards`)
    .join("; ");
  return (
    <svg
      className={styles.spark}
      viewBox={`0 0 ${VIEW.w} ${VIEW.h}`}
      role="img"
      aria-label={`Practice accuracy per day. ${label}`}
    >
      <Grid />
      <polyline className={styles.sparkLine} points={points(scored.map((d) => d.accuracy))} />
      {scored.map((d, i) => (
        <circle key={d.day} className={styles.sparkDot} cx={x(i, scored.length)} cy={y(d.accuracy)} r={3} />
      ))}
      <text className={styles.sparkLabel} x={VIEW.padX} y={VIEW.h - 2}>
        {scored[0]?.day}
      </text>
      <text className={styles.sparkLabel} x={VIEW.w - VIEW.padX} y={VIEW.h - 2} textAnchor="end">
        {scored[scored.length - 1]?.day}
      </text>
    </svg>
  );
}

function SittingsChart({ sittings }: { sittings: readonly SittingPoint[] }) {
  const label = TRACK_IDS.map(
    (t) =>
      `${TRACK_META[t].name}: ${sittings.map((s) => `${s.startedOn} ${Math.round(s.scores[t])}`).join(", ")}`,
  ).join("; ");
  return (
    <>
      <svg
        className={styles.spark}
        viewBox={`0 0 ${VIEW.w} ${VIEW.h}`}
        role="img"
        aria-label={`Each track across your sittings, oldest first. ${label}`}
      >
        <Grid />
        {TRACK_IDS.map((track) => (
          <g key={track}>
            <polyline
              className={styles.sittingLine}
              stroke={TRACK_STROKE[track]}
              points={points(sittings.map((s) => s.scores[track] / 100))}
            />
            {sittings.map((s, i) => (
              <circle
                key={s.attemptId}
                className={styles.sittingDot}
                fill={TRACK_STROKE[track]}
                cx={x(i, sittings.length)}
                cy={y(s.scores[track] / 100)}
                r={3}
              />
            ))}
          </g>
        ))}
      </svg>
      <ul className={styles.legend}>
        {TRACK_IDS.map((track) => (
          <li className={styles.legendItem} key={track}>
            <span className={styles.swatch} style={{ background: TRACK_STROKE[track] }} aria-hidden />
            {TRACK_META[track].code} · {TRACK_META[track].name}
          </li>
        ))}
      </ul>
    </>
  );
}

function Streak({ streak }: { streak: ProgressReport["streak"] }) {
  return (
    <>
      <p className={styles.streakRow}>
        <span className="stat">
          <span className="value">{streak.current}</span>
          <span className="label">day streak</span>
        </span>
        <span className="stat">
          <span className="value">{streak.best}</span>
          <span className="label">your best</span>
        </span>
        <span className="stat">
          <span className="value">{streak.totalDays}</span>
          <span className="label">days practised</span>
        </span>
      </p>
      <p className="muted" style={{ maxWidth: "58ch" }}>
        {streak.current === 0 && streak.best > 0
          ? `Your streak has lapsed. Your best run of ${streak.best} day${streak.best === 1 ? "" : "s"} stands — a break costs the run, never the record. One round starts a new one.`
          : streak.practisedToday
            ? "Today is in."
            : streak.current > 0
              ? "Today is still open, so the streak is still yours. One round keeps it."
              : "Nothing yet. One finished round is a day."}
      </p>
      <p className="small faint" style={{ maxWidth: "62ch" }}>
        A day counts when you finish a whole round of {PRACTICE_MIN_ANSWERS} cards, in your own
        local day, at a speed that means you read them. A streak survives one missed day, and can
        do that again once {REST_WINDOW_DAYS} days have passed — it is meant to reward a habit,
        not punish a life.{" "}
        {streak.restDayAvailable ? "You have a rest day in hand right now." : null}
      </p>
    </>
  );
}

export default async function ProgressPage() {
  const h = await headers();
  const headerMap: Record<string, string> = {};
  h.forEach((value, key) => {
    headerMap[key.toLowerCase()] = value;
  });

  const result = await withApiContext((ctx) => handleProgress(ctx, headerMap));
  if (result.status !== 200) {
    return (
      <main className="page">
        <div className="container">
          <p className="eyebrow">YOUR PROGRESS</p>
          <h1 style={{ maxWidth: "20ch" }}>We do not know who you are.</h1>
          <p className="lede">
            This page is one person&rsquo;s own history, so it is shown only to the person whose
            history it is. Sign in and come back, or{" "}
            <Link href="/practice">play a round of practice</Link> — the drill itself works
            either way.
          </p>
        </div>
      </main>
    );
  }
  const progress = result.body.progress as ProgressReport;
  const scoredDays = progress.practice.filter((d) => d.accuracy !== null);

  return (
    <main className="page">
      <div className="container">
        <p className="eyebrow">YOUR PROGRESS · DERIVED FROM WHAT YOU DID</p>
        <h1 style={{ maxWidth: "20ch" }}>Are you actually getting better?</h1>
        <p className="lede">
          The honest answer is on this page and nowhere else on the site: your own practice, your
          own sittings, and the difference between them. Nothing here compares you to anybody.
        </p>

        <section aria-labelledby="streak">
          <h2 id="streak">Streak</h2>
          <Streak streak={progress.streak} />
          <p>
            <Link href="/practice">Practise now →</Link>
          </p>
        </section>

        <section aria-labelledby="accuracy">
          <h2 id="accuracy">Practice accuracy</h2>
          {progress.notEnoughYet.practice || scoredDays.length < MIN_TREND_DAYS ? (
            <p className="muted" style={{ maxWidth: "58ch" }}>
              Not enough yet. A trend line needs at least {MIN_TREND_DAYS} days of practice behind
              it; drawing one over {scoredDays.length} would be decoration, not a measurement.
            </p>
          ) : (
            <>
              <AccuracyChart days={scoredDays} />
              <table className="trend-table">
                <caption className="small faint">
                  Every practice day, as the server graded it.
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Day</th>
                    <th scope="col">Rounds</th>
                    <th scope="col">Cards</th>
                    <th scope="col">Right</th>
                  </tr>
                </thead>
                <tbody>
                  {scoredDays.map((d) => (
                    <tr key={d.day}>
                      <th scope="row" className="mono">{d.day}</th>
                      <td className="mono">{d.sessions}</td>
                      <td className="mono">{d.answered}</td>
                      <td className="mono">{Math.round((d.accuracy ?? 0) * 100)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
          {progress.practiceAccuracy === null ? null : (
            <p className="muted" style={{ maxWidth: "58ch" }}>
              Over your first {Math.round(progress.practiceAccuracy.answered / 2)} cards you were
              right {progress.practiceAccuracy.early}% of the time; over the most recent half,{" "}
              {progress.practiceAccuracy.recent}%.
            </p>
          )}
        </section>

        <section aria-labelledby="sittings">
          <h2 id="sittings">Your sittings</h2>
          {progress.notEnoughYet.sittings ? (
            <p className="muted" style={{ maxWidth: "58ch" }}>
              {progress.sittings.length === 0
                ? "You have no completed run yet. One full sitting of all four tracks puts a shape here."
                : "One sitting so far. A second one gives this page something to compare it with."}
            </p>
          ) : (
            <SittingsChart sittings={progress.sittings} />
          )}
          <p className="small faint" style={{ maxWidth: "62ch" }}>
            These are each run&rsquo;s own scorers over its stored event log — a measurement of
            the run, not a judged result, and not comparable to anyone else&rsquo;s.
          </p>
        </section>

        <section aria-labelledby="moved">
          <h2 id="moved">What moved</h2>
          {progress.improvements.length === 0 ? (
            <p className="muted" style={{ maxWidth: "58ch" }}>
              Nothing has moved enough to report. That is a real answer, and a better one than a
              number invented to fill the space.
            </p>
          ) : (
            <ul className={styles.moves}>
              {progress.improvements.map((imp) => (
                <li className={styles.move} key={imp.subject}>
                  <span>{imp.label}</span>
                  <span className={imp.delta > 0 ? styles.up : styles.down}>
                    {imp.delta > 0 ? "+" : ""}
                    {imp.delta}
                  </span>
                  <span className="small faint mono">
                    {imp.from} → {imp.to}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <p className="small faint" style={{ maxWidth: "62ch" }}>
          {progress.basis} <Link href="/methodology">How the instrument scores →</Link>
        </p>
      </div>
    </main>
  );
}
