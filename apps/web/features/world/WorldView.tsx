"use client";

/**
 * /world — "how is the world doing at keeping up with AI", answered honestly.
 *
 * A CLIENT component: the page reads the store, but it now does so over HTTP
 * through `apiBase()` (GET /aggregates) instead of importing the handler
 * in-process (docs/ARCHITECTURE.md §10.1).
 *
 * Nothing here is per person, so it asks with `identity: "optional"`: the id
 * this browser already has, never a minted one.
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
import { API_RESPONSE_SCHEMAS, apiPath } from "@ailx/contract";
import { TRACK_META, type WorldAggregates } from "@ailx/report";
import { TRACK_IDS } from "@ailx/session";
import { PageError, PageLoading } from "../../components/PageNotice";
import { serviceRefusedCopy, useService } from "../../lib/data/serviceFetch";

const EYEBROW = "FORAY COMMUNITY · GROUP RESULTS";
const TITLE = "How are people doing on Foray?";

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
        complete runs. To protect privacy, breakdowns stay hidden until at least {min} runs
        have all four tracks scored. These charts show groups, not individual results.
      </p>
    </div>
  );
}


export function WorldView() {
  // PUBLIC read, and it used to send NOTHING at all — which is how a page
  // meant for a visitor with no account got a 401 on staging while every
  // identified page worked (TEN-107). The seam's own test only checks that a
  // module does not reach PAST it; whether a given page asks for an identity
  // was a per-call-site boolean nothing looked at. `"optional"` sends the id
  // this browser already has and mints none.
  const result = useService<{ aggregates: WorldAggregates }>(apiPath("aggregates"), {
    identity: "optional",
    // VALIDATED: every figure on this page is read out of the body during
    // render, so an unknown shape was a TypeError, not a sentence (TEN-216).
    schema: API_RESPONSE_SCHEMAS.aggregates,
  });
  if (result.state === "loading") {
    return <PageLoading eyebrow={EYEBROW} title={TITLE} />;
  }
  // Three different failures, three different sentences. "We could not reach
  // the service" for a 401 is false — it was reached, and it said no.
  if (result.state === "error") {
    return <PageError eyebrow={EYEBROW} title={TITLE} message={result.message} />;
  }
  if (result.state === "missing") {
    return (
      <PageError
        eyebrow={EYEBROW}
        title={TITLE}
        message={serviceRefusedCopy(result.status, result.reason)}
      />
    );
  }
  const a = result.data.aggregates;

  return (
    <main className="page">
      <div className="container">
        <p className="eyebrow">{EYEBROW}</p>
        <h1 style={{ maxWidth: "20ch" }}>{TITLE}</h1>
        <p className="lede">
          See how people take part in Foray, a test of practical AI skills. These summaries
          use saved runs. There are no percentiles, no composites and no judged scores here.
          The judging system is not built yet.
        </p>
        <p className="small faint" style={{ maxWidth: "58ch" }}>
          Everyone here chose to try Foray. This is a self-selected group, or cohort, not a
          sample of any country. These results do not describe a country or the wider
          population. A separate study with randomly selected participants has not run yet.
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
          {a.participation.attemptsStarted === 0 ? (
            /* EMPTY IS NOT BROKEN, and it is not a refusal either. Three
               different facts, three different sentences (TEN-107). */
            <p className="muted" style={{ maxWidth: "52ch" }} aria-live="polite">
              Nobody has started a run yet. These counts are zero, not missing.
            </p>
          ) : null}
          <p className="small faint">
            These totals cover all saved runs and show no names. {a.cohortSize} run
            {a.cohortSize === 1 ? " has" : "s have"} all four tracks scored. The breakdowns below
            use those runs.
          </p>
        </section>

        <section aria-labelledby="types">
          <h2 id="types">Player types</h2>
          <p className="muted" style={{ maxWidth: "58ch" }}>
            Player types are for fun and do not affect your overall score. Here, each type uses
            four track results, compared with the middle result in the demo group. Your own
            card also uses details from your run, so its letters may differ.
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
          <h2 id="shapes">Track results</h2>
          <p className="muted" style={{ maxWidth: "58ch" }}>
            Each chart groups track results into 10-point bands on a 0 to 100 scale. These are
            calculated from each run&rsquo;s saved activity, not judged scores. They are
            provisional, not official results. Median means the middle result; mean means the
            average.
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
          <h2 id="exposure">Questions shown</h2>
          <p className="muted" style={{ maxWidth: "58ch" }}>
            How often questions have been shown, based on the question sets recorded for each
            run. We show counts, not question names or IDs, to keep test content private.
          </p>
          {a.exposure === null ? (
            <Suppressed have={a.cohortSize} min={a.minCohortSize} />
          ) : (
            <div className="grid4">
              <p className="stat">
                <span className="value">{a.exposure.decksRecorded}</span>
                <span className="label">question sets dealt</span>
              </p>
              <p className="stat">
                <span className="value">{a.exposure.distinctItems}</span>
                <span className="label">different questions shown</span>
              </p>
              <p className="stat">
                <span className="value">{a.exposure.meanExposuresPerItem}</span>
                <span className="label">average times shown per question</span>
              </p>
              <p className="stat">
                <span className="value">{a.exposure.maxExposuresPerItem}</span>
                <span className="label">times the most-used question was shown</span>
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
          About these counts. Participation totals use saved people and runs. Track results
          use the same saved activity as the report and include only runs with all four tracks
          scored. Question counts use the saved question sets. This page does not reveal private
          share reports or individual results. Tracks:{" "}
          {TRACK_IDS.map((t) => TRACK_META[t].code).join(" · ")}.{" "}
          <Link href="/methodology">How scoring works →</Link>
        </p>
      </div>
    </main>
  );
}
