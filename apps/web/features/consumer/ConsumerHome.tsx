"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { consumerComplete } from "@ailx/session";
import { consumerResult } from "@ailx/report";
import { useConsumerHistory } from "./useConsumerHistory";
import { CharacterPortrait } from "../../components/CharacterPortrait";
import styles from "./consumer.module.css";

const METRIC_COLORS = ["#2563a6", "#7846a6", "#a83267", "#a65c13", "#237c63", "#18788c"];
function point(index: number, fraction: number) {
  const angle = index * Math.PI / 3 - Math.PI / 2;
  const radius = 18 + 72 * fraction;
  return `${200 + Math.cos(angle)*radius},${160 + Math.sin(angle)*radius}`;
}

function useAnimatedMetrics(values: number[]) {
  const signature = values.join(",");
  const displayed = useRef<number[]>([]);
  const [frame, setFrame] = useState<number[]>([]);
  useEffect(() => {
    const target = signature ? signature.split(",").map(Number) : [];
    const commit = (next: number[]) => { displayed.current = next; setFrame(next); };
    if (displayed.current.length !== target.length || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches || typeof requestAnimationFrame !== "function") {
      commit(target);
      return;
    }
    const from = displayed.current;
    let started: number | undefined;
    let request: number;
    const tick = (time: number) => {
      started ??= time;
      const progress = Math.min(1, (time - started) / 650);
      const eased = progress * progress * (3 - 2 * progress);
      commit(target.map((value, index) => from[index] + (value - from[index]) * eased));
      if (progress < 1) request = requestAnimationFrame(tick);
    };
    request = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(request);
  }, [signature]);
  return frame.length === values.length ? frame : values;
}

export function ConsumerHome() {
  const { state } = useConsumerHistory();
  const [selectedId, setSelectedId] = useState("");
  const [playing, setPlaying] = useState(false);
  const completed = state.kind === "ready" ? state.attempts.filter(consumerComplete) : [];
  const selected = completed.find(attempt => attempt.id === selectedId) ?? completed[completed.length - 1];
  const selectedIndex = selected ? completed.indexOf(selected) : -1;
  const previous = selectedIndex > 0 ? consumerResult(completed[selectedIndex - 1]) : null;
  const current = selected ? consumerResult(selected) : null;
  const animated = useAnimatedMetrics(current?.kind === "complete" ? current.metrics.map(metric => metric.matched / metric.total) : []);
  const nextId = completed[selectedIndex + 1]?.id;
  useEffect(() => {
    if (!playing) return;
    if (!nextId) { setPlaying(false); return; }
    const timer = window.setTimeout(() => setSelectedId(nextId), 1200);
    return () => window.clearTimeout(timer);
  }, [playing, nextId]);
  return <main className={`page ${styles.page}`}><div className="container">
    <p className="eyebrow">MY ACTIVITY · THIS BROWSER</p><h1>Your AI profile.</h1>
    {state.kind === "loading" ? <p role="status">Opening your activity…</p> : <>
      {state.notice && <p role="alert" className={styles.warning}>{state.notice}</p>}
      <p className="lede">See your strengths. Pick your next challenge.</p>
      {completed.length > 0 && <section className={styles.historyControls} aria-label="Profile history">
        <label htmlFor="profile-run">Your timeline</label>
        <div className={styles.timeline}>
          <button type="button" className="btn" disabled={completed.length < 2} onClick={() => {
            if (playing) { setPlaying(false); return; }
            if (!nextId) setSelectedId(completed[0].id);
            setPlaying(true);
          }}>{playing ? "Pause" : "Play history"}</button>
          <input id="profile-run" type="range" min="0" max={Math.max(0, completed.length-1)} step="1" value={Math.max(0, selectedIndex)} disabled={completed.length < 2}
            aria-valuetext={`Run ${selectedIndex+1} of ${completed.length}, ${selected ? new Date(selected.startedAt).toLocaleString() : ""}`}
            onInput={event => { setPlaying(false); setSelectedId(completed[Number(event.currentTarget.value)].id); }} />
          <output htmlFor="profile-run">Run {selectedIndex+1} of {completed.length}</output>
        </div>
        <p className={styles.note}>{selected && new Date(selected.startedAt).toLocaleString()}</p>
        <p className={styles.note}>{previous?.kind === "complete" ? "Drag the timeline or play your history." : "Your first snapshot. Take another run to compare."}</p>
      </section>}
      {state.attempts.length === 0 ? <div className={styles.brief}><h2>Meet your AI working style.</h2><p>Start with eight decisions and get a personal profile backed by the choices you made.</p><Link className="btn primary" href="/test">Take the short test →</Link></div> :
        [...state.attempts].reverse().filter(attempt => !consumerComplete(attempt) || attempt.id === selected?.id).map(attempt => {
          const result = consumerResult(attempt);
          return <article className={`${styles.historyCard} ${result.kind === "complete" ? styles.statCard : ""}`} key={result.kind === "complete" ? "selected-profile" : attempt.id}>
            {result.kind === "complete" && <CharacterPortrait code={result.profile.art} size={144} />}
            <div><p className="eyebrow">{consumerComplete(attempt) ? "FINISHED" : "READY TO CONTINUE"} · {new Date(attempt.startedAt).toLocaleDateString()}</p>
              <h2>{result.kind === "complete" ? result.profile.name : `${attempt.responses.length} of 8 decisions saved`}</h2>
              <Link href={`/test?attempt=${encodeURIComponent(attempt.id)}`}>{result.kind === "complete" ? "Open my result →" : "Continue my test →"}</Link>
            </div>
            {result.kind === "complete" && <figure className={styles.statFigure}>
              <svg viewBox="0 0 400 320" role="img" aria-label={result.metrics.map(metric => `${metric.name}: ${metric.matched} of ${metric.total}`).join(", ")}>
                {[1, 0.6, 0.2].map(scale => <polygon key={scale} points={result.metrics.map((_, index) => {
                  const angle = index * Math.PI / 3 - Math.PI / 2;
                  return `${200 + Math.cos(angle)*90*scale},${160 + Math.sin(angle)*90*scale}`;
                }).join(" ")} className={scale === 1 ? styles.statFrame : styles.statGrid} />)}
                {result.metrics.map((metric, index) => {
                  const angle = index * Math.PI / 3 - Math.PI / 2;
                  return <line key={metric.name} x1="200" y1="160" x2={200+Math.cos(angle)*90} y2={160+Math.sin(angle)*90} className={styles.statGrid} />;
                })}
                {result.metrics.map((metric, index) => {
                  return <polygon key={metric.name} points={`200,160 ${point(index, animated[index])} ${point((index+1)%6, animated[(index+1)%6])}`} fill={METRIC_COLORS[index]} fillOpacity="0.3" />;
                })}
                <polygon points={animated.map((value,index)=>point(index,value)).join(" ")} fill="none" stroke="var(--fg)" strokeWidth="2" />
                {result.metrics.map((metric,index) => <circle key={metric.name} cx={Number(point(index,animated[index]).split(",")[0])} cy={Number(point(index,animated[index]).split(",")[1])} r="4" fill={METRIC_COLORS[index]} />)}
                <circle cx="200" cy="160" r="3" className={styles.statCenter} />
                {result.metrics.map((metric, index) => {
                  const positions = [[200,45],[390,108],[390,220],[200,285],[10,220],[10,108]];
                  return <text style={{ fill: METRIC_COLORS[index] }} key={metric.name} x={positions[index][0]} y={positions[index][1]} textAnchor={index === 0 || index === 3 ? "middle" : index < 3 ? "end" : "start"}>{metric.name.toUpperCase()} · {metric.matched}/{metric.total}</text>;
                })}
              </svg>
              <figcaption>Inner ring = zero · Outer ring = all matched</figcaption>
            </figure>}
          </article>;
        })}
      {current?.kind === "complete" && <section aria-labelledby="over-time">
        <h2 id="over-time">Your profile over time</h2>
        <table className={styles.metricHistory}>
          <thead><tr><th scope="col">Metric</th><th scope="col">Selected run</th><th scope="col">Previous run</th></tr></thead>
          <tbody>{current.metrics.map((metric,index) => <tr key={metric.name}>
            <th scope="row"><span aria-hidden="true" style={{ background: METRIC_COLORS[index] }} />{metric.name}</th>
            <td>{metric.matched}/{metric.total}</td>
            <td>{previous?.kind === "complete" ? `${previous.metrics[index].matched}/${previous.metrics[index].total}` : "—"}</td>
          </tr>)}</tbody>
        </table>
        <p className={styles.note}>Repeated questions can reward memory. Changes between runs are not proof of skill growth.</p>
      </section>}
      <section className={styles.nextActivity}><h2>Keep exploring</h2><p>Today's questions and image practice are separate from your test result.</p><div className={styles.actions}><Link className="btn" href="/daily">Today's five</Link><Link className="btn" href="/practice">Image practice</Link><Link href="/test">Take the demo again</Link></div></section>
      <p className={styles.note}>Test history is saved only in this browser. It does not sync to an account. Clearing site data removes it.</p>
    </>}
  </div></main>;
}
