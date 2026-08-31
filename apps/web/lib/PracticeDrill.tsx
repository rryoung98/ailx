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
import Link from "next/link";
import {
  FAMILY_META,
  PRACTICE_OPTIONS,
  SIGNAL_CHOICE,
  practiceItem,
  samplePracticeDeck,
  type PracticeItem,
  type ProgressReport,
} from "@ailx/report";
import { authHeaders } from "./authHeaders";
import { apiBase, assetUrl, isServerMode } from "./mode";

import styles from "./PracticeDrill.module.css";

/**
 * One card the round has finished with.
 *
 * `result` is null when the card was DROPPED: its picture never reached the
 * browser, so there was nothing to look at and nothing was called. A dropped
 * card is not graded, not counted in the tally and not submitted — a network
 * failure must never be recorded as a wrong answer against a candidate.
 */
interface Played {
  item: PracticeItem;
  result: { choice: number; correct: boolean; latencyMs: number; clientTs: string } | null;
}

type Phase = "loading" | "card" | "feedback" | "done" | "error";

/** Whether the current card's picture has arrived. */
type Stimulus = "pending" | "shown" | "failed";

/**
 * Failure copy lives here, once, because the raw exception must never reach
 * the page: a browser that cannot reach the network throws a TypeError whose
 * message is the literal string "Failed to fetch", and printing that at a
 * candidate explains nothing and offers nothing.
 */
const DEAL_FAILED =
  "We could not deal a round just now. That is usually the connection between you and us, not anything you did.";
const SUBMIT_FAILED =
  "Your round could not be sent, so it is not recorded yet. The round below is exactly as you played it — nothing was lost, and practice is unscored either way.";
const STIMULUS_FAILED =
  "This picture did not load, so there is nothing to call. It has not been counted for or against you.";

/** Shape of what a submit returns; only the fields this view renders. */
interface SubmitBody {
  result: { answered: number; correct: number; qualification: { counted: boolean; reason: string } };
  progress: ProgressReport;
}

/**
 * The round so far, as a row of pips — one per card, coloured by outcome the
 * moment a card is answered. It is decoration on purpose: the same two facts
 * (which card, how many right) are in the visible line beside it, so colour
 * is never the only cue and a screen reader is not asked to read a bar chart
 * built out of empty spans.
 */
function Pips({ deck, played }: { deck: readonly PracticeItem[]; played: readonly Played[] }) {
  return (
    <span className={styles.pips} aria-hidden>
      {deck.map((item, i) => {
        const done = played[i];
        const state =
          done === undefined
            ? i === played.length
              ? styles.pipCurrent
              : ""
            : done.result === null
              ? styles.pipDropped
              : done.result.correct
                ? styles.pipRight
                : styles.pipWrong;
        return <span key={item.id} className={`${styles.pip} ${state}`} />;
      })}
    </span>
  );
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
  const [played, setPlayed] = useState<Played[]>([]);
  const [outcome, setOutcome] = useState<SubmitBody | null>(null);
  // The last streak the SERVER told us about. Deliberately NOT cleared by a
  // new round: if a submit fails, the panel a candidate was looking at must
  // survive the failure rather than disappear with it.
  const [streak, setStreak] = useState<ProgressReport["streak"] | null>(null);
  const [submitFailed, setSubmitFailed] = useState(false);
  const [sending, setSending] = useState(false);
  const [stimulus, setStimulus] = useState<Stimulus>("pending");
  // Bumped to remount the <img>, which is what actually re-requests a picture
  // whose first fetch failed.
  const [reload, setReload] = useState(0);
  const shownAt = useRef<number>(0);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  // Set when a control that had focus is about to be unmounted, so focus
  // lands on the next card's first control instead of on <body>.
  const [recoverFocus, setRecoverFocus] = useState(false);

  const deal = useCallback(async () => {
    setPhase("loading");
    setPlayed([]);
    setOutcome(null);
    setSubmitFailed(false);
    setStimulus("pending");
    try {
      // Static export: no server, so the browser seeds its own deck. Hosted:
      // the server deals and RECORDS the deck before any answer is taken.
      let id: string;
      let ids: string[];
      if (server) {
        const res = await fetch(`${apiBase()}/practice`, {
          method: "POST",
          headers: await authHeaders(window.localStorage),
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
    } catch {
      // The exception itself is never shown: offline, this is a TypeError
      // reading "Failed to fetch", which is browser plumbing, not copy.
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

  // A control that had focus was unmounted (a dropped card, a retried
  // picture); put focus on the first control of what replaced it.
  useEffect(() => {
    if (!recoverFocus) return;
    stageRef.current?.querySelector("button")?.focus();
    setRecoverFocus(false);
  }, [recoverFocus]);

  const index = played.length;
  const current = deck[index];
  const last = played[played.length - 1];
  const graded = played.filter((p) => p.result !== null);
  const dropped = played.length - graded.length;
  const correctCount = graded.filter((p) => p.result!.correct).length;

  /** Show the next card (or finish), from a clean stimulus state. */
  function advance(after: Played[]): void {
    setPlayed(after);
    setStimulus("pending");
    if (after.length < deck.length) {
      shownAt.current = Date.now();
      setPhase("card");
    } else {
      setPhase("done");
      void submit(after);
    }
  }

  function answer(choice: number): void {
    if (current === undefined || stimulus === "failed") return;
    setPlayed([
      ...played,
      {
        item: current,
        result: {
          choice,
          correct: choice === current.key,
          latencyMs: Math.max(0, Date.now() - shownAt.current),
          // Stamped when the call was made, not when the round was sent, so a
          // retry after a failed send re-sends the same round rather than a
          // round that appears to have happened later.
          clientTs: new Date().toISOString(),
        },
      },
    ]);
    setPhase("feedback");
  }

  /** Give up on a card whose picture never arrived. It is never graded. */
  function drop(): void {
    if (current === undefined) return;
    setRecoverFocus(true);
    advance([...played, { item: current, result: null }]);
  }

  /** Ask the browser for the same picture again. */
  function retryStimulus(): void {
    setStimulus("pending");
    setReload((n) => n + 1);
    setRecoverFocus(true);
    shownAt.current = Date.now();
  }

  async function submit(round: readonly Played[]): Promise<void> {
    if (!server || sessionId === null) return;
    setSending(true);
    try {
      const res = await fetch(`${apiBase()}/practice/${sessionId}`, {
        method: "POST",
        headers: { "content-type": "application/json", ...(await authHeaders(window.localStorage)) },
        body: JSON.stringify({
          tzOffsetMinutes: utcOffsetMinutes(),
          // Dropped cards are omitted entirely: the server grades what it is
          // sent, so an unseen picture must not arrive as an answer.
          answers: round
            .filter((p): p is Played & { result: NonNullable<Played["result"]> } => p.result !== null)
            .map((p, seq) => ({
              seq,
              itemId: p.item.id,
              choice: p.result.choice,
              latencyMs: p.result.latencyMs,
              clientTs: p.result.clientTs,
            })),
        }),
      });
      if (!res.ok) throw new Error(`the round could not be recorded (${res.status})`);
      const body = (await res.json()) as SubmitBody;
      setOutcome(body);
      setStreak(body.progress.streak);
      setSubmitFailed(false);
    } catch {
      // Same rule as the deal: the exception is plumbing, the page gets copy.
      setSubmitFailed(true);
    } finally {
      setSending(false);
    }
  }

  function next(): void {
    advance(played);
  }

  if (phase === "error") {
    return (
      <div className={styles.stage}>
        <p role="alert">{DEAL_FAILED}</p>
        <button type="button" className={styles.restart} onClick={() => void deal()}>
          Try again
        </button>
      </div>
    );
  }

  if (phase === "loading") return <p className="muted">Dealing a round…</p>;

  if (phase === "done") {
    const counted = outcome?.result.qualification.counted === true;
    return (
      <div ref={stageRef} className={styles.stage}>
        <h2 ref={headingRef} tabIndex={-1} className={styles.tally}>
          {correctCount} of {graded.length}
        </h2>
        {/* The shape of the round, so the number is not the only thing you
            leave with: which cards you called right, in the order you saw
            them. */}
        <p className={styles.progress}>
          <Pips deck={deck} played={played} />
          <span className={styles.count}>
            {correctCount} right, {graded.length - correctCount} missed
          </span>
        </p>
        {dropped > 0 ? (
          <p className="small faint">
            {dropped === 1 ? "One card" : `${dropped} cards`} never loaded, so{" "}
            {dropped === 1 ? "it is" : "they are"} not in that count. A picture that did not
            arrive is not a call you got wrong.
          </p>
        ) : null}
        <p className="muted">
          Practice is not scored and never reaches your result. What it does is give you the
          tell before the clock is running.
        </p>
        {server && streak !== null ? (
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
        {server && submitFailed && streak !== null ? (
          <p className="small faint">
            That streak is what your last recorded round left. This round is not in it yet.
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
        {submitFailed ? (
          // The round above is still on screen: a failed send must not cost a
          // candidate the thing they just did.
          <div role="alert" className={styles.trouble}>
            <p>{SUBMIT_FAILED}</p>
            <button
              type="button"
              className={styles.restart}
              disabled={sending}
              onClick={() => void submit(played)}
            >
              {sending ? "Sending…" : "Try sending it again"}
            </button>
          </div>
        ) : null}
        <p className={styles.after}>
          <button type="button" className={styles.restart} onClick={() => void deal()}>
            Another round
          </button>
          {/* The end of a round is where somebody actually wants to see the
              trend, so the link is here and not only at the foot of the page.
              The static export has no /progress, so it is server-only. */}
          {server ? <Link href="/progress">See your progress →</Link> : null}
        </p>
      </div>
    );
  }

  const showing = phase === "feedback" ? last!.item : current!;
  const broken = phase === "card" && stimulus === "failed";
  return (
    <div ref={stageRef} className={styles.stage}>
      <p className={styles.progress}>
        <Pips deck={deck} played={played} />
        {/* Visible text, not an aria-label: an `aria-label` on a <p> is not
            reliably exposed, so the old markup announced nothing at all. */}
        <span className={styles.count}>
          Card {index + (phase === "feedback" ? 0 : 1)} of {deck.length}
          {graded.length > 0 ? ` · ${correctCount} right so far` : ""}
        </span>
      </p>
      {/* The family is deliberately NOT shown before the call. Naming it up
          front would prime the answer, and the call under test is T2's own:
          photograph or generated? The family belongs to the teaching, so it
          appears with the tell. */}
      <figure className={styles.plate}>
        {/* eslint-disable-next-line @next/next/no-img-element -- a static
            export cannot use the Image optimiser, and the corpus assets are
            already budgeted and content-addressed. */}
        {broken ? (
          // The picture is gone, so the plate holds its space and nothing
          // else: a half-drawn <img> with a broken-icon is not a stimulus.
          <div className={`${styles.image} ${styles.plateEmpty}`} aria-hidden />
        ) : (
          <img
            // Remounting on `reload` is what makes "try loading it again"
            // actually re-request the file.
            key={`${showing.id}:${reload}`}
            className={styles.image}
            src={assetUrl(`/${showing.material.src}`)}
            alt={showing.material.alt}
            width={800}
            height={600}
            // A picture can also "load" with no pixels in it (a truncated or
            // empty response), which reads as naturalWidth 0. Either way the
            // card is unanswerable, never wrong.
            onLoad={(e) => setStimulus(e.currentTarget.naturalWidth > 0 ? "shown" : "failed")}
            onError={() => setStimulus("failed")}
          />
        )}
        {/* Attribution is a licence condition, but it is shown AFTER the call,
            never before it. The credit line names the author, and a Commons
            author is often called "midjourney" or "Gemini"; on an image we
            generated it would name the model outright. Either way a candidate
            could read the answer off the caption instead of the picture, and
            hiding it on generated items only would make a MISSING caption the
            giveaway. So every card is uncaptioned until it is answered, and
            every credit then appears in full — with docs/CREDITS.md carrying
            the same attribution outside the app. The prompt is deliberately
            never rendered: it names the artefact. */}
        {phase === "feedback" ? (
          <figcaption className={styles.credit}>
            {showing.credit.origin === "generated" ? (
              <>
                {showing.credit.author} · {showing.credit.model} · {showing.credit.license} ·
                generated {showing.credit.retrieved}
              </>
            ) : (
              <>
                <a href={showing.credit.source_url} rel="noopener noreferrer" target="_blank">
                  {showing.credit.commons_title?.replace(/^File:/, "")}
                </a>{" "}
                · {showing.credit.author} · {showing.credit.license} · via Wikimedia Commons
              </>
            )}
          </figcaption>
        ) : null}
      </figure>

      {broken ? (
        // No calls at all while the card is unanswerable. Offering them and
        // grading the guess would record a network failure as a miss.
        <div role="status" className={styles.trouble}>
          <p>{STIMULUS_FAILED}</p>
          <div className={styles.calls}>
            <button type="button" className={styles.call} onClick={retryStimulus}>
              Try loading it again
            </button>
            <button type="button" className={styles.call} onClick={drop}>
              Skip this card
            </button>
          </div>
        </div>
      ) : phase === "card" ? (
        <>
          <p className="small faint">Is this a photograph, or an AI-generated image?</p>
          <div className={styles.calls}>
            {PRACTICE_OPTIONS.map((label, choice) => (
              <button key={label} type="button" className={styles.call} onClick={() => answer(choice)}>
                {label}
              </button>
            ))}
          </div>
        </>
      ) : (
        <div className={`${styles.feedback} ${last!.result!.correct ? styles.right : styles.wrong}`}>
          {/* Rendered as a live region that is already in the DOM before it
              fills, and it does NOT move focus (FRONTEND.md §5). */}
          <p className={styles.verdict} role="status">
            <span className={last!.result!.correct ? styles.rightText : styles.wrongText}>
              {last!.result!.correct ? "Right." : "Missed it."}
            </span>{" "}
            {/* Not `PRACTICE_OPTIONS[key].toLowerCase()`: that rendered the
                sentence "It was ai-generated." SIGNAL_CHOICE is the
                load-bearing index (@ailx/report), so the prose hangs off it
                rather than off the button label's spelling. */}
            It was {last!.item.key === SIGNAL_CHOICE ? "an AI-generated image" : "a real photograph"}.
          </p>
          <p className="eyebrow">{FAMILY_META[last!.item.family].name.toUpperCase()}</p>
          <p className={styles.tell}>{last!.item.tell}</p>
          <p>
            <button type="button" className={styles.restart} onClick={next}>
              {played.length < deck.length ? "Next card" : "Finish the round"}
            </button>
          </p>
        </div>
      )}
    </div>
  );
}
