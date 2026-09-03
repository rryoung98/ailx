"use client";

/**
 * Editorial track bands — replaces the uniform four-card grid. Four
 * full-bleed alternating rows: WebGL scene on one side, an oversized mono
 * numeral + track name + one supporting line on the other. No card chrome
 * around the visuals; the scenes float on the page black. Every band is a
 * single link to /exam.
 */
import Link from "next/link";
import { TRACK_LIST } from "@ailx/report";
import { TrackScene } from "./TrackScene";
import { Reveal } from "../../../components/ui/Reveal";

/** "T2 — can you spot the fakes?" -> "Can you spot the fakes?" */
export function supportLine(hype: string): string {
  const s = hype.replace(/^T\d\s*\u2014\s*/u, "").trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function TrackBands() {
  return (
    <section className="track-bands" aria-label="The four tracks">
      {TRACK_LIST.map((t, i) => (
        <Reveal as="div" key={t.code}>
        <Link
          href="/exam"
          className={`track-band${i % 2 === 1 ? " flip" : ""}`}
          aria-label={`${t.code} ${t.name}: ${supportLine(t.hype)}`}
        >
          <div className="track-band-viz">
            <TrackScene id={t.code} />
          </div>
          <div className="track-band-copy">
            <span className="track-band-num" aria-hidden="true">{t.code}</span>
            <h3 className="track-band-title">{t.name}</h3>
            <p className="track-band-line">{supportLine(t.hype)}</p>
          </div>
        </Link>
        </Reveal>
      ))}
    </section>
  );
}
