"use client";

/**
 * Covering loader (zero.university-style): a fixed deep-green cover with a
 * mint paper-grain, the AILX wordmark strokes draw on, then the cover
 * wipes up and unmounts. Total <= 1.3s.
 *
 * Skip rules:
 *  - prefers-reduced-motion: never shown (CSS hides it pre-hydration too);
 *  - sessionStorage "ailx:loaded": already shown this tab — skip (the
 *    inline script hides the cover before hydration, no flash);
 *  - after the first show the flag is set, so client navs and quick
 *    reloads skip.
 *
 * Robustness: the cover is rendered in the initial HTML (no flash of the
 * page beneath on a true hard load), aria-hidden, position:fixed (zero
 * CLS), and ALWAYS unmounts — animationend on the wipe OR a setTimeout
 * fallback, whichever fires first. Scroll is never locked.
 */
import { useEffect, useState } from "react";
import { assetUrl } from "../lib/mode";
import { prefersReducedMotion } from "../lib/reducedMotion";

const KEY = "ailx:loaded";
/** Two-tone wordmark asset (public/), shares its traced paths with logo.svg. */
export const LOADER_MARK = "/media/loader-mark.svg";
/** Wipe keyframe name — the unmount listens for exactly this animation. */
export const WIPE_ANIMATION = "loaderWipe";
/** Hard unmount fallback (ms): full run is ~1.3s, pad a little. */
export const LOADER_FALLBACK_MS = 1500;

/** Runs before hydration: hide the cover for repeat/reduced-motion loads. */
const PREHYDRATE = `try{if(sessionStorage.getItem("${KEY}")||matchMedia("(prefers-reduced-motion: reduce)").matches){document.documentElement.dataset.ailxLoaded="1"}}catch(e){}`;

function shouldSkip(): boolean {
  try {
    if (window.sessionStorage.getItem(KEY)) return true;
  } catch {
    /* storage unavailable -> show once per load, still fine */
  }
  return prefersReducedMotion();
}

export function Loader() {
  const [gone, setGone] = useState(false);

  useEffect(() => {
    if (shouldSkip()) {
      setGone(true);
      return;
    }
    try {
      window.sessionStorage.setItem(KEY, "1");
    } catch {
      /* ignore */
    }
    const timer = window.setTimeout(() => setGone(true), LOADER_FALLBACK_MS);
    return () => window.clearTimeout(timer);
  }, []);

  if (gone) return null;
  return (
    <>
      {/* biome-ignore lint/security/noDangerouslySetInnerHtml: PREHYDRATE is a module constant with no interpolated input; it must run before hydration, so it cannot be a component. */}
      <script dangerouslySetInnerHTML={{ __html: PREHYDRATE }} />
      <div
        className="loader"
        aria-hidden="true"
        data-testid="loader"
        onAnimationEnd={(e) => {
          if (e.animationName === WIPE_ANIMATION) setGone(true);
        }}
      >
        {/* Traced AILX wordmark (serif AIL + script X), light on green. An
            <img> on purpose: inlining the traced paths put ~14 kB of
            decorative path data into the layout chunk AND into every
            prerendered HTML page. The two-tone fill and the staggered fade
            live inside the file, because page CSS cannot reach the document
            of an <img>. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          className="loader-logo"
          src={assetUrl(LOADER_MARK)}
          alt=""
          width={8490}
          height={3580}
        />
      </div>
    </>
  );
}
