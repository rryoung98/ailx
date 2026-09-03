"use client";
/**
 * T2 Runner — swipe/judgement deck with fixed exposure, confidence slider,
 * then a replay phase teaching each item's rationale + provenance point.
 * Dark exam UI via the app's CSS vars. Client-only; no network.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { TrackUIProps } from "@ailx/core";
import type { T2PresentationConfig, T2PresentedItem, T2Response } from "./types.js";
import { isRevealedT2Item } from "./types.js";
import { validateT2PresentationConfig } from "./plugin.js";
import { decodeT2Checkpoint, encodeT2Checkpoint, type T2Phase } from "./checkpoint.js";
import { SwipeDeck, isImageMaterial, stimulusTextStyle } from "./SwipeDeck.js";

type Phase = T2Phase;

/** How long the "exposure lapsed" notice holds the deck inert. Long enough
 *  to read, short enough not to feel like a penalty. */
const LAPSE_NOTICE_MS = 1600;

/** Slider position shown before the candidate has chosen a confidence.
 *  It is a POSITION only — nothing is recorded until the slider is used. */
const DEFAULT_CONFIDENCE = 50;

/**
 * How much of the judged stimulus the confidence step must still show once
 * its controls have taken what they need — two lines of the material at
 * 0.9rem/1.5 (43.2px), plus the 0.6rem gap under it.
 *
 * TEN-89: the step's controls are the part that may NEVER be scrolled to, so
 * the deck frame is sized from their measured height plus this. The material
 * itself keeps its own scrollbar (`stimulusTextStyle`), which is how a long
 * item has always been shown on a card; what changed is that a long OPTION
 * LABEL — the "Your call" line echoes it in full — can no longer push Lock in
 * off the bottom of a 390x844 phone.
 */
const STEP_STIMULUS_MIN_H = 53;

/**
 * Every focus() this track performs is a SCROLL-FREE focus.
 *
 * Moving focus is the last thing that still scrolled the page: a browser
 * scrolls a newly focused control into view by default, and on a viewport
 * shorter than the deck that scroll jumped ~470px on a phone and even
 * overshot the panel off the top of the screen. The panel is sized to the
 * viewport (SwipeDeck), so it is already fully visible — the browser's
 * guess is never needed and never wanted.
 */
const NO_SCROLL: FocusOptions = { preventScroll: true };

const card: CSSProperties = {
  background: "var(--card)",
  border: "1px solid var(--border)",
  borderRadius: 12,
  padding: "1.25rem",
};

const btn: CSSProperties = {
  background: "var(--accent)",
  // Paper design: white text on the app accent green (#0b6b47) = 6.4:1.
  color: "#ffffff",
  border: "none",
  borderRadius: 8,
  padding: "0.6rem 1.2rem",
  fontSize: "1rem",
  cursor: "pointer",
};

/** Visually hidden, exposed to assistive technology (self-contained —
 *  the package must not depend on an app stylesheet). */
const srOnly: CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  whiteSpace: "nowrap",
  border: 0,
};

/**
 * `prefers-reduced-motion: reduce`, live. In an exam an a11y failure is a
 * validity failure, so the confidence step must be able to appear with no
 * movement at all. SSR/static export starts at false and corrects on mount.
 */
function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(mq.matches);
    sync();
    mq.addEventListener?.("change", sync);
    return () => mq.removeEventListener?.("change", sync);
  }, []);
  return reduced;
}

function Material({ item, lang }: { item: T2PresentedItem; lang?: string }) {
  if (item.material.startsWith("data:image/") || /^(https?:)?\/[^\s]+\.(jpe?g|png|webp|gif)$/i.test(item.material)) {
    return (
      <img
        src={item.material}
        alt="exam material"
        style={{ maxWidth: "100%", borderRadius: 8, border: "1px solid var(--border)" }}
      />
    );
  }
  return (
    <div lang={lang} style={stimulusTextStyle(item, { fontSize: "0.95rem", padding: "0.9rem" })}>
      {item.material}
    </div>
  );
}

export function Runner({ locale, config, onEvent, onComplete, onPresentation, checkpoint, onCheckpoint }: TrackUIProps) {
  // PRESENTATION config: no key, no rationale. In hosted mode this deck came
  // from GET /api/attempts/:id/items, which redacts both until the attempt is
  // finalized, so validating for secrets here would refuse the real deck.
  const cfg: T2PresentationConfig = useMemo(() => validateT2PresentationConfig(config), [config]);
  // Rehydrate from the persisted checkpoint on (re)mount — F2.
  const restored = useMemo(() => decodeT2Checkpoint(checkpoint), []);
  const [phase, setPhase] = useState<Phase>(restored?.phase ?? "intro");
  const [idx, setIdx] = useState(restored?.deckIndex ?? 0);
  const [choice, setChoice] = useState<number | null>(null);
  const choiceRef = useRef<number | null>(null);
  choiceRef.current = choice;
  // null until the candidate actually moves/taps the slider: an untouched
  // default would silently record a confidence nobody chose (calibration is
  // scored). The STORED shape is unchanged — a number, always.
  const [confidence, setConfidence] = useState<number | null>(null);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  // Set when a timed exposure runs out: the deck freezes for a beat and
  // says so, so the click aimed at the lapsed item cannot land on the next.
  const [lapse, setLapse] = useState<{ index: number } | null>(null);
  const [responses, setResponses] = useState<T2Response[]>(restored?.responses ?? []);
  const [replayIdx, setReplayIdx] = useState(restored?.replayIdx ?? 0);
  const shownAt = useRef(0);
  const decisionLatency = useRef<number | null>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const controlsRef = useRef<HTMLDivElement>(null);
  const sliderRef = useRef<HTMLInputElement>(null);
  const answerRef = useRef<HTMLButtonElement>(null);
  const replayBtnRef = useRef<HTMLButtonElement>(null);
  // True while focus was moved INTO the confidence sheet by us: the sheet
  // then owns focus (trap) and hands it back to the deck on close.
  const focusInSheetRef = useRef(false);
  const completed = useRef(false);
  const reducedMotion = usePrefersReducedMotion();

  /**
   * P0 fairness: the replay is post-deck PRESENTATION — every answer and
   * every latency is already recorded, and nothing here can change the
   * score. It is also the only screen in T2 that teaches, so it must not be
   * read against a running exam clock. The session engine holds the clock
   * (and its watchdog) for exactly this interval.
   */
  useEffect(() => {
    onPresentation?.(phase === "replay" ? "t2-replay" : null);
  }, [onPresentation, phase]);

  // Checkpoint every meaningful mutation with explicit next values (state
  // setters have not committed yet inside handlers).
  const saveCheckpoint = useCallback(
    (next: Partial<{ phase: Phase; deckIndex: number; replayIdx: number; responses: T2Response[] }>) => {
      onCheckpoint?.(
        encodeT2Checkpoint({
          phase: next.phase ?? phase,
          deckIndex: next.deckIndex ?? idx,
          replayIdx: next.replayIdx ?? replayIdx,
          responses: next.responses ?? responses,
        }),
      );
    },
    [idx, onCheckpoint, phase, replayIdx, responses],
  );

  /**
   * Focus management for the confidence sheet (audit P0-2).
   *
   * The sheet is a modal step of a SCORED, TIMED item: the candidate cannot
   * proceed without setting confidence. Answering used to leave focus on
   * <body> (the answer button disabled itself under the user's fingers), so
   * an AT user then had to tab in from the top of the document — seconds
   * that land in decisionLatency and in the exposure budget.
   *
   * Open  → focus the slider (the control that must be used).
   * Open  → Tab cycles inside the sheet only (trap).
   * Close → focus returns to the deck's first answer button, so the next
   *         item is answerable immediately with no tabbing.
   */
  useEffect(() => {
    if (choice === null) {
      // Closing: hand focus back to the deck, but only if WE had taken it.
      if (focusInSheetRef.current) {
        focusInSheetRef.current = false;
        // Deck first; on the LAST item the deck is gone and the replay's own
        // button is the sensible landing spot. Focus never falls to <body>.
        (answerRef.current ?? replayBtnRef.current)?.focus(NO_SCROLL);
      }
      return;
    }
    focusInSheetRef.current = true;
    sliderRef.current?.focus(NO_SCROLL);
    /**
     * Last resort, and only when the deck could not be made to fit.
     *
     * SwipeDeck sizes the frame so that card, panel and answer buttons share
     * one screen, and then nothing here scrolls. But the fit has a floor
     * (DECK_MIN_H): on a short viewport with the tallest option list, the
     * buttons the candidate just pressed can sit below the fold, which means
     * the panel that replaces the card is now ABOVE it — the candidate is
     * moving a slider they cannot see. `block: "nearest"` scrolls the least
     * that makes it visible, so when the panel is already on screen (the
     * normal case, every viewport that fits) it does nothing at all and the
     * no-scroll property is untouched.
     */
    sheetRef.current?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [choice]);

  /** Focusable controls inside the sheet, in DOM order. */
  const sheetFocusables = useCallback((): HTMLElement[] => {
    const el = sheetRef.current;
    if (!el) return [];
    return [...el.querySelectorAll<HTMLElement>("input, button, select, textarea, [href], [tabindex]")]
      .filter((n) => !n.hasAttribute("disabled") && n.getAttribute("aria-hidden") !== "true");
  }, []);

  const onSheetKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key !== "Tab") return;
      const nodes = sheetFocusables();
      if (nodes.length === 0) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      const active = document.activeElement as HTMLElement | null;
      // Wrap at both ends: focus can never leave the sheet while it is open,
      // and can never land on the (inert) deck behind it.
      if (e.shiftKey && (active === first || !sheetRef.current?.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !sheetRef.current?.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    },
    [sheetFocusables],
  );

  const item = cfg.items[idx];
  // Localized ITEM content (stems, materials, options, rationales) is
  // marked with its language; UI chrome stays English (html lang="en").
  const contentLang = locale === "en" ? undefined : locale;
  const deckHasImages = useMemo(
    () => cfg.items.some((i) => isImageMaterial(i.material)),
    [cfg.items],
  );
  const untimed = !item || item.type === "provenance";
  const exposure = item?.exposureSeconds ?? (untimed ? 0 : 15);

  /**
   * The height the deck frame must have for THIS item's confidence step, so
   * that its controls are never behind an internal scrollbar (TEN-89).
   *
   * Measured, not assumed: a stem, an option label and a material are all
   * DATA, and nothing in the instrument bounds their length — the failing CI
   * runs reported 23px of overflow, then 48px, on the same commit, because
   * each run was dealt a different item. The controls block carries no
   * `flex`, so its height depends on the item and the viewport WIDTH but
   * never on the frame height this feeds: measuring it can not oscillate.
   *
   * A ResizeObserver catches the reflows a render does not: the web font
   * landing, a rotation, a zoom.
   */
  const [stepMinHeight, setStepMinHeight] = useState(0);
  useEffect(() => {
    const controls = controlsRef.current;
    const sheet = sheetRef.current;
    if (!controls || !sheet || typeof window === "undefined") return;
    const px = (v: string) => {
      const n = Number.parseFloat(v);
      return Number.isFinite(n) ? n : 0;
    };
    const measure = () => {
      // `offsetHeight`, not a client rect: it is the border-box height in
      // layout pixels and no spec mocks it, so a unit test that fakes
      // geometry cannot accidentally hand the deck a floor.
      const controlsH = controls.offsetHeight;
      // jsdom lays nothing out and reports every box as zero: a floor derived
      // from that would be a made-up number, so ask for nothing instead.
      if (controlsH <= 0) {
        setStepMinHeight(0);
        return;
      }
      const s = window.getComputedStyle(sheet);
      const chrome =
        px(s.paddingTop) + px(s.paddingBottom) + px(s.borderTopWidth) + px(s.borderBottomWidth);
      setStepMinHeight(Math.ceil(controlsH + chrome + STEP_STIMULUS_MIN_H));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(controls);
    return () => ro.disconnect();
  }, [item?.id, phase]);

  const record = useCallback(
    (choiceIdx: number, conf: number) => {
      // Latency is anchored at card reveal and captured at the moment of the
      // swipe decision (not at confidence lock-in); a lapse falls back to
      // the full exposure elapsed.
      const latencyMs =
        decisionLatency.current ?? Math.max(0, Math.round(performance.now() - shownAt.current));
      decisionLatency.current = null;
      const r: T2Response = { itemId: item.id, choice: choiceIdx, confidence: conf, latencyMs };
      onEvent({
        verb: "responded",
        object: `item:${item.id}`,
        result: r,
        context: { track: "t2-discrimination", index: idx, type: item.type },
        clientTs: new Date().toISOString(),
      });
      const nextResponses = [...responses, r];
      setResponses(nextResponses);
      setChoice(null);
      setConfidence(null);
      if (idx + 1 < cfg.items.length) {
        setIdx(idx + 1);
        saveCheckpoint({ responses: nextResponses, deckIndex: idx + 1 });
      } else {
        setPhase("replay");
        saveCheckpoint({ responses: nextResponses, phase: "replay" });
      }
    },
    [cfg.items.length, idx, item, onEvent, responses, saveCheckpoint],
  );

  /**
   * Lock in the confidence the candidate set. Both paths — the button and
   * Enter on the slider — go through here so they can never diverge.
   */
  const lockInConfidence = useCallback(() => {
    if (choice === null || confidence === null) return;
    record(choice, confidence);
  }, [choice, confidence, record]);

  // Stimulus-ready gating (audit fix): for image items the WebGL texture may
  // still be decoding when React selects the item — latency and exposure must
  // anchor at the moment the stimulus is actually visible, not at selection.
  // Per-item readiness keyed by item id: SwipeDeck reports synchronously on
  // commit for TEXT stimuli, and for an image when the picture paints (or
  // when the fallback block replaces it, or when a WebGL texture decodes).
  // Keying avoids child-before-parent effect ordering races.
  //
  // The anchor also records WHERE it came from, because the safety net below
  // is itself a device effect if it is left alone: a handset that takes two
  // seconds to paint the picture would start its exposure on a blank card and
  // sit the item with less material time than a fast one. So a provisional
  // ("fallback") anchor is UPGRADED when the real signal lands, which
  // restarts the exposure at its declared length. The upgrade can happen at
  // most once per item and never after a verdict is cast, so the exposure can
  // only ever be the declared one — never shorter, never repeatedly extended.
  const [ready, setReady] = useState<{ id: string; from: "stimulus" | "fallback" } | null>(null);
  const itemIdRef = useRef<string | null>(null);
  itemIdRef.current = item ? item.id : null;
  const stimulusReady = Boolean(item && ready?.id === item.id);
  const handleStimulusReady = useCallback(() => {
    const id = itemIdRef.current;
    if (id === null) return;
    setReady((prev) => {
      if (prev?.id === id && prev.from === "stimulus") return prev;
      // A verdict is already cast: the candidate saw the card, so re-anchoring
      // would hand out extra time and overwrite the recorded decision latency.
      if (prev?.id === id && choiceRef.current !== null) return prev;
      return { id, from: "stimulus" };
    });
  }, []);
  // Safety net: never leave an item unanchored if a load event is lost.
  useEffect(() => {
    if (phase !== "deck" || stimulusReady || !item) return;
    const t = setTimeout(() => setReady({ id: item.id, from: "fallback" }), 1500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, idx, stimulusReady]);

  // Fixed-exposure countdown per timed item; a lapse is recorded as choice -1.
  // Starts only once the stimulus is visible (stimulusReady) and once any
  // lapse notice has cleared (the next item must get its full exposure).
  useEffect(() => {
    if (phase !== "deck" || !item || !stimulusReady || lapse) return;
    shownAt.current = performance.now();
    decisionLatency.current = null;
    if (untimed) {
      setSecondsLeft(null);
      return;
    }
    setSecondsLeft(exposure);
    const t = setInterval(() => {
      // Clock pauses while the confidence sheet is up: picking how sure you
      // are is reflection, not exposure — the decision latency was already
      // anchored at the swipe. (choiceRef mirrors `choice` to keep this
      // interval stable across renders.)
      if (choiceRef.current !== null) return;
      setSecondsLeft((s) => (s === null ? null : s - 1));
    }, 1000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, idx, stimulusReady, ready?.from, lapse === null]);

  useEffect(() => {
    if (phase === "deck" && secondsLeft !== null && secondsLeft <= 0) {
      // A lapse records "no response" (choice -1, confidence 0) and raises
      // the notice; an already-cast verdict cannot lapse (the clock freezes
      // while the confidence sheet is open) but is honoured if it ever does.
      if (choice === null) setLapse({ index: idx });
      record(choice ?? -1, choice === null ? 0 : confidence ?? 0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [secondsLeft]);

  // The notice clears itself; until it does the deck is inert.
  useEffect(() => {
    if (!lapse) return;
    const t = setTimeout(() => setLapse(null), LAPSE_NOTICE_MS);
    return () => clearTimeout(t);
  }, [lapse]);

  const finish = useCallback(() => {
    if (completed.current) return;
    completed.current = true;
    const artifact = { responses };
    onEvent({
      verb: "submitted",
      object: "t2-discrimination:artifact",
      result: { count: responses.length },
      clientTs: new Date().toISOString(),
    });
    onComplete(artifact);
    setPhase("done");
    saveCheckpoint({ phase: "done" });
  }, [onComplete, onEvent, responses, saveCheckpoint]);

  if (phase === "intro") {
    return (
      <div style={{ maxWidth: 720, margin: "0 auto", display: "grid", gap: "1rem" }}>
        <div style={card}>
          <h2 style={{ marginTop: 0 }}>T2 · Authenticity Discrimination</h2>
          <p style={{ color: "var(--muted)" }}>
            {cfg.items.length} items. Swipe the card (or use ← / →, or the labeled
            buttons) to make the call. Timed items have a fixed exposure — a declared
            measurement decision. For each: make the call, then set how sure you are
            (0–100). Confidence is scored: being confidently wrong costs more than
            being uncertainly wrong. After the deck, a replay teaches each item&apos;s
            rationale. Locale: {locale}.
          </p>
          <button
            style={btn}
            onClick={() => {
              setPhase("deck");
              saveCheckpoint({ phase: "deck" });
            }}
          >
            Start the deck
          </button>
        </div>
      </div>
    );
  }

  if (phase === "deck" && item) {
    const sheetOpen = choice !== null;
    return (
      <div style={{ maxWidth: 560, margin: "0 auto", display: "grid", gap: "0.8rem" }}>
        {/* Announce each item change (number + stem) politely; the visual
            deck itself is gesture-driven and not reliably readable mid-swipe. */}
        <p style={srOnly} aria-live="polite" data-testid="deck-live-region">
          Item {idx + 1} of {cfg.items.length}.{" "}
          <span lang={contentLang}>{item.stem}</span>
          {untimed ? "" : ` Timed exposure: ${exposure} seconds.`}
        </p>
        <p style={srOnly}>
          Use the two labeled answer buttons below the card — they are the
          primary path and record the same response. Swiping the card or
          pressing the left and right arrow keys are equivalent alternatives.
        </p>
        <div style={{ display: "flex", justifyContent: "space-between", color: "var(--muted)" }}>
          <span>
            Item {idx + 1} / {cfg.items.length} · {item.type}
          </span>
          <span>
            {untimed ? "untimed" : `${Math.max(0, secondsLeft ?? exposure)}s`}
          </span>
        </div>
        {lapse && (
          <p
            data-testid="lapse-notice"
            role="alert"
            style={{
              margin: 0,
              padding: "0.6rem 0.8rem",
              borderRadius: 8,
              border: "1px solid var(--bad, #b91c1c)",
              background: "rgba(185,28,28,0.12)",
              color: "var(--bad, #b91c1c)",
              fontWeight: 600,
            }}
          >
            Item {lapse.index + 1} missed — the exposure ran out, so no response was
            recorded. The deck resumes in a moment.
          </p>
        )}
        {/* The confidence step renders INSIDE the deck frame (SwipeDeck's
            `overlay`), in the same visual region as the card it is about.
            It used to be a sibling below the deck, which pushed it under the
            fold and forced a scrollIntoView on open and another one back on
            the next item — the scroll ping-pong candidates reported, and the
            single largest source of cross-browser smooth-scroll divergence.
            In-frame, the page height never changes and nothing is scrolled. */}
        <SwipeDeck
          item={item}
          nextItems={cfg.items.slice(idx + 1, idx + 3)}
          deckHasImages={deckHasImages}
          lang={contentLang}
          enabled={!sheetOpen && !lapse}
          stepOpen={sheetOpen}
          stepMinHeight={stepMinHeight}
          onChoose={(i) => {
            if (choice !== null || lapse) return;
            decisionLatency.current = Math.max(0, Math.round(performance.now() - shownAt.current));
            setChoice(i);
          }}
          onStimulusReady={handleStimulusReady}
          answerRef={answerRef}
          overlay={
            <div
              ref={sheetRef}
              data-testid="confidence-sheet"
              // A modal step of a scored item: while it is open it owns focus,
              // and while it is closed it is inert so its slider is not a stray
              // tab stop behind the deck.
              role="dialog"
              aria-modal={sheetOpen || undefined}
              aria-label="Set your confidence"
              aria-hidden={!sheetOpen}
              inert={!sheetOpen}
              onKeyDown={onSheetKeyDown}
              style={{
                ...card,
                // Fill the card frame exactly: same place, same size, no
                // layout shift on either edge of the step.
                position: "absolute",
                inset: 0,
                display: "flex",
                flexDirection: "column",
                overflow: "auto",
                borderRadius: 16,
                // The card's own padding, not the page card's roomier one:
                // the panel stands in for the card, and on a 390px phone
                // every millimetre goes to the evidence and the slider.
                padding: "1rem",
                boxShadow: "0 6px 16px rgba(26,26,26,0.14)",
                // The frame is `touch-action: pan-y` for the swipe gesture;
                // the panel is a form, so it keeps normal touch behaviour.
                touchAction: "auto",
                // Settles up into the frame while the judged card sails off
                // above it. Ease-out with NO overshoot: a control the
                // candidate is reaching for must not still be moving.
                transform: sheetOpen || reducedMotion ? "none" : "translateY(10%) scale(0.98)",
                opacity: sheetOpen ? 1 : 0,
                transition: reducedMotion
                  ? "none"
                  : "transform 260ms cubic-bezier(0.22, 0.61, 0.36, 1), opacity 180ms ease",
                pointerEvents: sheetOpen ? "auto" : "none",
              }}
            >
              {/* The judged stimulus stays visible, at card scale, in the
                  card's own frame: confidence is rated against what was
                  actually looked at, not from memory. The card itself has
                  flown off and the upcoming cards are masked. It also FILLS
                  the frame, so a text item is not a half-empty white card
                  with a slider stranded at the top of it. */}
              {isImageMaterial(item.material) ? (
                <img
                  src={item.material}
                  alt=""
                  aria-hidden
                  data-testid="judged-stimulus"
                  style={{
                    flex: 1,
                    minHeight: 0,
                    width: "100%",
                    objectFit: "contain",
                    borderRadius: 8,
                    marginBottom: "0.6rem",
                    background: "var(--bg)",
                  }}
                />
              ) : (
                <div
                  lang={contentLang}
                  data-testid="judged-stimulus"
                  style={stimulusTextStyle(item, { marginBottom: "0.6rem" })}
                >
                  {item.material}
                </div>
              )}
              {/* CONTROLS: the part of the step that must never be behind a
                  scrollbar. It carries no `flex`, so its height is the item's
                  and the viewport's — which is what the deck frame is sized
                  from (see stepMinHeight above). */}
              <div ref={controlsRef} data-testid="confidence-controls">
              {/* The candidate's own call, echoed in full — an option label is
                  a sentence on a provenance item and truncating it would hide
                  what they are rating. Every option is laid into ONE grid
                  cell, all but the chosen one hidden, so the line reserves the
                  longest of them from the start: the step is then the same
                  height before and after the answer, and answering cannot
                  resize the frame under the hand reaching for the slider. */}
              <p style={{ display: "grid", margin: "0 0 0.4rem", fontWeight: 600 }}>
                {item.options.map((opt, i) => (
                  <span
                    key={i}
                    lang={contentLang}
                    style={{ gridArea: "1 / 1", visibility: choice === i ? "visible" : "hidden" }}
                  >
                    Your call: {opt}
                  </span>
                ))}
                <span style={{ gridArea: "1 / 1", visibility: choice === null ? "visible" : "hidden" }}>
                  Your call: —
                </span>
              </p>
              <label style={{ display: "block", color: "var(--muted)", fontSize: "0.9rem" }}>
                How sure? {confidence === null ? "not set" : confidence}
                <input
                  ref={sliderRef}
                  type="range"
                  min={0}
                  max={100}
                  value={confidence ?? DEFAULT_CONFIDENCE}
                  aria-label={
                    confidence === null
                      ? "Confidence: not set — move the slider to choose 0 to 100"
                      : `Confidence: ${confidence} out of 100`
                  }
                  aria-valuetext={confidence === null ? "not set" : `${confidence} out of 100`}
                  onChange={(e) => setConfidence(Number(e.target.value))}
                  // A range input does not submit, so Enter used to do
                  // nothing — and Enter is a keyboard user's first instinct
                  // after arrowing to a value. It locks in exactly what the
                  // button locks in, and stays inert until a value is set.
                  onKeyDown={(e) => {
                    if (e.key !== "Enter" || e.shiftKey || e.altKey || e.ctrlKey || e.metaKey || e.nativeEvent.isComposing) return;
                    // preventDefault only when we really lock in: an Enter
                    // we ignore stays the browser's to handle.
                    if (choice === null || confidence === null) return;
                    e.preventDefault();
                    lockInConfidence();
                  }}
                  // A tap/click that lands exactly on the shown default fires no
                  // change event; treat the press itself as the interaction so
                  // "I did choose 50" is not an unreachable answer.
                  onPointerDown={() => setConfidence((c) => c ?? DEFAULT_CONFIDENCE)}
                  // 16px floor: iOS Safari auto-zooms the page when a focused
                  // form control's font is smaller, then snaps back out on
                  // lock-in when the sheet closes — the reported mobile "zoom
                  // out", most visible on image items (tallest sheet).
                  style={{ width: "100%", accentColor: "var(--accent)", fontSize: 16 }}
                />
              </label>
              {/* Always laid out, hidden until it applies: the hint appears
                  when the step opens and goes again the moment a confidence
                  is set, and a step that changed height twice mid-item would
                  move Lock in while it is being pressed. `visibility: hidden`
                  keeps the space and still takes it out of the a11y tree. */}
              <p
                data-testid="confidence-hint"
                style={{
                  margin: "0.5rem 0 0",
                  color: "var(--muted)",
                  fontSize: "0.85rem",
                  visibility: sheetOpen && confidence === null ? "visible" : "hidden",
                }}
              >
                Set how sure you are — confidence is scored, never assumed for you.
              </p>
              <button
                style={{
                  ...btn,
                  marginTop: "0.8rem",
                  opacity: sheetOpen && confidence !== null ? 1 : 0.5,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "0.45rem",
                }}
                disabled={!sheetOpen || confidence === null}
                onClick={lockInConfidence}
              >
                {/* Inline padlock glyph — decorative; the label carries meaning. */}
                <svg
                  aria-hidden="true"
                  data-testid="lock-icon"
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <rect x="4" y="11" width="16" height="10" rx="2" fill="currentColor" stroke="none" />
                  <path d="M8 11V7a4 4 0 0 1 8 0v4" />
                </svg>
                Lock in
              </button>
              </div>
            </div>
          }
        />
      </div>
    );
  }

  if (phase === "replay") {
    const rItem = cfg.items[replayIdx];
    const resp = responses.find((r) => r.itemId === rItem.id);
    /**
     * The marking scheme is present only when the CONTENT carries it: the
     * released-practice tier (keys published on purpose), or a review-phase
     * deck the server has already unsealed. During a hosted sitting it is
     * absent, so the replay teaches the deck back without a verdict rather
     * than inventing one from a key the browser must never hold. The
     * candidate's own calls are still theirs to re-read.
     */
    const revealed = isRevealedT2Item(rItem) ? rItem : null;
    const answered = resp !== undefined && resp.choice >= 0;
    const correct = revealed !== null && answered && resp.choice === revealed.key;
    return (
      <div style={{ maxWidth: 720, margin: "0 auto", display: "grid", gap: "1rem" }}>
        {/* Announce each reveal outcome politely as the replay advances. */}
        <p style={srOnly} aria-live="polite" data-testid="replay-live-region">
          Replay item {replayIdx + 1} of {cfg.items.length}.{" "}
          {!answered
            ? "No response was recorded for this item."
            : revealed
              ? `Your call was ${correct ? "correct" : "incorrect"}.`
              : "Your call was recorded. Answers unlock in your report."}
        </p>
        <div style={{ color: "var(--muted)" }}>
          Replay {replayIdx + 1} / {cfg.items.length} — how each call should be reasoned
        </div>
        <div style={card}>
          <p lang={contentLang} style={{ marginTop: 0, fontWeight: 600 }}>{rItem.stem}</p>
          <Material item={rItem} lang={contentLang} />
          <p
            style={{
              color: !answered || !revealed
                ? "var(--muted)"
                : correct
                  ? "var(--good, #15803d)"
                  : "var(--bad, #b91c1c)",
              marginBottom: "0.3rem",
            }}
          >
            {!answered
              ? "No response (exposure lapsed)"
              : revealed
                ? `Your call: ${rItem.options[resp.choice]} (${resp.confidence} sure) — ${correct ? "correct" : "incorrect"}`
                : `Your call: ${rItem.options[resp.choice]} (${resp.confidence} sure)`}
          </p>
          {revealed ? (
            <>
              <p style={{ marginBottom: "0.3rem" }}>
                <strong>Answer:</strong> <span lang={contentLang}>{revealed.options[revealed.key]}</span>
              </p>
              <p style={{ color: "var(--muted)" }}>
                <strong style={{ color: "var(--fg)" }}>Why:</strong>{" "}
                <span lang={contentLang}>{revealed.rationale}</span>
              </p>
            </>
          ) : (
            <p style={{ color: "var(--muted)" }} data-testid="replay-sealed">
              Answers and rationales are held by the server until you finish your run — they
              are in your report.
            </p>
          )}
          {revealed?.teaching && (
            <p style={{ color: "var(--muted)", borderLeft: "3px solid var(--accent)", paddingLeft: "0.7rem" }}>
              <strong style={{ color: "var(--fg)" }}>Provenance point:</strong> <span lang={contentLang}>{revealed.teaching}</span>
            </p>
          )}
          {replayIdx + 1 < cfg.items.length ? (
            <button
              ref={replayBtnRef}
              style={btn}
              onClick={() => {
                setReplayIdx(replayIdx + 1);
                saveCheckpoint({ replayIdx: replayIdx + 1 });
              }}
            >
              Next
            </button>
          ) : (
            <button ref={replayBtnRef} style={btn} onClick={finish}>
              Finish track
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 720, margin: "0 auto" }}>
      <div style={card}>
        <h2 style={{ marginTop: 0 }}>T2 complete</h2>
        <p style={{ color: "var(--muted)" }}>
          {responses.length} responses recorded. Scoring is deterministic and runs
          from the stored responses only.
        </p>
      </div>
    </div>
  );
}
