"use client";
import Link from "next/link";
import { useState } from "react";
import { CONSUMER_FOLLOWUPS, consumerResult } from "@ailx/report";
import type { ConsumerAttempt } from "@ailx/session";
import { CharacterPortrait } from "../../components/CharacterPortrait";
import { assetUrl } from "../../lib/mode";
import styles from "./consumer.module.css";

export function ConsumerResult({ attempt, durable, onRetake }: { attempt: ConsumerAttempt; durable: boolean; onRetake: () => void }) {
  const result = consumerResult(attempt);
  const [shareNotice, setShareNotice] = useState("");
  const [exerciseOpen, setExerciseOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [reviewed, setReviewed] = useState(false);
  if (result.kind !== "complete") return null;
  const exercise = CONSUMER_FOLLOWUPS[result.next];
  const profileName = result.profile.name;
  async function copySummary() {
    const url = new URL(assetUrl("/test"), window.location.origin).href;
    const text = `I tried Foray's short AI literacy demo. My profile for this run: ${profileName}. Try the situations yourself: ${url}`;
    try { await navigator.clipboard.writeText(text); setShareNotice("Summary and test link copied. Your answers are not included."); }
    catch { setShareNotice(`Copy this summary to share: ${text}`); }
  }
  return (
    <>
      <section className={styles.resultHero} aria-labelledby="result-title">
        <div>
          <p className="eyebrow">YOUR APPROACH · THIS RUN</p>
          <h1 id="result-title" tabIndex={-1}>{result.profile.name}</h1>
          <p className="lede">{result.profile.line}</p>
          <p className={styles.note}>A snapshot of eight decisions in a public demo, not a certificate or a fixed personality.</p>
        </div>
        <CharacterPortrait code={result.profile.art} size={160} />
      </section>
      <section aria-labelledby="skills-title">
        <h2 id="skills-title">What your decisions showed</h2>
        <div className={styles.skills}>
          {result.metrics.map(skill => (
            <div key={skill.name} className={styles.skill}>
              <h3>{skill.name}</h3>
              <p><strong>{skill.matched} of {skill.total}</strong> decisions matched the brief</p>
              <p className={styles.note}>{skill.matched === skill.total ? "Your choices met the goal in these situations." : "The examples below show what you can revisit."}</p>
            </div>
          ))}
        </div>
        <p className={styles.note}>One or two observations per area cannot establish your overall ability. Recognizing a useful choice is also different from doing the task independently.</p>
      </section>
      <section className={styles.nextActivity} aria-labelledby="followup-title">
        <p className="eyebrow">ONE THING TO TRY NEXT</p>
        <h2 id="followup-title">{exercise.title}</h2>
        <p>{exercise.task}</p>
        {!exerciseOpen ? <button type="button" className="btn primary" onClick={() => setExerciseOpen(true)}>Try a small exercise</button> : (
          <div className={styles.exercise}>
            <label htmlFor="exercise-draft">Your idea</label>
            <textarea id="exercise-draft" value={draft} onChange={event => { setDraft(event.target.value); setReviewed(false); }} rows={4} />
            <p className={styles.note}>A private scratchpad for this page. It is not sent to AI, graded, or saved.</p>
            <button type="button" className="btn" onClick={() => setReviewed(true)}>Compare with an example</button>
            {reviewed && <div role="status"><p><strong>One possible approach</strong></p><p>{exercise.example}</p><p>Compare the goal, the evidence, and the boundary with your own idea.</p></div>}
          </div>
        )}
      </section>
      <section aria-labelledby="evidence-title">
        <h2 id="evidence-title">The decisions behind your profile</h2>
        {result.decisions.map((decision, index) => (
          <details className={styles.review} key={decision.prompt}>
            <summary>{index + 1}. {decision.situation} <span>{decision.matched ? "Matched the brief" : "Worth revisiting"}</span></summary>
            <p><strong>You chose:</strong> {decision.choices.find(choice => choice.id === decision.choice)?.text}</p>
            <p>{decision.explanation}</p>
          </details>
        ))}
      </section>
      <div className={styles.actions}>
        {durable && <Link className="btn primary" href="/me">View my activity</Link>}
        <button type="button" className="btn" onClick={copySummary}>Copy share summary</button>
        <button type="button" className="btn" onClick={onRetake}>Try the demo again</button>
      </div>
      <p role="status" className={styles.note}>{shareNotice}</p>
      <p className={styles.note}>{durable ? "Saved in this browser. Clearing site data removes this history; it does not sync to an account." : "This result is only in this open page and has not been saved."} The demo repeats the same situations, so a later result may reflect remembered answers.</p>
    </>
  );
}
