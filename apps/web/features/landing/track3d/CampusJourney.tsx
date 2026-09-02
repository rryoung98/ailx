"use client";

/**
 * Campus map journey — the Zero-style "pan across campus" move. A tall
 * (400vh) scrub section pins a full-bleed aerial campus photo; as you
 * scroll T1→T4 the photo pans to a different building per track while a
 * floating white card (code, name, one line, mini scene) swaps per stop.
 *
 * Progressive enhancement contract (CSS in globals.css):
 *  - base / no animation-timeline: this section is display:none and the
 *    static alternating <TrackBands> fallback next to it renders instead;
 *  - reduced motion: same static fallback (no pin, no pan);
 *  - supporting browsers: fallback is display:none, journey takes over.
 * Either way exactly one set of four /exam links is exposed to AT, in
 * DOM order T1→T4.
 */
import Link from "next/link";
import { TRACK_LIST } from "@ailx/report";
import { TrackScene } from "./TrackScene";
import { supportLine } from "./TrackBands";
import { assetUrl } from "../../../lib/mode";

export function CampusJourney() {
  return (
    <section className="campus-journey" aria-label="Tour the four tracks">
      <div className="campus-stage">
        <div
          className="campus-map"
          aria-hidden="true"
          style={{ backgroundImage: `url(${assetUrl("/media/campus-map.jpg")})` }}
        />
        <div className="campus-scrim" aria-hidden="true" />
        {TRACK_LIST.map((t, i) => (
          <Link
            key={t.code}
            href="/exam"
            className={`campus-card campus-stop-${i + 1}`}
            aria-label={`${t.code} ${t.name}: ${supportLine(t.hype)}`}
          >
            <span className="mono campus-card-code" aria-hidden="true">{t.code}</span>
            <h3 className="campus-card-title">{t.name}</h3>
            <p className="campus-card-line">{supportLine(t.hype)}</p>
            <div className="campus-card-viz">
              <TrackScene id={t.code} />
            </div>
          </Link>
        ))}
        <p className="campus-progress" aria-hidden="true">
          <span className="mono">T1 · T2 · T3 · T4</span>
        </p>
      </div>
    </section>
  );
}
