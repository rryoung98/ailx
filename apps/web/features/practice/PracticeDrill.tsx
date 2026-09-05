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
 * IT ASSERTS NOTHING TO A SERVER. When the round is recorded on an account,
 * the server deals the deck, grades every answer and decides whether the
 * session earned its streak day; this component sends choices and displays
 * what comes back.
 *
 * IT PLAYS WITHOUT AN ACCOUNT. A visitor who has never signed in — and the
 * whole static export, which has no server at all — still gets a round and
 * still keeps a streak, in their own browser (`lib/data/localPractice.ts`, and
 * `@ailx/report`'s `localPractice.ts` for why it lives there). The page says
 * exactly where those days are kept and what ends them, and the ask to sign
 * in arrives after the round, naming what an account is for. Nothing here
 * ever tells anybody they are about to lose something.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { apiPath } from "@ailx/contract";
import {
  CLAIM_PROMISE,
  FAMILY_META,
  LOCAL_PRACTICE_BASIS,
  PRACTICE_OPTIONS,
  SIGNAL_CHOICE,
  SIGN_IN_VALUE_SHORT,
  practiceItem,
  samplePracticeDeck,
  type PracticeItem,
  type PracticeQualification,
  type ProgressReport,
  type StreakSummary,
} from "@ailx/report";
import { serviceHeaders } from "../../lib/data/traceparent";
import { useIdentity } from "../../lib/auth/identityState";
import { funnel } from "../../lib/data/funnel";
import {
  localStreakSummary,
  readLastClaim,
  recordLocalPracticeRound,
  subscribeLocalPractice,
  utcOffsetMinutes,
  type ClaimOutcome,
} from "../../lib/data/localPractice";
import { apiBase, assetUrl, isClerkEnabled, isServerMode } from "../../lib/mode";

import styles from "../../components/PracticeDrill.module.css";

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
  "We could not deal a round. That is usually the connection, not anything you did.";
const SUBMIT_FAILED =
  "Your round was not sent, so it is not recorded yet. Nothing was lost: the round below is exactly as you played it, and practice is unscored either way.";
const STIMULUS_FAILED =
  "This picture did not load, so there is nothing to call. It has not been counted for or against you.";

/** Shape of what a submit returns; only the fields this view renders. */
interface SubmitBody {
  result: { answered: number; correct: number; qualification: PracticeQualification };
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

export function PracticeDrill() {
  const server = isServerMode();
  const identity = useIdentity();
  /**
   * Where this round goes. An account records it on the server, which is what
   * makes the deck server-dealt and the day server-stamped; anybody else
   * keeps it in their own browser and keeps a streak all the same.
   *
   * `pending` is neither: Clerk has not answered yet, and dealing a local
   * round in the meantime would quietly drop a signed-in person's day.
   */
  const recorded = server && identity.status === "signed-in";
  const waitingOnIdentity = server && identity.status === "pending";
  const [phase, setPhase] = useState<Phase>("loading");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [deck, setDeck] = useState<PracticeItem[]>([]);
  const [played, setPlayed] = useState<Played[]>([]);
  // The last streak we know about — the server's when the round was recorded
  // on an account, this browser's own otherwise. Deliberately NOT cleared by
  // a new round: if a submit fails, the panel a candidate was looking at must
  // survive the failure rather than disappear with it.
  const [streak, setStreak] = useState<StreakSummary | null>(null);
  /**
   * Whether the round earned a streak day, and why not when it did not. ONE
   * piece of state for both paths, because it is one product rule
   * (`qualifiesForStreak`) applied to the same two numbers — the server
   * measures the elapsed time it stamped, this browser measures its own.
   */
  const [qualification, setQualification] = useState<PracticeQualification | null>(null);
  /** What the sign-in claim did, if it happened while this page was open. */
  const [claim, setClaim] = useState<ClaimOutcome | null>(null);
  const [submitFailed, setSubmitFailed] = useState(false);
  const [sending, setSending] = useState(false);
  const [stimulus, setStimulus] = useState<Stimulus>("pending");
  // Bumped to remount the <img>, which is what actually re-requests a picture
  // whose first fetch failed.
  const [reload, setReload] = useState(0);
  const shownAt = useRef<number>(0);
  /** When the round was dealt — what this browser measures its elapsed time from. */
  const roundStartedAt = useRef<number>(0);
  /**
   * How the round ON SCREEN was dealt, which is not always how the next one
   * will be: signing in on another tab flips the identity under a round
   * already in progress. The round finishes the way it started — a
   * server-dealt session is submitted to the server, a browser-dealt one is
   * kept here — because a client-side session id means nothing to the server
   * and a server session id means nothing to this browser.
   */
  const roundRecorded = useRef(false);
  /** True once a card has been called: an unfinished round is never re-dealt. */
  const roundBegun = useRef(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  // Set when a control that had focus is about to be unmounted, so focus
  // lands on the next card's first control instead of on <body>.
  const [recoverFocus, setRecoverFocus] = useState(false);

  const deal = useCallback(async () => {
    setPhase("loading");
    setPlayed([]);
    setQualification(null);
    setSubmitFailed(false);
    setStimulus("pending");
    try {
      // No account (and the whole static export): the browser seeds its own
      // deck from the bundled corpus. On an account: the server deals and
      // RECORDS the deck before any answer is taken, which is what stops a
      // client walking the corpus.
      let id: string;
      let ids: string[];
      if (recorded) {
        const res = await fetch(`${apiBase()}${apiPath("startPractice")}`, {
          method: "POST",
          headers: await serviceHeaders(window.localStorage),
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
      roundRecorded.current = recorded;
      roundBegun.current = false;
      setDeck(items);
      shownAt.current = Date.now();
      roundStartedAt.current = shownAt.current;
      setPhase("card");
    } catch {
      // The exception itself is never shown: offline, this is a TypeError
      // reading "Failed to fetch", which is browser plumbing, not copy.
      setPhase("error");
    }
  }, [recorded]);

  useEffect(() => {
    // Deal nothing while Clerk is still answering: a round dealt now would be
    // dealt against the wrong answer to "is anybody signed in?".
    if (waitingOnIdentity) return;
    // An identity that arrives mid-round (a sign-in in another tab) does not
    // take the round away and deal a new one. It finishes as it started, and
    // the NEXT round is the one that goes to the account.
    if (roundBegun.current) return;
    void deal();
  }, [deal, waitingOnIdentity]);

  /**
   * The streak this BROWSER holds, kept in step with the ledger. It is read
   * on mount (a returning visitor sees their streak before they play), after
   * every local round, and after a sign-in claim moves the days to an
   * account — the claim is what makes the stale-panel case real.
   */
  useEffect(() => {
    const refresh = () => {
      setClaim(readLastClaim());
      if (recorded) return;
      setStreak(localStreakSummary(window.localStorage, Date.now(), utcOffsetMinutes()));
    };
    refresh();
    return subscribeLocalPractice(refresh);
  }, [recorded]);

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
      // "Play completed" is the last card being called, not the submit
      // landing: a round played offline is a completed round.
      funnel().playCompleted("practice", after.filter((p) => p.result !== null).length);
      void submit(after);
    }
  }

  function answer(choice: number): void {
    if (current === undefined || stimulus === "failed") return;
    // "Play started" is the first CARD CALLED, not the deck being dealt: this
    // drill is embedded in the landing hero, so a dealt deck would count a
    // play for everyone who scrolled past it (docs/KPI.md). A reload mid-play
    // resumes the same play, so the step is not counted twice.
    if (!roundBegun.current) funnel().playStarted("practice");
    roundBegun.current = true;
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

  /**
   * Keep a finished round in this browser's own ledger.
   *
   * The qualification rule is the shared one, applied to an elapsed time this
   * browser measured. That is the browser's own word, which is exactly what a
   * local day is — it buys the streak on this screen and nothing else, and it
   * is labelled as self-reported the moment it reaches an account.
   */
  function recordLocally(round: readonly Played[]): void {
    const graded = round.filter((p) => p.result !== null);
    const answered = graded.length;
    const correct = graded.filter((p) => p.result!.correct).length;
    const now = Date.now();
    const { qualification: earned } = recordLocalPracticeRound(window.localStorage, {
      answered,
      correct,
      elapsedMs: Math.max(0, now - roundStartedAt.current),
      now,
      tzOffsetMinutes: utcOffsetMinutes(),
    });
    setQualification(earned);
    setStreak(localStreakSummary(window.localStorage, now, utcOffsetMinutes()));
  }

  async function submit(round: readonly Played[]): Promise<void> {
    if (!roundRecorded.current || sessionId === null) {
      recordLocally(round);
      return;
    }
    setSending(true);
    try {
      const res = await fetch(`${apiBase()}${apiPath("submitPractice", { id: sessionId })}`, {
        method: "POST",
        headers: { "content-type": "application/json", ...(await serviceHeaders(window.localStorage)) },
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
      setStreak(body.progress.streak);
      setQualification(body.result.qualification);
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
          Practice is not scored and never reaches your result. It gives you the tell before the
          clock is running.
        </p>
        {streak !== null ? (
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
        {recorded && submitFailed && streak !== null ? (
          <p className="small faint">
            That streak is what your last recorded round left. This round is not in it yet.
          </p>
        ) : null}
        {qualification !== null && !qualification.counted ? (
          <p className="small faint">
            {qualification.reason === "too_fast"
              ? "That round went too fast to count towards a streak day. The drill counts only if it was read."
              : "That round did not finish, so it does not count towards a streak day. Finish one and it does."}
          </p>
        ) : null}
        {/* Where the days are, said plainly, on the screen that shows them.
            A streak nobody explained is a streak somebody can lose without
            ever being told how. */}
        {recorded ? null : <p className="small faint">{LOCAL_PRACTICE_BASIS}</p>}
        {/* The ask, and only here: after a round, never in front of one. It
            names what an account is for and what happens to these days, and
            it is absent from the static export, which has no sign-in page to
            send anybody to. */}
        {!recorded && isClerkEnabled() ? (
          <p className="small faint">
            {SIGN_IN_VALUE_SHORT} {CLAIM_PROMISE}{" "}
            <Link href="/sign-in">Sign in</Link>
          </p>
        ) : null}
        {/* The receipt for the claim, so a person who just signed in can SEE
            that their days came with them. */}
        {claim?.ok && claim.claimed.length > 0 ? (
          <p className="small faint" role="status">
            {claim.claimed.length === 1
              ? "The practice day this browser was holding is now on your account."
              : `The ${claim.claimed.length} practice days this browser was holding are now on your account.`}
          </p>
        ) : null}
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
