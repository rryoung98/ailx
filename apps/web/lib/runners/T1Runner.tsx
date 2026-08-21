"use client";

/** T1 demo runner — direct a build with live preview (compressed 48h window). */

import { useState } from "react";
import type { TrackUIProps } from "@ailx/core";
import { T1_CHOICES } from "../demoItems";

const PALETTES: Record<string, { bg: string; fg: string; ac: string }> = {
  "Ink & signal blue": { bg: "#0b0d12", fg: "#e8eaf0", ac: "#5b8cff" },
  "Warm paper": { bg: "#f4ead8", fg: "#2a2118", ac: "#b4552d" },
  "Terminal green": { bg: "#06120a", fg: "#c8ffd9", ac: "#2fd07f" },
};

export function T1Runner(props: TrackUIProps) {
  const [layout, setLayout] = useState<string>(T1_CHOICES.layout[0]);
  const [palette, setPalette] = useState<string>(T1_CHOICES.palette[0]);
  const [type, setType] = useState<string>(T1_CHOICES.type[0]);
  const [headline, setHeadline] = useState("");
  const [rationale, setRationale] = useState("");
  const [iterations, setIterations] = useState(0);

  const pick = (kind: string, v: string, set: (v: string) => void) => {
    set(v);
    setIterations((i) => i + 1);
    props.onEvent({ verb: "revised", object: `t1:${kind}:${v}`, clientTs: new Date().toISOString() });
  };

  const pal = PALETTES[palette];
  const font = type === "Serif essay" ? "var(--serif)" : type === "Mono technical" ? "var(--mono)" : "inherit";

  const Chooser = ({ kind, options, value, set }: { kind: string; options: readonly string[]; value: string; set: (v: string) => void }) => (
    <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap", alignItems: "center", margin: "0.35rem 0" }}>
      <span className="faint small" style={{ width: "4.2rem" }}>{kind}</span>
      {options.map((o) => (
        <button key={o} className={`btn small-btn${value === o ? " armed" : ""}`} onClick={() => pick(kind, o, set)}>{o}</button>
      ))}
    </div>
  );

  return (
    <div>
      <p className="muted small" style={{ marginTop: 0 }}>
        Brief: a personal site that communicates who you are, to a stated audience.
        Direct the build — every decision lands in the prompt log.
      </p>
      <Chooser kind="layout" options={T1_CHOICES.layout} value={layout} set={setLayout} />
      <Chooser kind="palette" options={T1_CHOICES.palette} value={palette} set={setPalette} />
      <Chooser kind="type" options={T1_CHOICES.type} value={type} set={setType} />
      <input
        className="field" style={{ margin: "0.6rem 0" }} value={headline}
        placeholder="Your headline — who are you, in one line?"
        onChange={(e) => setHeadline(e.target.value)}
      />

      <div className="site-preview" style={{ background: pal.bg, color: pal.fg, fontFamily: font }}>
        {layout === "Split hero" ? (
          <div style={{ display: "grid", gridTemplateColumns: "3fr 2fr", gap: "0.8rem", alignItems: "center" }}>
            <div>
              <div style={{ fontSize: "1.15rem", fontWeight: 700 }}>{headline || "Your headline lands here"}</div>
              <div style={{ opacity: 0.7, fontSize: "0.8rem" }}>Shipped work · writing · contact</div>
            </div>
            <div style={{ height: 64, borderRadius: 8, background: pal.ac, opacity: 0.85 }} />
          </div>
        ) : layout === "Bento grid" ? (
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: "0.5rem" }}>
            <div style={{ gridRow: "span 2", borderRadius: 8, padding: "0.6rem", background: `${pal.ac}22`, border: `1px solid ${pal.ac}` }}>
              <strong>{headline || "Your headline lands here"}</strong>
            </div>
            <div style={{ height: 34, borderRadius: 8, background: pal.ac, opacity: 0.7 }} />
            <div style={{ height: 34, borderRadius: 8, background: pal.ac, opacity: 0.4 }} />
            <div style={{ height: 34, borderRadius: 8, background: pal.ac, opacity: 0.55, gridColumn: "span 2" }} />
          </div>
        ) : (
          <div style={{ textAlign: "center", padding: "0.4rem 0" }}>
            <div style={{ fontSize: "1.2rem", fontWeight: 700 }}>{headline || "Your headline lands here"}</div>
            <div style={{ width: 54, height: 3, background: pal.ac, margin: "0.5rem auto" }} />
            <div style={{ opacity: 0.7, fontSize: "0.8rem" }}>Shipped work · writing · contact</div>
          </div>
        )}
      </div>

      <textarea
        className="field" rows={3} value={rationale} style={{ margin: "0.8rem 0" }}
        placeholder="Design rationale (scored on coherence between intent and artefact)…"
        onChange={(e) => setRationale(e.target.value)}
      />
      <button
        className="btn primary"
        onClick={() => props.onComplete({
          demo: true, trackId: "t1",
          t1: { layout, palette, type, headline, rationale, iterations },
        })}
      >
        Ship it →
      </button>
    </div>
  );
}
