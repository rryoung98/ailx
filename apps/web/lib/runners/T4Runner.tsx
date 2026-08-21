"use client";

/** T4 demo runner — generative direction under a hard quota (§T4). */

import { useState } from "react";
import type { TrackUIProps } from "@ailx/core";
import { generateDemoImage, type DemoArt } from "../svgArt";

const QUOTA = 6;
const BRIEF =
  "Brief: a cover image for a report titled \u2018Quiet Infrastructure\u2019 \u2014 calm, systematic, engineered; no text in the image.";

export function T4Runner(props: TrackUIProps) {
  const [prompt, setPrompt] = useState("");
  const [gens, setGens] = useState<Array<DemoArt & { prompt: string }>>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [disclosed, setDisclosed] = useState(false);

  const left = QUOTA - gens.length;

  const generate = () => {
    if (left <= 0 || prompt.trim().length === 0) return;
    const art = generateDemoImage(prompt.trim(), gens.length);
    setGens((g) => [...g, { ...art, prompt: prompt.trim() }]);
    props.onEvent({
      verb: gens.some((g) => g.prompt === prompt.trim()) ? "regenerated" : "prompted",
      object: `t4:generator:${art.seed.slice(0, 10)}`,
      result: { prompt: prompt.trim() },
      clientTs: new Date().toISOString(),
    });
  };

  const submit = () => {
    if (!selected) return;
    props.onComplete({
      demo: true, trackId: "t4",
      t4: {
        prompts: gens.map((g) => g.prompt),
        generations: gens.length,
        quota: QUOTA,
        selectedSeed: selected,
        disclosed,
      },
    });
  };

  return (
    <div>
      <p className="muted small" style={{ marginTop: 0 }}>{BRIEF}</p>
      <div style={{ display: "flex", gap: "0.6rem" }}>
        <input
          className="field" value={prompt} placeholder="Direct the model…"
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") generate(); }}
        />
        <button className="btn primary" onClick={generate} disabled={left <= 0 || prompt.trim().length === 0}>
          Generate
        </button>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", margin: "0.5rem 0 0.9rem" }}>
        <span className="faint small">deterministic demo image model — same prompt, same picture, forever</span>
        <span className={`small mono ${left <= 1 ? "quota-low" : "muted"}`}>{left} generation{left === 1 ? "" : "s"} left</span>
      </div>
      {gens.length > 0 && (
        <div className="gen-grid">
          {gens.map((g) => (
            <button
              key={g.seed}
              className={`gen-cell${selected === g.seed ? " selected" : ""}`}
              onClick={() => setSelected(g.seed)}
              title={g.prompt}
            >
              <span dangerouslySetInnerHTML={{ __html: g.svg }} />
            </button>
          ))}
        </div>
      )}
      {gens.length > 0 && (
        <div style={{ marginTop: "1rem" }}>
          <label className="small muted" style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
            <input type="checkbox" checked={disclosed} onChange={(e) => setDisclosed(e.target.checked)} />
            Attach the AI-generation disclosure statement (provenance hygiene is scored)
          </label>
          <button className="btn primary" style={{ marginTop: "0.8rem" }} onClick={submit} disabled={!selected}>
            Deliver selected image →
          </button>
        </div>
      )}
    </div>
  );
}
