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

const KEY = "ailx:loaded";
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
  return window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true;
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
      <script dangerouslySetInnerHTML={{ __html: PREHYDRATE }} />
      <div
        className="loader"
        aria-hidden="true"
        data-testid="loader"
        onAnimationEnd={(e) => {
          if (e.animationName === WIPE_ANIMATION) setGone(true);
        }}
      >
        <svg className="loader-logo" viewBox="0 0 320 96" fill="none" focusable="false">
          <g stroke="#b7f0cd" strokeWidth="14" strokeLinecap="round" strokeLinejoin="round">
            <path className="lg lg-a" pathLength={1} d="M14 82 L40 16 L66 82" />
            <path className="lg lg-a2" pathLength={1} d="M26 56 L54 56" />
            <path className="lg lg-i" pathLength={1} d="M96 16 L96 82" />
            <path className="lg lg-l" pathLength={1} d="M130 16 L130 82 L172 82" />
            <path className="lg lg-x1" pathLength={1} stroke="#d8ffe8" d="M204 16 L258 82" />
            <path className="lg lg-x2" pathLength={1} stroke="#d8ffe8" d="M258 16 L204 82" />
          </g>
        </svg>
      </div>
    </>
  );
}
