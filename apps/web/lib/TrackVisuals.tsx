"use client";

/**
 * CSS track previews: animated mini-previews of each track's play
 * mechanic. Pure CSS keyframes + inline SVG — no new dependencies. The T2
 * preview uses REAL images from the committed instrument snapshot.
 *
 * Since the 3D landing pass these serve as the NON-WEBGL FALLBACK for the
 * track3d scenes (see lib/track3d/TrackScene.tsx, TRACK_VIZ below); the
 * TrackCards grid remains as a self-contained embed used by tests and any
 * surface that wants the compact card presentation.
 *
 * Motion rules: prefers-reduced-motion shows the static first frame
 * (globals.css kills the keyframes); an IntersectionObserver pauses every
 * animation while a card is offscreen; hover speeds the loop up (the
 * `--spd` multiplier in CSS).
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { snapshotTrack } from "./instrument";

export interface VizMedia {
  src: string;
  alt: string;
  real: boolean;
}

interface RawImgItem {
  type: string;
  key: string;
  material: { src?: string; alt?: string };
}

/**
 * Three REAL image items from the snapshot bank for the T2 mini-deck:
 * first AI, first real, second AI (deterministic order).
 */
export function t2VisualMedia(): VizMedia[] {
  const bank = snapshotTrack("t2").bank;
  const items = (bank?.items ?? []) as unknown as RawImgItem[];
  const imgs = items.filter((i) => i.type === "image-provenance" && typeof i.material.src === "string");
  const real = imgs.filter((i) => i.key === "real");
  const ai = imgs.filter((i) => i.key !== "real");
  const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "/ailx";
  return [ai[0], real[0], ai[1]]
    .filter((i): i is RawImgItem => Boolean(i))
    .map((i) => ({
      src: `${base}/${String(i.material.src).replace(/^\/+/, "")}`,
      alt: i.material.alt ?? "photo",
      real: i.key === "real",
    }));
}

/** Pause all card animations while the element is offscreen. */
function useOffscreenPause<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => setPaused(!entries.some((e) => e.isIntersecting)),
      { threshold: 0.05 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return { ref, paused };
}

/** T1: code lines type into a mini browser, then morph into a tiny site. */
function T1Viz() {
  return (
    <div className="tviz tv1" aria-hidden="true">
      <div className="tv1-browser">
        <div className="tv1-chrome"><i /><i /><i /></div>
        <div className="tv1-body">
          <div className="tv1-code">
            {[72, 55, 84, 40, 66, 30].map((w, i) => (
              <span key={i} className="tv1-line" style={{ width: `${w}%`, animationDelay: `${i * 0.35}s` }} />
            ))}
            <span className="tv1-cursor" />
          </div>
          <div className="tv1-site">
            <div className="tv1-hero" />
            <div className="tv1-cards"><i /><i /><i /></div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** T2: a mini card stack of real snapshot images auto-swiping in a loop. */
function T2Viz() {
  const media = t2VisualMedia();
  return (
    <div className="tviz tv2" aria-hidden="true">
      {media.map((m, i) => (
        <div key={m.src} className={`tv2-card tv2-${["a", "b", "c"][i]}`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={m.src} alt="" draggable={false} />
          <span className={`tv2-stamp ${m.real ? "real" : "ai"}`}>{m.real ? "REAL" : "AI"}</span>
        </div>
      ))}
    </div>
  );
}

/** T3: chat bubbles land, a bad claim gets struck and corrected. */
function T3Viz() {
  return (
    <div className="tviz tv3" aria-hidden="true">
      <div className="tv3-bubble tv3-b1">payback ≈ <span className="tv3-claim">61 months<i className="tv3-strike" /></span></div>
      <span className="tv3-fix">38 months</span>
      <div className="tv3-bubble tv3-b2">…recomputed from filings</div>
      <span className="tv3-check">✓</span>
    </div>
  );
}

/** T4: a 2×2 generation grid sharpens tile by tile; one gets picked. */
function T4Viz() {
  return (
    <div className="tviz tv4" aria-hidden="true">
      <div className="tv4-grid">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className={`tv4-tile tv4-t${i}`}>
            {i === 3 && <span className="tv4-final">FINAL</span>}
          </div>
        ))}
      </div>
      <div className="tv4-pips"><i className="tv4-p1" /><i className="tv4-p2" /><i className="tv4-p3" /></div>
    </div>
  );
}

export const TRACK_VIZ = { T1: T1Viz, T2: T2Viz, T3: T3Viz, T4: T4Viz } as const;

const CARDS = [
  { id: "T1", name: "Creative Build", caption: "Direct a build, watch it render, ship it.", Viz: T1Viz },
  { id: "T2", name: "Authenticity Discrimination", caption: "Can you spot the fakes?", Viz: T2Viz },
  { id: "T3", name: "AI-Assisted Reasoning", caption: "The assistant lies twice. Catch it.", Viz: T3Viz },
  { id: "T4", name: "Generative Direction", caption: "Six shots. Make them count.", Viz: T4Viz },
];

function TrackCard({ id, name, caption, Viz }: (typeof CARDS)[number]) {
  const { ref, paused } = useOffscreenPause<HTMLAnchorElement>();
  return (
    <Link
      ref={ref}
      href="/exam"
      className="card track-card track-card-viz"
      data-paused={paused}
      aria-label={`${id} ${name}: ${caption}`}
    >
      <h3 style={{ margin: "0 0 0.5rem", fontSize: "0.95rem" }}>
        <span className="mono" style={{ color: "var(--accent)" }}>{id}</span> {name}
      </h3>
      <Viz />
      <p className="muted small" style={{ margin: "0.55rem 0 0" }}>{caption}</p>
    </Link>
  );
}

export function TrackCards() {
  return (
    <div className="grid4">
      {CARDS.map((c) => <TrackCard key={c.id} {...c} />)}
    </div>
  );
}
