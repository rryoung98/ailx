"use client";
/**
 * SwipeDeck — Tinder-style card deck for T2.
 *
 * ONE gesture engine (useSwipeCard) drives every card. Image cards get a
 * WebGL rendering layer (lazy-loaded three.js scene — one persistent
 * Canvas for the whole deck, never remounted per card); text/message
 * cards, and any browser without WebGL, use the identical DOM transform
 * path. Non-binary (provenance) items render as a static card with option
 * buttons inside the same deck so the Canvas persists across the deck.
 *
 * Mapping is fixed and SHOWN: swipe left = options[0], right = options[1];
 * verdict badges use the item's own option labels.
 */
import {
  Component,
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent, Ref } from "react";
import type { T2PresentedItem } from "./types.js";
import { useSwipeCard } from "./swipe/useSwipeCard.js";
import { detectWebGL } from "./swipe/webgl.js";
import type { ParallaxTarget } from "./swipe/CardScene.js";

// Lazy so SSR / static export never touches three.js.
const CardScene = lazy(() => import("./swipe/CardScene.js"));

export function isImageMaterial(material: string): boolean {
  return (
    material.startsWith("data:image/") ||
    /^(https?:)?\/[^\s]+\.(jpe?g|png|webp|gif|svg)$/i.test(material)
  );
}

const useIsoLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * The deck frame is sized to the space the viewport actually has.
 *
 * The frame is also the confidence step's frame, so "does the deck fit"
 * decides whether that step is reachable without scrolling. A fixed
 * 460px frame fits a laptop and overflows a phone, and an overflowing
 * frame is what made the browser scroll the page when focus moved into
 * the slider. Sizing to `innerHeight − (chrome above) − (buttons below)`
 * keeps the whole deck — card, panel and answer buttons — on one screen
 * at any viewport, so nothing ever has to be scrolled to.
 */
const DECK_MAX_H = 460;
/**
 * The floor is set by the confidence step, not by the card: the step's own
 * controls (your call, slider, hint, Lock in) need about this much, and a
 * step the candidate has to scroll INSIDE is the same failure as a page
 * that scrolls. Measured on a 390px phone with the tallest option list
 * (provenance), where the space left over is only ~185px. Below the floor
 * the page is allowed to scroll rather than the step.
 */
const DECK_MIN_H = 300;
/** Breathing room under the answer buttons, so they are not flush against
 *  the bottom edge of the screen. */
const DECK_GUTTER = 12;

const cardFace: CSSProperties = {
  position: "absolute",
  inset: 0,
  background: "var(--card)",
  border: "1px solid var(--border)",
  borderRadius: 16,
  padding: "1rem",
  display: "flex",
  flexDirection: "column",
  gap: "0.6rem",
  overflow: "hidden",
  // Paper shadow, tight enough never to paint over the answer
  // buttons below the deck (user screenshot regression).
  boxShadow: "0 6px 16px rgba(26,26,26,0.14)",
};

function badgeStyle(side: "left" | "right", opacity: number): CSSProperties {
  return {
    position: "absolute",
    top: 14,
    [side === "left" ? "left" : "right"]: 14,
    transform: `rotate(${side === "left" ? -12 : 12}deg)`,
    border: `3px solid ${side === "left" ? "var(--bad, #b91c1c)" : "var(--good, #15803d)"}`,
    color: side === "left" ? "var(--bad, #b91c1c)" : "var(--good, #15803d)",
    borderRadius: 8,
    padding: "0.2rem 0.55rem",
    fontWeight: 800,
    fontSize: "0.95rem",
    letterSpacing: "0.04em",
    textTransform: "uppercase",
    opacity,
    pointerEvents: "none",
    background: "rgba(0,0,0,0.35)",
    maxWidth: "60%",
  } as CSSProperties;
}

/** Self-contained answer-button styling (the package must not depend on an
 *  app stylesheet). Standardized motion: background/color/border 150ms,
 *  transform 120ms; hover FILLS with the accent green + white text. */
const T2_DECK_CSS = `
.t2-answer-btn {
  flex: 1; min-width: 0; background: var(--card, #fff); border-radius: 8px;
  padding: 0.5rem 0.7rem; font-size: 0.88rem; font-family: inherit; cursor: pointer;
  transition: background 150ms ease, color 150ms ease, border-color 150ms ease, transform 120ms ease;
}
.t2-answer-btn.tone-left { color: var(--bad, #b91c1c); border: 1px solid var(--bad, #b91c1c); }
.t2-answer-btn.tone-right { color: var(--good, #15803d); border: 1px solid var(--good, #15803d); }
.t2-answer-btn:hover:not([aria-disabled="true"]), .t2-option-btn:hover:not([aria-disabled="true"]) {
  background: var(--accent, #0b6b47); color: #fff; border-color: var(--accent, #0b6b47);
}
.t2-answer-btn:active:not([aria-disabled="true"]), .t2-option-btn:active:not([aria-disabled="true"]) { transform: translateY(0) scale(0.98); }
.t2-answer-btn:focus-visible, .t2-option-btn:focus-visible { outline: 2px solid var(--accent, #0b6b47); outline-offset: 2px; }
/* Inert-but-focusable: the answer buttons never take the disabled attribute,
   so focus is never yanked off the control the candidate just pressed. */
.t2-answer-btn[aria-disabled="true"], .t2-option-btn[aria-disabled="true"] { opacity: 0.55; cursor: default; }
.t2-option-btn {
  background: var(--card, #fff); color: var(--fg, #1a1a1a); border: 1px solid var(--border, #e3ddd6);
  border-radius: 8px; padding: 0.55rem 0.9rem; font-size: 0.92rem; font-family: inherit;
  text-align: left; cursor: pointer;
  transition: background 150ms ease, color 150ms ease, border-color 150ms ease, transform 120ms ease;
}
/* Mobile containment: answer/option pills stay tappable (>= 44px) and can
   never force the deck wider than the phone viewport. */
.t2-answer-btn, .t2-option-btn { max-width: 100%; box-sizing: border-box; }
@media (pointer: coarse) {
  .t2-answer-btn, .t2-option-btn { min-height: 44px; }
}
`;

/**
 * Robust stimulus <img>: async decode, ONE automatic retry on load error,
 * then a labeled fallback block instead of a broken-image glyph.
 */
function StimulusImg({ src, hide, slotRef }: { src: string; hide: boolean; slotRef?: Ref<HTMLImageElement> }) {
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setAttempt(0);
    setFailed(false);
  }, [src]);
  if (failed) {
    return (
      <div
        data-testid="stimulus-fallback"
        role="img"
        aria-label="exam material (image failed to load)"
        style={{
          flex: 1, minHeight: 0, display: "flex", alignItems: "center", justifyContent: "center",
          background: "var(--bg, #f7f4f2)", border: "1px dashed var(--border-strong, #c9c2b9)",
          borderRadius: 8, color: "var(--muted, #595650)", fontSize: "0.85rem", padding: "0.75rem",
        }}
      >
        Image failed to load — judge from the stem, or answer “can’t tell”.
      </div>
    );
  }
  return (
    <img
      key={attempt}
      ref={slotRef}
      src={src}
      alt="exam material"
      decoding="async"
      draggable={false}
      onError={() => (attempt === 0 ? setAttempt(1) : setFailed(true))}
      style={{
        flex: 1,
        minHeight: 0,
        objectFit: "contain",
        width: "100%",
        borderRadius: 8,
        opacity: hide ? 0 : 1,
        userSelect: "none",
      }}
    />
  );
}

/**
 * WebGL texture loads suspend inside CardScene; a decode FAILURE would
 * otherwise unwind the whole runner. Catch it here, report the url, and
 * render nothing — the DOM <img> underneath stays visible as the fallback.
 */
class TextureErrorBoundary extends Component<
  { onError: () => void; children?: ReactNode },
  { errored: boolean }
> {
  state = { errored: false };
  static getDerivedStateFromError() {
    return { errored: true };
  }
  componentDidCatch() {
    this.props.onError();
  }
  render() {
    return this.state.errored ? null : this.props.children;
  }
}

/**
 * The look of a TEXT stimulus, wherever it is shown: on the card, in the
 * confidence panel that replaces the card, and in the replay. One
 * definition, so the material a candidate judged never changes appearance
 * between those three places.
 */
export function stimulusTextStyle(item: T2PresentedItem, overrides: CSSProperties = {}): CSSProperties {
  return {
    flex: 1,
    minHeight: 0,
    overflow: "auto",
    whiteSpace: "pre-wrap",
    fontFamily: item.type.startsWith("message") ? "ui-monospace, monospace" : "inherit",
    fontSize: "0.9rem",
    lineHeight: 1.5,
    background: "var(--bg)",
    border: "1px solid var(--border)",
    borderRadius: 8,
    padding: "0.75rem",
    ...overrides,
  };
}

function CardBody({ item, hideImage, slotRef, lang }: { item: T2PresentedItem; hideImage: boolean; slotRef?: Ref<HTMLImageElement>; lang?: string }) {
  const image = isImageMaterial(item.material);
  return (
    <>
      <p lang={lang} style={{ margin: 0, fontWeight: 600, fontSize: "0.95rem" }}>{item.stem}</p>
      {image ? (
        <StimulusImg src={item.material} hide={hideImage} slotRef={slotRef} />
      ) : (
        <div lang={lang} style={stimulusTextStyle(item)}>
          {item.material}
        </div>
      )}
    </>
  );
}

export interface SwipeDeckProps {
  item: T2PresentedItem;
  /** up to two upcoming items, for the visible stack. */
  nextItems: ReadonlyArray<T2PresentedItem>;
  /** false while the confidence sheet is open. */
  enabled: boolean;
  onChoose: (choice: number) => void;
  /**
   * true when ANY item in the whole deck is an image: keeps the single
   * WebGL Canvas mounted for the entire deck (never remounted per card).
   * Defaults to "an image is visible in the current stack".
   */
  deckHasImages?: boolean;
  /** Fired when the current top card's stimulus is actually visible. */
  onStimulusReady?: () => void;
  /** BCP-47 language of localized ITEM content (stem/material/options). */
  lang?: string;
  /**
   * True while the confidence step (`overlay`) is open. It decides two
   * things, which is why it is one flag and not two: the upcoming stimuli
   * are masked (blank card backs) so the NEXT item never shows through
   * after the judged card flies off, and a NON-SWIPEABLE card — which has
   * no fling to carry it away — fades out instead of sitting on top of the
   * step it is meant to be about.
   */
  stepOpen?: boolean;
  /**
   * Ref to the FIRST answer/option button. The Runner uses it to hand focus
   * back to the deck when the confidence sheet closes, so a keyboard user is
   * never dropped on <body> between items (audit P0-2).
   */
  answerRef?: Ref<HTMLButtonElement>;
  /**
   * The confidence step, rendered INSIDE the card frame (absolutely
   * positioned over the deck box) rather than below it. The frame is the
   * deck's own stacking context, so the step occupies the same visual
   * region as the card it is about, the page height never changes, and
   * nothing has to be scrolled into view. It sits ABOVE the (masked)
   * upcoming cards and BELOW the top card, so the judged card visibly
   * sails off across the panel as the panel rises.
   *
   * The node owns its own open/closed state, focus and inertness — the
   * deck only gives it the frame.
   */
  overlay?: ReactNode;
}

export function SwipeDeck({ item, nextItems, enabled, onChoose, deckHasImages, onStimulusReady, lang, stepOpen, answerRef, overlay }: SwipeDeckProps) {
  const swipeable = item.options.length === 2;
  const [webgl, setWebgl] = useState(false);
  useEffect(() => {
    setWebgl(detectWebGL());
  }, []);

  const containerRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const [cardSize, setCardSize] = useState({ w: 360, h: 430 });
  useIsoLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) setCardSize({ w: r.width, h: r.height });
    };
    measure();
    if (typeof ResizeObserver !== "undefined") {
      const ro = new ResizeObserver(measure);
      ro.observe(el);
      return () => ro.disconnect();
    }
  }, []);

  /**
   * Fit the frame to the viewport (see DECK_MAX_H). Measured from the
   * frame's PAGE offset and the height of everything the deck renders
   * below it — both independent of the frame's own height, so setting the
   * height can never feed back into the measurement.
   */
  const [fitHeight, setFitHeight] = useState<number | null>(null);
  useIsoLayoutEffect(() => {
    const box = containerRef.current;
    const root = rootRef.current;
    if (!box || !root || typeof window === "undefined") return;
    const fit = () => {
      const b = box.getBoundingClientRect();
      const r = root.getBoundingClientRect();
      // jsdom / a not-yet-laid-out tree: keep the CSS default.
      if (r.height <= 0) return;
      const pageTop = b.top + window.scrollY;
      const below = r.bottom - b.bottom;
      const available = window.innerHeight - pageTop - below - DECK_GUTTER;
      setFitHeight(Math.round(Math.max(DECK_MIN_H, Math.min(DECK_MAX_H, available))));
    };
    fit();
    window.addEventListener("resize", fit);
    let ro: ResizeObserver | undefined;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(fit);
      // The chrome above the deck reflows (a lapse notice, a wrapped stem):
      // observing the page body catches it without a polling loop.
      ro.observe(document.body);
    }
    return () => {
      window.removeEventListener("resize", fit);
      ro?.disconnect();
    };
  }, []);

  const itemUrlRef = useRef<string | null>(null);

  const parallax = useRef<ParallaxTarget>({ x: 0, y: 0 });
  const onDeckPointerMove = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const el = containerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return;
    parallax.current = {
      x: ((e.clientX - r.left) / r.width) * 2 - 1,
      y: ((e.clientY - r.top) / r.height) * 2 - 1,
    };
  }, []);

  const { motion, bind, flingForChoice } = useSwipeCard({
    cardKey: item.id,
    enabled: enabled && swipeable,
    onCommit: (choice) => onChoose(choice),
  });

  /**
   * Keyboard path: arrow keys answer binary items with the same fling.
   *
   * The listener is bound to the DECK, not to window (audit P1-3). A window
   * listener with an unconditional preventDefault swallowed browser-back
   * (Alt/Cmd+Arrow), broke caret movement in any field on the page, and —
   * worst for a scored instrument — let a screen-reader user arrowing through
   * the page in BROWSE MODE fire an irreversible answer. Bound to the deck,
   * the event only arrives when focus is already inside the deck (i.e. on an
   * answer button), and preventDefault only runs when we actually answer.
   */
  useEffect(() => {
    const root = rootRef.current;
    if (!root || !enabled || !swipeable) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      // Modified arrows belong to the browser/OS; an IME composition and an
      // already-handled event are never a verdict either.
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.isComposing || e.defaultPrevented) return;
      const target = e.target;
      if (
        target instanceof HTMLElement &&
        target.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]')
      ) return;
      e.preventDefault();
      flingForChoice(e.key === "ArrowLeft" ? 0 : 1);
    };
    root.addEventListener("keydown", onKey);
    return () => root.removeEventListener("keydown", onKey);
  }, [enabled, swipeable, flingForChoice]);

  const m = motion.current;
  const topIsImage = isImageMaterial(item.material);
  const anyImageVisible = useMemo(
    () => topIsImage || nextItems.some((n) => isImageMaterial(n.material)),
    [topIsImage, nextItems],
  );
  // Preload + decode the next two stimuli so card advance never races a
  // slow image fetch (glitchy/blank card regression).
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.Image !== "function") return;
    for (const n of nextItems.slice(0, 2)) {
      if (!isImageMaterial(n.material)) continue;
      const im = new window.Image();
      im.decoding = "async";
      im.src = n.material;
      void im.decode?.().catch(() => {
        /* preload is best-effort; the card itself retries + falls back */
      });
    }
  }, [nextItems]);
  itemUrlRef.current = topIsImage ? item.material : null;
  // GL texture failures per url: 1st failure retries once (remount by key),
  // 2nd disables GL for that url — the DOM <img> stays as the stimulus.
  const [glFails, setGlFails] = useState<Record<string, number>>({});
  const useGL = webgl && (deckHasImages ?? anyImageVisible);
  const glImageUrl =
    useGL && topIsImage && !m.exited && (glFails[item.material] ?? 0) < 2
      ? item.material
      : null;
  // Measure the DOM image slot so the WebGL plane aligns to it exactly
  // (the stem stays DOM-rendered above the plane; audit fix).
  const imgSlotRef = useRef<HTMLImageElement | null>(null);
  const [slot, setSlot] = useState<{ ox: number; oy: number; w: number; h: number } | null>(null);
  useIsoLayoutEffect(() => {
    const el = imgSlotRef.current;
    const box = containerRef.current;
    if (!el || !box) { setSlot(null); return; }
    const measure = () => {
      const a = el.getBoundingClientRect();
      const b = box.getBoundingClientRect();
      setSlot({
        ox: a.left + a.width / 2 - (b.left + b.width / 2),
        oy: a.top + a.height / 2 - (b.top + b.height / 2),
        w: a.width,
        h: a.height,
      });
    };
    measure();
    if (typeof ResizeObserver === "undefined") return; // jsdom / old engines
    const ro = new ResizeObserver(measure);
    ro.observe(el); ro.observe(box);
    return () => ro.disconnect();
  }, [item.id, glImageUrl]);
  // Which GL texture is decoded & visible — DOM image stays until then, so
  // the stimulus never blanks while the lazy three bundle/texture loads.
  const [glReadyUrl, setGlReadyUrl] = useState<string | null>(null);
  const handleTextureReady = useCallback((url: string) => {
    setGlReadyUrl(url);
    onStimulusReady?.();
  }, [onStimulusReady]);
  const handleContextLost = useCallback(() => {
    setWebgl(false);
    setGlReadyUrl(null);
    onStimulusReady?.();
  }, [onStimulusReady]);
  const handleTextureError = useCallback(() => {
    const url = itemUrlRef.current;
    if (!url) return;
    setGlFails((f) => ({ ...f, [url]: (f[url] ?? 0) + 1 }));
    // The DOM image is the visible stimulus now — anchor timing on it.
    onStimulusReady?.();
  }, [onStimulusReady]);
  // Non-GL stimuli (text cards, or GL disabled): visible on DOM commit.
  useEffect(() => {
    if (!glImageUrl) onStimulusReady?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id, glImageUrl === null]);

  const topTransform = `translate3d(${m.x}px, ${m.y}px, 0) rotate(${m.rot}deg)`;
  const promoteTransition = "transform 340ms cubic-bezier(0.2, 1.4, 0.4, 1), opacity 340ms ease";

  return (
    <div ref={rootRef} data-testid="swipe-deck" data-webgl={useGL ? "1" : "0"}>
      <style>{T2_DECK_CSS}</style>
      <div
        ref={containerRef}
        onPointerMove={onDeckPointerMove}
        style={{
          position: "relative",
          width: "100%",
          // Measured fit (see DECK_MAX_H); the CSS value is the pre-measure
          // and no-JS fallback, never taller than the measured ceiling.
          height: fitHeight === null ? `min(56vh, ${DECK_MAX_H}px)` : `${fitHeight}px`,
          minHeight: DECK_MIN_H,
          touchAction: "pan-y",
        }}
      >
        {/* Stack: next two cards behind, scaled/dimmed; promoted with a
            springy CSS transition when the top card flies off. */}
        {[...nextItems].slice(0, 2).reverse().map((n, revIdx) => {
          const depth = Math.min(nextItems.length, 2) - revIdx; // 2 then 1
          return (
            <div
              key={n.id}
              aria-hidden
              style={{
                ...cardFace,
                transform: `translate3d(0, ${depth * 16}px, 0) scale(${1 - depth * 0.05})`,
                transformOrigin: "bottom center",
                filter: `brightness(${1 - depth * 0.18})`,
                transition: promoteTransition,
                zIndex: 1 + revIdx,
                pointerEvents: "none",
              }}
            >
              {stepOpen ? null : <CardBody item={n} hideImage={false} />}
            </div>
          );
        })}

        {/* Top card: the single gesture surface for DOM and WebGL alike. */}
        <div
          data-testid="top-card"
          {...(swipeable ? bind : {})}
          style={{
            ...cardFace,
            zIndex: 4,
            transform: topTransform,
            transition:
              m.dragging || m.exiting ? "none" : "transform 40ms linear, opacity 180ms ease",
            visibility: m.exited ? "hidden" : "visible",
            // A provenance card is answered by button, so it never flies
            // off: without this it would sit ON TOP of the confidence step
            // (the step is deliberately below the top card, so a swiped
            // card sails across it) and the candidate would be moving an
            // invisible slider.
            opacity: stepOpen && !swipeable ? 0 : 1,
            cursor: swipeable ? (m.dragging ? "grabbing" : "grab") : "default",
            touchAction: swipeable ? "none" : "auto",
            // While the card is flying off, the overlay underneath is already
            // interactive: the card must not swallow a tap aimed at the
            // confidence slider during those ~250ms.
            pointerEvents: enabled ? "auto" : "none",
          }}
        >
          <CardBody item={item} hideImage={Boolean(glImageUrl) && glReadyUrl === glImageUrl} slotRef={imgSlotRef} lang={lang} />
        </div>

        {/* Verdict badges: own overlay ABOVE the WebGL layer, glued to the
            card via the same transform (audit fix: GL must not cover them). */}
        {swipeable && !m.exited && (
          <div
            aria-hidden
            style={{
              position: "absolute", inset: 0, zIndex: 6, pointerEvents: "none",
              transform: topTransform,
              transition: m.dragging || m.exiting ? "none" : "transform 40ms linear",
            }}
          >
            <span
              data-testid="badge-left"
              style={badgeStyle("left", m.x < 0 || m.exiting === "left" ? m.badge : 0)}
            >
              {item.options[0]}
            </span>
            <span
              data-testid="badge-right"
              style={badgeStyle("right", m.x > 0 || m.exiting === "right" ? m.badge : 0)}
            >
              {item.options[1]}
            </span>
          </div>
        )}

        {/* Persistent WebGL layer for the whole deck (image cards only). */}
        {/* Decorative for AT: the DOM card carries the equivalent content. */}
        {useGL && (
          <div aria-hidden style={{ position: "absolute", inset: 0, zIndex: 5, pointerEvents: "none" }}>
            <TextureErrorBoundary
              key={`${glImageUrl ?? "none"}#${glImageUrl ? glFails[glImageUrl] ?? 0 : 0}`}
              onError={handleTextureError}
            >
              <Suspense fallback={null}>
                <CardScene
                  imageUrl={glImageUrl}
                  motion={motion}
                  parallax={parallax}
                  width={slot ? slot.w : cardSize.w - 32}
                  height={slot ? slot.h : cardSize.h - 32}
                  offsetX={slot ? slot.ox : 0}
                  offsetY={slot ? slot.oy : 0}
                  onTextureReady={handleTextureReady}
                  onContextLost={handleContextLost}
                />
              </Suspense>
            </TextureErrorBoundary>
          </div>
        )}

        {/* In-frame step overlay (the confidence panel). zIndex 3 keeps it
            above the upcoming-card stack (1–2) and below the top card (4),
            its badges (6) and the GL layer (5). */}
        {overlay ? (
          <div style={{ position: "absolute", inset: 0, zIndex: 3, pointerEvents: "none" }}>
            {overlay}
          </div>
        ) : null}
      </div>

      {/* Mapping legend — swipe left = options[0], right = options[1];
          the buttons are also the click/AT path and fire the same fling. */}
      {swipeable ? (
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: "0.6rem",
            // Clear the stacked cards' 32px overhang below the deck box and
            // stay above the GL/badge overlays so the answer buttons are
            // never covered.
            marginTop: "2.8rem",
            alignItems: "center",
            position: "relative",
            zIndex: 7,
          }}
        >
          <span aria-hidden style={{ color: "var(--muted)", fontSize: "1.1rem" }}>←</span>
          <button
            ref={answerRef}
            lang={lang}
            className="t2-answer-btn tone-left"
            onClick={() => { if (enabled) flingForChoice(0); }}
            // aria-disabled, NOT disabled: disabling the button the candidate
            // just pressed drops focus to <body> mid-item, and decisionLatency
            // is scored (audit P0-2). The control stays focusable and inert.
            aria-disabled={!enabled}
          >
            {item.options[0]}
          </button>
          <span style={{ color: "var(--muted)", fontSize: "0.75rem", whiteSpace: "nowrap" }}>
            swipe or ← / →
          </span>
          <button
            lang={lang}
            className="t2-answer-btn tone-right"
            onClick={() => { if (enabled) flingForChoice(1); }}
            aria-disabled={!enabled}
          >
            {item.options[1]}
          </button>
          <span aria-hidden style={{ color: "var(--muted)", fontSize: "1.1rem" }}>→</span>
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gap: "0.5rem",
            // Clear the stacked cards' 32px overhang below the deck box and
            // stay above the GL/badge overlays — same guard as the swipe
            // buttons — so the first option is never painted over.
            marginTop: "2.8rem",
            position: "relative",
            zIndex: 7,
          }}
        >
          {item.options.map((opt, i) => (
            <button
              key={i}
              ref={i === 0 ? answerRef : undefined}
              lang={lang}
              className="t2-option-btn"
              onClick={() => { if (enabled) onChoose(i); }}
              aria-disabled={!enabled}
            >
              {opt}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
