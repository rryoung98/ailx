"use client";
/**
 * THE DAILY CHALLENGE — five calls, one minute, the same five for everyone.
 *
 * The rules it has to hold are stated where they are decided (`@ailx/report`'s
 * daily module: the day, the deck, the grid, the streak). What is decided
 * HERE is only how a person plays it, and three of those decisions are load-
 * bearing enough to write down.
 *
 * THE DAY COMES FROM THE DEVICE, SO THE FIRST RENDER CANNOT HAVE ONE. The
 * puzzle rolls over at the player's own local midnight, which means the deck
 * depends on `Date.now()` and on the browser's timezone — neither of which
 * exists when this page is prerendered into the static export. So the server
 * tree is a neutral shell and the deck is chosen in an effect after mount;
 * rendering a "today" during SSR would hydrate a different tree than the one
 * that was exported, and on the first day after a deploy it would be the
 * WRONG day.
 *
 * IT NEEDS NO ACCOUNT AND NO NETWORK. State is `features/daily/dailyState.ts`, which is
 * localStorage; nothing here reads an identity, and the round plays offline.
 *
 * IT IS NOT A SITTING. No answer here reaches `score()`, a report figure or a
 * credential — the same separation practice has (spec §13), said out loud on
 * the page rather than only in a comment.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  DAILY_PITCH,
  DAILY_STREAK_MEANING,
  dailyDay,
  dailyDeck,
  dailyGrid,
  dailyNumber,
  dailyStreak,
  dailyTallyLine,
  gradeDailyCard,
  type DailyCard,
  type DailyLedger,
  type DailyResult,
  type DailyRound,
} from "@ailx/report";
import { DAILY_POOL } from "../../lib/demoItems";
import { readDailyLedger, recordDailyRoundLocally } from "./dailyState";
import { funnel } from "../../lib/funnel";
import { assetUrl, basePath } from "../../lib/mode";
import { ShareTargets } from "../../components/ShareTargets";
import styles from "../practice/PracticeDrill.module.css";

/** Minutes EAST of UTC — the sign convention `dailyDay` expects. */
function utcOffsetMinutes(): number {
  return -new Date().getTimezoneOffset();
}

/** A card whose picture never arrived is skipped, never counted as a miss. */
const STIMULUS_FAILED =
  "This picture did not load, so there is nothing to call. It has not been counted for or against you.";

interface Today {
  day: string;
  number: number;
  deck: DailyCard[];
  ledger: DailyLedger;
}

/** The grid, as a row a screen reader can read as words rather than squares. */
function Grid({ results }: { results: readonly DailyResult[] }) {
  const line = dailyTallyLine(results);
  return (
    <p className={styles.progress}>
      <span aria-hidden style={{ fontSize: "1.6rem", letterSpacing: "0.1em" }}>
        {dailyGrid(results)}
      </span>
      <span className={styles.count}>{line}</span>
    </p>
  );
}

export function DailyChallenge() {
  const [today, setToday] = useState<Today | null>(null);
  const [answers, setAnswers] = useState<Array<number | null>>([]);
  const [showing, setShowing] = useState<"card" | "feedback">("card");
  const [stimulusFailed, setStimulusFailed] = useState(false);
  const [reload, setReload] = useState(0);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [justFinished, setJustFinished] = useState(false);

  // Mount: the device tells us the day, and the day tells us the deck.
  useEffect(() => {
    const day = dailyDay(Date.now(), utcOffsetMinutes());
    setToday({
      day,
      number: dailyNumber(day),
      deck: dailyDeck(day, DAILY_POOL),
      ledger: readDailyLedger(window.localStorage),
    });
  }, []);

  // The round ending replaces the whole view, so focus moves to the new
  // view's heading rather than being dropped on <body> (FRONTEND.md §5).
  useEffect(() => {
    if (!justFinished) return;
    headingRef.current?.focus();
    setJustFinished(false);
  }, [justFinished]);

  const finish = useCallback((round: DailyRound, deckSize: number) => {
    setJustFinished(true);
    funnel().playCompleted("daily", round.results.length);
    setToday((prev) =>
      prev === null
        ? prev
        : { ...prev, ledger: recordDailyRoundLocally(window.localStorage, round, deckSize) },
    );
  }, []);

  if (today === null) return <p className="muted">Dealing today&rsquo;s cards&hellip;</p>;

  const { day, number, deck, ledger } = today;
  const playedToday = ledger.last !== null && ledger.last.day === day;
  const index = answers.length;
  const current = deck[index];
  // The last card still gets its feedback: the round is over only once the
  // player has left that screen, which is what `showing` says.
  const done = playedToday || (current === undefined && showing === "card");

  const results: DailyResult[] = playedToday
    ? ledger.last!.results
    : deck.slice(0, answers.length).map((card, i) => gradeDailyCard(card, answers[i]));

  function commit(next: Array<number | null>) {
    setAnswers(next);
    setStimulusFailed(false);
    setShowing("card");
    if (next.length < deck.length) return;
    const graded = deck.map((card, i) => gradeDailyCard(card, next[i]));
    finish({ day, number, results: graded }, deck.length);
  }

  function call(choice: number | null) {
    if (current === undefined) return;
    // "Play started" is the first card called, the same rule the practice
    // drill uses: a dealt deck nobody touched is not a play (docs/KPI.md).
    if (answers.length === 0) funnel().playStarted("daily");
    setAnswers([...answers, choice]);
    setShowing("feedback");
  }

  if (done) {
    const streak = dailyStreak(ledger.days, day);
    return (
      <div className={styles.stage}>
        <h2 ref={headingRef} tabIndex={-1} className={styles.tally}>
          AILX Daily #{number}
        </h2>
        <Grid results={results} />
        {streak.current > 1 ? (
          <p className={styles.streak}>
            <span className="stat">
              <span className="value">{streak.current}</span>
              <span className="label">days in a row</span>
            </span>
            <span className="stat">
              <span className="value">{streak.best}</span>
              <span className="label">your best</span>
            </span>
            <span className="stat">
              <span className="value">{streak.totalDays}</span>
              <span className="label">days played</span>
            </span>
          </p>
        ) : null}
        <p className="muted" style={{ maxWidth: "58ch" }}>
          {DAILY_STREAK_MEANING}
        </p>
        {/* The grid is the share. It carries hits, misses and the day's
            number — never which card was which, so posting it cannot spoil
            the day for anybody who has not played (docs/SHARING.md §8). */}
        <DailyShareRow number={number} results={results} streak={streak.current} />
        <p className="small faint" style={{ maxWidth: "58ch" }}>
          The next five arrive at your own midnight. Your streak is kept on this device only —
          clearing your browser data clears it, and there is no account to lose it to.{" "}
          <Link href="/practice">Practise the tells →</Link>
        </p>
      </div>
    );
  }

  const card = showing === "feedback" ? deck[index - 1] : current;
  const called = showing === "feedback" ? answers[index - 1] : null;

  return (
    <div className={styles.stage}>
      <p className={styles.progress}>
        <span aria-hidden style={{ fontSize: "1.2rem", letterSpacing: "0.08em" }}>
          {dailyGrid(results)}
        </span>
        <span className={styles.count}>
          Card {showing === "feedback" ? index : index + 1} of {deck.length} · daily #{number}
        </span>
      </p>

      <figure className={styles.plate} style={{ margin: 0 }}>
        <figcaption className="muted" style={{ marginBottom: "0.6rem" }}>
          {card.stem}
        </figcaption>
        {card.material.kind === "image" ? (
          // eslint-disable-next-line @next/next/no-img-element -- a static
          // export has no image optimiser, and these are bundled assets.
          <img
            key={`${card.id}:${reload}`}
            src={assetUrl(`/${card.material.src}`)}
            alt={card.material.alt}
            onError={() => setStimulusFailed(true)}
            style={{ maxWidth: "100%", borderRadius: "0.5rem" }}
          />
        ) : (
          <blockquote style={{ margin: 0 }}>
            {card.material.title === undefined ? null : <strong>{card.material.title}. </strong>}
            {card.material.text}
          </blockquote>
        )}
      </figure>

      {showing === "card" ? (
        stimulusFailed ? (
          <div role="alert">
            <p>{STIMULUS_FAILED}</p>
            <button
              type="button"
              className="btn small-btn"
              onClick={() => {
                // Clear the failure and remount the <img>, which is what
                // actually re-requests it. `onError` fires again if it fails.
                setStimulusFailed(false);
                setReload((n) => n + 1);
              }}
            >
              Try loading it again
            </button>{" "}
            <button type="button" className="btn small-btn" onClick={() => commit([...answers, null])}>
              Skip this card
            </button>
          </div>
        ) : (
          <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap" }}>
            {card.options.map((label, choice) => (
              <button
                key={label}
                type="button"
                className="btn primary"
                onClick={() => call(choice)}
              >
                {label}
              </button>
            ))}
          </div>
        )
      ) : (
        <div>
          <p role="status">
            <strong>{called === card.key ? "Called it." : "Missed."}</strong> {card.tell}
          </p>
          {card.credit === null ? null : (
            <p className="small faint">
              {card.credit.author} · {card.credit.license}
              {card.credit.sourceUrl === undefined ? null : (
                <>
                  {" · "}
                  <a href={card.credit.sourceUrl} rel="noreferrer noopener" target="_blank">
                    source
                  </a>
                </>
              )}
            </p>
          )}
          <button type="button" className="btn primary" onClick={() => commit(answers)}>
            {answers.length === deck.length ? "See today\u2019s result" : "Next card"}
          </button>
        </div>
      )}

      <p className="small faint" style={{ maxWidth: "58ch" }}>
        {DAILY_PITCH} Nothing here is scored: the daily is played on published practice material
        and reaches no AILX result.
      </p>
    </div>
  );
}

/**
 * The share row. It is its own component only so the daily result — the
 * number, the grid and the streak, and nothing else — is the whole of what
 * gets handed to the share machinery.
 */
function DailyShareRow({
  number,
  results,
  streak,
}: {
  number: number;
  results: readonly DailyResult[];
  streak: number;
}) {
  // The absolute URL of this page, built the same way the credential and
  // share panels build theirs. Empty during SSR, and this row only ever
  // renders after mount.
  const url = `${typeof window === "undefined" ? "" : window.location.origin}${basePath()}/daily`;
  return <ShareTargets url={url} daily={{ number, results, streak }} />;
}
