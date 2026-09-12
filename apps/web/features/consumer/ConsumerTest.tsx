"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CONSUMER_QUESTIONS, CONSUMER_SKILLS } from "@ailx/report";
import { appendConsumerResponse, consumerComplete, startConsumerAttempt, type ConsumerChoice } from "@ailx/session";
import { ConsumerResult } from "./ConsumerResult";
import { useConsumerHistory } from "./useConsumerHistory";
import styles from "./consumer.module.css";

export function ConsumerTest() {
  const { state, update } = useConsumerHistory();
  const router = useRouter();
  const params = useSearchParams();
  const [selected, setSelected] = useState<{ phase: string; choice: ConsumerChoice } | null>(null);
  const [notice, setNotice] = useState("");
  const region = useRef<HTMLDivElement>(null);
  const requested = params.get("attempt");
  const attempts = state.kind === "ready" ? state.attempts : [];
  const attempt = requested ? attempts.find(a => a.id === requested)
    : [...attempts].reverse().find(a => !consumerComplete(a));
  const attemptId = attempt?.id;
  useEffect(() => {
    if (attemptId && !requested) router.replace(`/test?attempt=${encodeURIComponent(attemptId)}`);
  }, [attemptId, requested, router]);
  const index = attempt?.responses.length ?? 0;
  const phase = state.kind === "loading" ? "loading" : attempt ? `${attempt.id}:${index}` : "intro";
  const selection = selected?.phase === phase ? selected.choice : null;
  const previous = useRef(phase);
  useEffect(() => {
    if (previous.current !== phase) {
      setNotice("");
      region.current?.querySelector<HTMLElement>("h1")?.focus();
      previous.current = phase;
    }
  }, [phase]);

  function start() {
    const next = startConsumerAttempt(crypto.randomUUID(), Date.now());
    if (update(history => [...history, next])) router.replace(`/test?attempt=${encodeURIComponent(next.id)}`);
  }
  function answer() {
    if (!attempt || selection === null) { setNotice("Choose an option before continuing."); return; }
    update(history => {
      const current = history.find(a => a.id === attempt.id);
      if (!current) throw new Error("This saved test is no longer available.");
      const next = appendConsumerResponse(current, index, selection);
      return history.map(a => a.id === next.id ? next : a);
    });
  }
  const question = CONSUMER_QUESTIONS[index];
  return (
    <main className={`page ${styles.page}`}>
      <div className="container" ref={region}>
        {state.kind === "loading" ? <p role="status">Opening your test…</p> : <>
          {state.notice && <p className={styles.warning} role="alert">{state.notice}</p>}
          {requested && !attempt ? <section><h1 tabIndex={-1}>This test is not in this browser.</h1><p>Local results do not travel with a copied address. You can start your own test or return to your activity.</p><div className={styles.actions}><button type="button" className="btn primary" onClick={start}>Start my test</button><Link href="/me">My activity</Link></div></section>
          : !attempt ? <section className={styles.intro}>
            <p className="eyebrow">AI LITERACY TEST · PUBLIC DEMO</p>
            <h1 tabIndex={-1}>How do you work with AI?</h1>
            <p className="lede">Eight decisions. Discover how you guide, check, and improve AI’s work.</p>
            <div className={styles.brief}><h2>Your mission</h2><p>Help an AI assistant prepare an invitation for a community repair afternoon.</p></div>
            <p>About 4–5 minutes · No timer · No account</p>
            <button type="button" className="btn primary" onClick={start}>Let's find out →</button>
            <p className={styles.note}>Scenario demo. Your profile and explanations come at the end.</p>
            {attempts.length > 0 && <Link href="/me">See my previous results</Link>}
          </section> : consumerComplete(attempt) ? <ConsumerResult key={attempt.id} attempt={attempt} durable={state.durable} onRetake={start} /> : question && <>
            <div className={styles.testTop}><span>Decision {index + 1} of {CONSUMER_QUESTIONS.length}</span><Link href="/me">{state.durable ? "Save & exit" : "Exit (not saved)"}</Link></div>
            <progress className={styles.progress} aria-label="Test progress" value={index} max={CONSUMER_QUESTIONS.length} />
            <ol className={styles.stages} aria-label="Test situations">{CONSUMER_SKILLS.map(skill => <li key={skill.id} aria-current={question.skill === skill.id ? "step" : undefined}>{skill.verb}</li>)}</ol>
            <h1 className={styles.questionTitle} tabIndex={-1}>{question.situation}</h1>
            <div className={styles.workspace}>
              <aside className={styles.source} aria-label={question.sourceTitle}>
                <p className="eyebrow">{question.sourceTitle}</p>
                <ul>{question.source.map(line => <li key={line}>{line}</li>)}</ul>
              </aside>
              <div className={styles.assistant}><p className="eyebrow">ASSISTANT · SCENARIO</p><p>{question.assistant}</p></div>
            </div>
            <fieldset key={phase} className={styles.choices}>
              <legend>{question.prompt}</legend>
              {question.choices.map(choice => <label className={styles.choice} key={choice.id}>
                <input type="radio" name={`decision-${index}`} value={choice.id} checked={selection === choice.id} onChange={() => { setSelected({ phase, choice: choice.id }); setNotice(""); }} />
                <span>{choice.text}</span>
              </label>)}
            </fieldset>
            <p role="status" className={styles.note}>{notice}</p>
            <div className={styles.actions}><button type="button" className="btn primary" onClick={answer}>{index === CONSUMER_QUESTIONS.length - 1 ? "See my profile →" : "Continue →"}</button><span className={styles.note}>Your choice is recorded when you continue.</span></div>
          </>}
        </>}
      </div>
    </main>
  );
}
