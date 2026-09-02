"use client";

/**
 * /world — "how is the world doing at keeping up with AI", answered honestly.
 *
 * A CLIENT component: the page reads the store, but it now does so over HTTP
 * through `apiBase()` (GET /aggregates) instead of importing the handler
 * in-process (docs/ARCHITECTURE.md §10.1). Nothing here is per person, so
 * this is the one converted page that sends NO identity at all.
 *
 * Everything on it is a DISTRIBUTION over stored inputs, and the page says
 * out loud what it is not:
 *
 *  - No percentile, no composite, no judged score. The summit judging
 *    pipeline (spec Phase 4) is not built and `scores` is empty in practice,
 *    so publishing anything score-shaped here would be a claim we cannot back.
 *  - Track values are the run's OWN scorer output as mirrored from the event
 *    log — advisory (FRONTEND.md §4.7), and labeled as such.
 *  - Nothing is per person. Breakdowns appear only above the cohort floor
 *    (@ailx/report MIN_COHORT_SIZE), which the page states rather than hides.
 *  - Item exposure is summarized without item ids: publishing per-item counts
 *    would publish the bank inventory (docs/SHARING.md).
 *  - The cohort is self-selected, and the page says so above the counts
 *    rather than in a footnote (docs/SAMPLING.md §11). The word "population"
 *    is not used about these runs, because that document forbids it.
 */
import Link from "next/link";
import { apiPath } from "@ailx/contract";
import { TRACK_META, type WorldAggregates } from "@ailx/report";
import { TRACK_IDS } from "@ailx/session";
import { PageError, PageLoading } from "./PageNotice";
import { useService } from "./serviceFetch";

const EYEBROW = "PUBLIC AGGREGATES · DISTRIBUTIONS ONLY";

const pct = (n: number): string => `${Math.round(n * 100)}%`;

/**
 * Hand-rolled histogram (no chart library — FRONTEND.md §7).
 *
 * The median decile is marked, because ten equal bars is the one shape a
 * reader cannot get anything out of at a glance. The marker is derived from
 * the median already printed under the chart — it adds a position, never a
 * number.
 */
function Histogram({ buckets, median, label }: { buckets: number[]; median: number; label: string }) {
  const peak = Math.max(1, ...buckets);
  const medianBucket = Math.min(buckets.length - 1, Math.max(0, Math.floor(median / 10)));
  return (
    <div className="histogram" role="img" aria-label={label}>
      {buckets.map((count, i) => (
        <div className={`histogram-col${i === medianBucket ? " median" : ""}`} key={i}>
          <div
            className="histogram-bar"
            style={{ height: `${(count / peak) * 100}%` }}
            title={`${i * 10}–${i * 10 + 10}: ${count} run${count === 1 ? "" : "s"}`}
          />
          <span className="histogram-tick mono">{i * 10}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * The floor, shown as a floor rather than as a shrug.
 *
 * This used to be one line of prose repeated verbatim under three headings,
 * which read as "broken" rather than "not yet". The counts are already public
 * one section up, so drawing the SAME two numbers as a meter invents nothing
 * — it just answers the question the sentence provokes: how far off is it?
 */
function Suppressed({ have, min }: { have: number; min: number }) {
  const share = Math.min(1, min === 0 ? 1 : have / min);
  return (
    <div className="suppressed">
      <p className="meter" role="img" aria-label={`${have} of ${min} complete runs needed`}>
        <span style={{ width: pct(share) }} />
      </p>
      <p className="small">
        <span className="mono">
          {have} of {min}
        </span>{" "}
        complete runs. A breakdown is published only once {min} are behind it, so no chart on
        this page can ever be about one identifiable person.
      </p>
    </div>
  );
}


export function WorldView() {
  const result = useService<{ aggregates: WorldAggregates }>(apiPath("aggregates"));
  if (result.state === "loading") {
    return <PageLoading eyebrow={EYEBROW} title="How is the world doing at keeping up with AI?" />;
  }
  // A non-200 from an UNAUTHENTICATED, always-available aggregate read is not
  // a state this page can describe honestly — it is the same outage as a
  // thrown fetch, and is told the same way rather than drawn as zeroes.
  if (result.state !== "ready") {
    return <PageError eyebrow={EYEBROW} title="How is the world doing at keeping up with AI?" />;
  }
  const a = result.data.aggregates;

  return (
    <main className="page">
      <div className="container">
        <p className="eyebrow">{EYEBROW}</p>
        <h1 style={{ maxWidth: "20ch" }}>How is the world doing at keeping up with AI?</h1>
        <p className="lede">
          Everything below is counted from stored runs and nothing else. There are no
          percentiles, no composites and no judged scores here: the judging pipeline is not
          built, so a number implying one would be a lie. What we can honestly show is who is
          playing, what shapes their runs take, and how much of the instrument has been seen.
        </p>
        <p className="small faint" style={{ maxWidth: "58ch" }}>
          Everyone counted here found AILX and chose to run it. That is a self-selected
          cohort, not a sample of any country, so no figure on this page describes a
          population. The sample that could is a bought probability panel, and it has not
          been fielded yet (<code>docs/SAMPLING.md</code>).
        </p>

        <section aria-labelledby="participation">
          <h2 id="participation">Participation</h2>
          <div className="grid4">
            <p className="stat">
              <span className="value">{a.participation.participants}</span>
              <span className="label">people</span>
            </p>
            <p className="stat">
              <span className="value">{a.participation.attemptsStarted}</span>
              <span className="label">runs started</span>
            </p>
            <p className="stat">
              <span className="value">{a.participation.attemptsFinalized}</span>
              <span className="label">runs finished</span>
            </p>
            <p className="stat">
              <span className="value">
                {a.participation.completionRate === null ? "—" : pct(a.participation.completionRate)}
              </span>
              <span className="label">completion rate</span>
            </p>
          </div>
          <p className="small faint">
            Counts over every stored run, so they name nobody. {a.cohortSize} run
            {a.cohortSize === 1 ? " has" : "s have"} all four tracks scored — that is the cohort
            every distribution below is computed over.
          </p>
        </section>

        <section aria-labelledby="types">
          <h2 id="types">Player types</h2>
          <p className="muted" style={{ maxWidth: "58ch" }}>
            The MBTI-style lens: one axis per track, split at the demo cohort&rsquo;s median. This
            page only holds four aggregate numbers per run, so every type here is that median
            read; a candidate&rsquo;s own card also reads their event log and can land a letter
            away. It is playful either way, and the scored composite never reads it.
          </p>
          {a.playerTypes === null ? (
            <Suppressed have={a.cohortSize} min={a.minCohortSize} />
          ) : (
            <ul className="type-bars">
              {a.playerTypes.map((t) => (
                <li key={t.code}>
                  <span className="mono type-bar-code">{t.code}</span>
                  <span className="meter type-bar-meter">
                    <span style={{ width: pct(t.share) }} />
                  </span>
                  <span className="small">
                    {t.name} <span className="faint mono">{t.count}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="shapes">
          <h2 id="shapes">Track shapes</h2>
          <p className="muted" style={{ maxWidth: "58ch" }}>
            How the four tracks come out, in deciles of their 0&ndash;100 scale. These are the
            run&rsquo;s own scorers over its stored event log — a measurement of the run, not a
            judged result.
          </p>
          {a.tracks === null ? (
            <Suppressed have={a.cohortSize} min={a.minCohortSize} />
          ) : (
            <div className="grid2">
              {a.tracks.map((t) => (
                <div className="card" key={t.track}>
                  <h3>
                    {TRACK_META[t.track].code} · {TRACK_META[t.track].name}
                  </h3>
                  <Histogram
                    buckets={t.buckets}
                    median={t.median}
                    label={`${TRACK_META[t.track].name}: median ${t.median}; ${t.buckets
                      .map((c, i) => `${i * 10} to ${i * 10 + 10}: ${c}`)
                      .join(", ")}`}
                  />
                  <p className="small faint">
                    median <span className="mono">{t.median}</span> · mean{" "}
                    <span className="mono">{t.mean}</span>
                  </p>
                </div>
              ))}
            </div>
          )}
        </section>

        <section aria-labelledby="exposure">
          <h2 id="exposure">Item exposure</h2>
          <p className="muted" style={{ maxWidth: "58ch" }}>
            How much of the instrument has actually been shown, from the per-attempt deck record.
            Which items exist is never published: the bank is the instrument, and naming its
            contents would invalidate every future sitting.
          </p>
          {a.exposure === null ? (
            <Suppressed have={a.cohortSize} min={a.minCohortSize} />
          ) : (
            <div className="grid4">
              <p className="stat">
                <span className="value">{a.exposure.decksRecorded}</span>
                <span className="label">decks dealt</span>
              </p>
              <p className="stat">
                <span className="value">{a.exposure.distinctItems}</span>
                <span className="label">distinct items shown</span>
              </p>
              <p className="stat">
                <span className="value">{a.exposure.meanExposuresPerItem}</span>
                <span className="label">mean showings per item</span>
              </p>
              <p className="stat">
                <span className="value">{a.exposure.maxExposuresPerItem}</span>
                <span className="label">most-shown item</span>
              </p>
            </div>
          )}
        </section>

        <section aria-labelledby="trend">
          <h2 id="trend">Over time</h2>
          {a.trend === null ? (
            <Suppressed have={a.cohortSize} min={a.minCohortSize} />
          ) : (
            <table className="trend-table">
              <caption className="small faint">Runs per week, and how many were finished.</caption>
              <thead>
                <tr>
                  <th scope="col">Week of</th>
                  <th scope="col">Started</th>
                  <th scope="col">Finished</th>
                </tr>
              </thead>
              <tbody>
                {a.trend.map((p) => (
                  <tr key={p.period}>
                    <th scope="row" className="mono">{p.period}</th>
                    <td className="mono">{p.started}</td>
                    <td className="mono">{p.finalized}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <p className="small faint" style={{ maxWidth: "62ch" }}>
          Method, in one paragraph: participation is counted from attempts and participants;
          track shapes are projected from each run&rsquo;s mirrored event log (the same
          projection the report uses), so a run counts only once all four tracks are scored;
          exposure is aggregated inside the database from{" "}
          <span className="mono">attempt_decks</span>, the record of what each attempt was shown.
          Nothing here is derived from an unpublished share, and no row on this page describes
          one person. Tracks:{" "}
          {TRACK_IDS.map((t) => TRACK_META[t].code).join(" · ")}.{" "}
          <Link href="/methodology">How the instrument scores →</Link>
        </p>
      </div>
    </main>
  );
}
