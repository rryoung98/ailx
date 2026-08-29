"use client";
/**
 * The practice drill — spec §13 "Mastery": a short, UNSCORED training round
 * on the durable artefact families, with immediate right/wrong feedback on
 * every card. It is the repeatable unit a streak can honestly be built on,
 * because a scored sitting is a rare event and practice is not.
 *
 * Two truths this component is careful about.
 *
 * IT SHOWS PRACTICE CONTENT ONLY. Cards come from `@ailx/report`'s practice
 * corpus and nothing else. The scored item bank is not imported here, is not
 * reachable from here, and must never be — a practised item is a dead item.
 *
 * IT ASSERTS NOTHING. In the hosted build the server deals the deck, grades
 * every answer and decides whether the session earned its streak day; this
 * component sends choices and displays what comes back. In the static export
 * there is no server, so the drill still plays (the corpus is bundled) and
 * says plainly that nothing is recorded — the same honesty rule as
 * `footerModeCopy()`.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  FAMILY_META,
  PRACTICE_OPTIONS,
  practiceItem,
  samplePracticeDeck,
  type PracticeItem,
  type ProgressReport,
} from "@ailx/report";
import { DEV_USER_HEADER } from "@ailx/backend";
import { assetUrl, isServerMode } from "./mode";
import { devUser } from "./persistence";
import styles from "./PracticeDrill.module.css";

interface Answered {
  item: PracticeItem;
  choice: number;
  correct: boolean;
  latencyMs: number;
}

type Phase = "loading" | "card" | "feedback" | "done" | "error";

/** Shape of what a submit returns; only the fields this view renders. */
interface SubmitBody {
  result: { answered: number; correct: number; qualification: { counted: boolean; reason: string } };
  progress: ProgressReport;
}

/** Minutes EAST of UTC — the sign convention @ailx/report `localDay` expects. */
function utcOffsetMinutes(): number {
  return -new Date().getTimezoneOffset();
}

export function PracticeDrill() {
  const server = isServerMode();
  const [phase, setPhase] = useState<Phase>("loading");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [deck, setDeck] = useState<PracticeItem[]>([]);
  const [answers, setAnswers] = useState<Answered[]>([]);
  const [outcome, setOutcome] = useState<SubmitBody | null>(null);
  const [error, setError] = useState<string | null>(null);
  const shownAt = useRef<number>(0);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const deal = useCallback(async () => {
    setPhase("loading");
    setAnswers([]);
    setOutcome(null);
    setError(null);
    try {
      // Static export: no server, so the browser seeds its own deck. Hosted:
      // the server deals and RECORDS the deck before any answer is taken.
      let id: string;
      let ids: string[];
      if (server) {
        const res = await fetch(assetUrl("/api/practice"), {
          method: "POST",
          headers: { [DEV_USER_HEADER]: devUser(window.localStorage) },
        });
        if (!res.ok) throw new Error(`could not start practice (${res.status})`);
        const body = (await res.json()) as { session: { id: string; itemIds: string[] } };
        id = body.session.id;
        ids = body.session.itemIds;
      } else {
        id = crypto.randomUUID();
        ids = samplePracticeDeck(id);
      }
      const items = ids.map((itemId) => practiceItem(itemId)).filter((i): i is PracticeItem => i !== null);
      if (items.length === 0) throw new Error("the practice deck came back empty");
      setSessionId(id);
      setDeck(items);
      shownAt.current = Date.now();
      setPhase("card");
    } catch (err) {
      setError(err instanceof Error ? err.message : "practice could not start");
      setPhase("error");
    }
  }, [server]);

  useEffect(() => {
    void deal();
  }, [deal]);

  // Route/phase change moves focus to the new view's heading (FRONTEND.md §5).
  useEffect(() => {
    if (phase === "done") headingRef.current?.focus();
  }, [phase]);

  const index = answers.length;
  const current = deck[index];
  const last = answers[answers.length - 1];

  function answer(choice: number): void {
    if (current === undefined) return;
    setAnswers([
      ...answers,
      {
        item: current,
        choice,
        correct: choice === current.key,
        latencyMs: Math.max(0, Date.now() - shownAt.current),
      },
    ]);
    setPhase("feedback");
  }

  async function next(): Promise<void> {
    if (answers.length < deck.length) {
      shownAt.current = Date.now();
      setPhase("card");
      return;
    }
    setPhase("done");
    if (!server || sessionId === null) return;
    try {
      const res = await fetch(assetUrl(`/api/practice/${sessionId}`), {
        method: "POST",
        headers: { "content-type": "application/json", [DEV_USER_HEADER]: devUser(window.localStorage) },
        body: JSON.stringify({
          tzOffsetMinutes: utcOffsetMinutes(),
          answers: answers.map((a, seq) => ({
            seq,
            itemId: a.item.id,
            choice: a.choice,
            latencyMs: a.latencyMs,
            clientTs: new Date().toISOString(),
          })),
        }),
      });
      if (!res.ok) throw new Error(`the round could not be recorded (${res.status})`);
      setOutcome((await res.json()) as SubmitBody);
    } catch (err) {
      setError(err instanceof Error ? err.message : "the round could not be recorded");
    }
  }

  const correctCount = answers.filter((a) => a.correct).length;

  if (phase === "error") {
    return (
      <div className={styles.stage}>
        <p role="alert">{error}</p>
        <button type="button" className={styles.restart} onClick={() => void deal()}>
          Try again
        </button>
      </div>
    );
  }

  if (phase === "loading") return <p className="muted">Dealing a round…</p>;

  if (phase === "done") {
    const counted = outcome?.result.qualification.counted === true;
    const streak = outcome?.progress.streak;
    return (
      <div className={styles.stage}>
        <h2 ref={headingRef} tabIndex={-1}>
          {correctCount} of {answers.length}
        </h2>
        <p className="muted">
          Practice is not scored and never reaches your result. What it does is give you the
          tell before the clock is running.
        </p>
        {server && streak !== undefined ? (
          <p className={styles.streak}>
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
        ) : null}
        {server && !counted && outcome !== null ? (
          <p className="small faint">
            {outcome.result.qualification.reason === "too_fast"
              ? "That round went too fast to count towards a streak day — the drill only counts if it was actually read."
              : "That round did not finish, so it does not count towards a streak day. Finishing one is all it takes."}
          </p>
        ) : null}
        {server ? null : (
          <p className="small faint">
            This is the static demo build, so nothing was recorded and there is no streak here.
            The hosted build keeps your practice days and works out the streak on the server.
          </p>
        )}
        {error !== null ? (
          <p role="alert" className="small">
            {error}
          </p>
        ) : null}
        <p>
          <button type="button" className={styles.restart} onClick={() => void deal()}>
            Another round
          </button>
        </p>
      </div>
    );
  }

  const showing = phase === "feedback" ? last!.item : current!;
  return (
    <div className={styles.stage}>
      <p className={styles.progress} aria-label={`Card ${index + (phase === "feedback" ? 0 : 1)} of ${deck.length}`}>
        {deck.map((item, i) => (
          <span
            key={item.id}
            aria-hidden
            className={`${styles.pip} ${i < answers.length ? styles.pipDone : i === answers.length ? styles.pipCurrent : ""}`}
          />
        ))}
      </p>
      <p className="eyebrow">
        {FAMILY_META[showing.family].name.toUpperCase()} · {FAMILY_META[showing.family].blurb}
      </p>
      <blockquote className={styles.passage}>{showing.passage}</blockquote>

      {phase === "card" ? (
        <>
          <p className="small faint">
            Does this passage carry a {FAMILY_META[showing.family].name.toLowerCase()}?
          </p>
          <div className={styles.calls}>
            {PRACTICE_OPTIONS.map((label, choice) => (
              <button key={label} type="button" className={styles.call} onClick={() => answer(choice)}>
                {choice === 0 ? "Artefact — something is wrong" : "Clean — nothing is wrong"}
              </button>
            ))}
          </div>
        </>
      ) : (
        <div className={`${styles.feedback} ${last!.correct ? styles.right : styles.wrong}`}>
          {/* Rendered as a live region that is already in the DOM before it
              fills, and it does NOT move focus (FRONTEND.md §5). */}
          <p className={styles.verdict} role="status">
            <span className={last!.correct ? styles.rightText : styles.wrongText}>
              {last!.correct ? "Right." : "Missed it."}
            </span>{" "}
            It was {last!.item.key === 0 ? "an artefact" : "clean"}.
          </p>
          <p className={styles.tell}>{last!.item.tell}</p>
          <p>
            <button type="button" className={styles.restart} onClick={() => void next()}>
              {answers.length < deck.length ? "Next card" : "Finish the round"}
            </button>
          </p>
        </div>
      )}
    </div>
  );
}
