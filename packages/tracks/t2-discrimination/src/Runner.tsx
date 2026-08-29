"use client";
/**
 * T2 Runner — swipe/judgement deck with fixed exposure, confidence slider,
 * then a replay phase teaching each item's rationale + provenance point.
 * Dark exam UI via the app's CSS vars. Client-only; no network.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { TrackUIProps } from "@ailx/core";
import type { T2Config, T2Item, T2Response } from "./types.js";
import { validateT2Config } from "./plugin.js";
import { decodeT2Checkpoint, encodeT2Checkpoint, type T2Phase } from "./checkpoint.js";
import { SwipeDeck, isImageMaterial } from "./SwipeDeck.js";

type Phase = T2Phase;

/** How long the "exposure lapsed" notice holds the deck inert. Long enough
 *  to read, short enough not to feel like a penalty. */
const LAPSE_NOTICE_MS = 1600;

/** Slider position shown before the candidate has chosen a confidence.
 *  It is a POSITION only — nothing is recorded until the slider is used. */
const DEFAULT_CONFIDENCE = 50;

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

const ghostBtn: CSSProperties = {
  ...btn,
  background: "transparent",
  color: "var(--fg)",
  border: "1px solid var(--border)",
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

function Material({ item, lang }: { item: T2Item; lang?: string }) {
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
    <div
      lang={lang}
      style={{
        whiteSpace: "pre-wrap",
        fontFamily: item.type.startsWith("message") ? "ui-monospace, monospace" : "inherit",
        fontSize: "0.95rem",
        lineHeight: 1.5,
        background: "var(--bg)",
        border: "1px solid var(--border)",
        borderRadius: 8,
        padding: "0.9rem",
      }}
    >
      {item.material}
    </div>
  );
}

export function Runner({ locale, config, onEvent, onComplete, checkpoint, onCheckpoint }: TrackUIProps) {
  const cfg: T2Config = useMemo(() => validateT2Config(config), [config]);
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
  const sliderRef = useRef<HTMLInputElement>(null);
  const answerRef = useRef<HTMLButtonElement>(null);
  const replayBtnRef = useRef<HTMLButtonElement>(null);
  const deckTopRef = useRef<HTMLParagraphElement>(null);
  // True while focus was moved INTO the confidence sheet by us: the sheet
  // then owns focus (trap) and hands it back to the deck on close.
  const focusInSheetRef = useRef(false);
  const completed = useRef(false);

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

  // Bring the confidence sheet into view when it slides up.
  useEffect(() => {
    if (choice !== null && typeof sheetRef.current?.scrollIntoView === "function") {
      sheetRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [choice]);

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
        (answerRef.current ?? replayBtnRef.current)?.focus();
      }
      return;
    }
    focusInSheetRef.current = true;
    sliderRef.current?.focus();
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
        // Bring the next item's header/stem back into view — the confidence
        // sheet usually left the page scrolled to the bottom of the card.
        if (typeof deckTopRef.current?.scrollIntoView === "function") {
          deckTopRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      } else {
        setPhase("replay");
        saveCheckpoint({ responses: nextResponses, phase: "replay" });
      }
    },
    [cfg.items.length, idx, item, onEvent, responses, saveCheckpoint],
  );

  // Stimulus-ready gating (audit fix): for image items the WebGL texture may
  // still be decoding when React selects the item — latency and exposure must
  // anchor at the moment the stimulus is actually visible, not at selection.
  // Per-item readiness keyed by item id: SwipeDeck reports synchronously on
  // commit for DOM stimuli, at texture-decode for WebGL image cards. Keying
  // avoids child-before-parent effect ordering races.
  const [readyItemId, setReadyItemId] = useState<string | null>(null);
  const itemIdRef = useRef<string | null>(null);
  itemIdRef.current = item ? item.id : null;
  const stimulusReady = Boolean(item && readyItemId === item.id);
  const handleStimulusReady = useCallback(() => {
    setReadyItemId(itemIdRef.current);
  }, []);
  // Safety net: never leave an item unanchored if a load event is lost.
  useEffect(() => {
    if (phase !== "deck" || stimulusReady || !item) return;
    const t = setTimeout(() => setReadyItemId(item.id), 1500);
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
  }, [phase, idx, stimulusReady, lapse === null]);

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
        <div ref={deckTopRef as unknown as React.RefObject<HTMLDivElement>} style={{ display: "flex", justifyContent: "space-between", color: "var(--muted)", scrollMarginTop: 96 }}>
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
        <SwipeDeck
          item={item}
          nextItems={cfg.items.slice(idx + 1, idx + 3)}
          deckHasImages={deckHasImages}
          lang={contentLang}
          enabled={!sheetOpen && !lapse}
          maskUpcoming={sheetOpen}
          onChoose={(i) => {
            if (choice !== null || lapse) return;
            decisionLatency.current = Math.max(0, Math.round(performance.now() - shownAt.current));
            setChoice(i);
          }}
          onStimulusReady={handleStimulusReady}
          answerRef={answerRef}
        />
        {/* Confidence sheet — slides up under the deck after each swipe. */}
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
            transform: sheetOpen ? "translateY(0)" : "translateY(115%)",
            opacity: sheetOpen ? 1 : 0,
            transition: "transform 260ms cubic-bezier(0.2, 1.2, 0.4, 1), opacity 200ms ease",
            pointerEvents: sheetOpen ? "auto" : "none",
          }}
        >
          {item.type === "media-image" && (
            // Keep the judged stimulus in view while rating confidence —
            // the card itself has flown off and upcoming cards are masked.
            <img
              src={item.material}
              alt=""
              aria-hidden
              style={{ width: "100%", maxHeight: 180, objectFit: "contain", borderRadius: 8, marginBottom: "0.6rem", background: "var(--bg)" }}
            />
          )}
          <p style={{ margin: "0 0 0.4rem", fontWeight: 600 }}>
            Your call: <span lang={contentLang}>{choice !== null ? item.options[choice] : "—"}</span>
          </p>
          <label style={{ color: "var(--muted)", fontSize: "0.9rem" }}>
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
          {sheetOpen && confidence === null && (
            <p
              data-testid="confidence-hint"
              style={{ margin: "0.5rem 0 0", color: "var(--muted)", fontSize: "0.85rem" }}
            >
              Set how sure you are before locking in — confidence is scored, so it
              is never assumed for you.
            </p>
          )}
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
            onClick={() => confidence !== null && record(choice ?? -1, confidence)}
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
    );
  }

  if (phase === "replay") {
    const rItem = cfg.items[replayIdx];
    const resp = responses.find((r) => r.itemId === rItem.id);
    const correct = resp?.choice === rItem.key;
    return (
      <div style={{ maxWidth: 720, margin: "0 auto", display: "grid", gap: "1rem" }}>
        {/* Announce each reveal outcome politely as the replay advances. */}
        <p style={srOnly} aria-live="polite" data-testid="replay-live-region">
          Replay item {replayIdx + 1} of {cfg.items.length}.{" "}
          {resp && resp.choice >= 0
            ? `Your call was ${correct ? "correct" : "incorrect"}.`
            : "No response was recorded for this item."}
        </p>
        <div style={{ color: "var(--muted)" }}>
          Replay {replayIdx + 1} / {cfg.items.length} — how each call should be reasoned
        </div>
        <div style={card}>
          <p lang={contentLang} style={{ marginTop: 0, fontWeight: 600 }}>{rItem.stem}</p>
          <Material item={rItem} lang={contentLang} />
          <p style={{ color: correct ? "var(--good, #15803d)" : "var(--bad, #b91c1c)", marginBottom: "0.3rem" }}>
            {resp && resp.choice >= 0
              ? `Your call: ${rItem.options[resp.choice]} (${resp.confidence} sure) — ${correct ? "correct" : "incorrect"}`
              : "No response (exposure lapsed)"}
          </p>
          <p style={{ marginBottom: "0.3rem" }}>
            <strong>Answer:</strong> <span lang={contentLang}>{rItem.options[rItem.key]}</span>
          </p>
          <p style={{ color: "var(--muted)" }}>
            <strong style={{ color: "var(--fg)" }}>Why:</strong> <span lang={contentLang}>{rItem.rationale}</span>
          </p>
          {rItem.teaching && (
            <p style={{ color: "var(--muted)", borderLeft: "3px solid var(--accent)", paddingLeft: "0.7rem" }}>
              <strong style={{ color: "var(--fg)" }}>Provenance point:</strong> <span lang={contentLang}>{rItem.teaching}</span>
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
