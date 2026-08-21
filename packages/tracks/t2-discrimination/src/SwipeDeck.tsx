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
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent, Ref } from "react";
import type { T2Item } from "./types.js";
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
  boxShadow: "0 18px 40px rgba(0,0,0,0.35)",
};

function badgeStyle(side: "left" | "right", opacity: number): CSSProperties {
  return {
    position: "absolute",
    top: 14,
    [side === "left" ? "left" : "right"]: 14,
    transform: `rotate(${side === "left" ? -12 : 12}deg)`,
    border: `3px solid ${side === "left" ? "#f87171" : "#4ade80"}`,
    color: side === "left" ? "#f87171" : "#4ade80",
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

function CardBody({ item, hideImage, slotRef, lang }: { item: T2Item; hideImage: boolean; slotRef?: Ref<HTMLImageElement>; lang?: string }) {
  const image = isImageMaterial(item.material);
  return (
    <>
      <p lang={lang} style={{ margin: 0, fontWeight: 600, fontSize: "0.95rem" }}>{item.stem}</p>
      {image ? (
        <img
          ref={slotRef}
          src={item.material}
          alt="exam material"
          draggable={false}
          style={{
            flex: 1,
            minHeight: 0,
            objectFit: "contain",
            width: "100%",
            borderRadius: 8,
            opacity: hideImage ? 0 : 1,
            userSelect: "none",
          }}
        />
      ) : (
        <div
          lang={lang}
          style={{
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
          }}
        >
          {item.material}
        </div>
      )}
    </>
  );
}

export interface SwipeDeckProps {
  item: T2Item;
  /** up to two upcoming items, for the visible stack. */
  nextItems: ReadonlyArray<T2Item>;
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
}

export function SwipeDeck({ item, nextItems, enabled, onChoose, deckHasImages, onStimulusReady, lang }: SwipeDeckProps) {
  const swipeable = item.options.length === 2;
  const [webgl, setWebgl] = useState(false);
  useEffect(() => {
    setWebgl(detectWebGL());
  }, []);

  const containerRef = useRef<HTMLDivElement>(null);
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

  // Keyboard path: arrow keys answer binary items with the same fling.
  useEffect(() => {
    if (!enabled || !swipeable) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        flingForChoice(0);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        flingForChoice(1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled, swipeable, flingForChoice]);

  const m = motion.current;
  const topIsImage = isImageMaterial(item.material);
  const anyImageVisible = useMemo(
    () => topIsImage || nextItems.some((n) => isImageMaterial(n.material)),
    [topIsImage, nextItems],
  );
  const useGL = webgl && (deckHasImages ?? anyImageVisible);
  const glImageUrl = useGL && topIsImage && !m.exited ? item.material : null;
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
  // Non-GL stimuli (text cards, or GL disabled): visible on DOM commit.
  useEffect(() => {
    if (!glImageUrl) onStimulusReady?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id, glImageUrl === null]);

  const topTransform = `translate3d(${m.x}px, ${m.y}px, 0) rotate(${m.rot}deg)`;
  const promoteTransition = "transform 340ms cubic-bezier(0.2, 1.4, 0.4, 1), opacity 340ms ease";

  return (
    <div data-testid="swipe-deck" data-webgl={useGL ? "1" : "0"}>
      <div
        ref={containerRef}
        onPointerMove={onDeckPointerMove}
        style={{
          position: "relative",
          width: "100%",
          height: "min(56vh, 460px)",
          minHeight: 320,
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
              <CardBody item={n} hideImage={false} />
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
            transition: m.dragging || m.exiting ? "none" : "transform 40ms linear",
            visibility: m.exited ? "hidden" : "visible",
            cursor: swipeable ? (m.dragging ? "grabbing" : "grab") : "default",
            touchAction: swipeable ? "none" : "auto",
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
              />
            </Suspense>
          </div>
        )}
      </div>

      {/* Mapping legend — swipe left = options[0], right = options[1];
          the buttons are also the click/AT path and fire the same fling. */}
      {swipeable ? (
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: "0.6rem",
            marginTop: "0.9rem",
            alignItems: "center",
          }}
        >
          <span aria-hidden style={{ color: "var(--muted)", fontSize: "1.1rem" }}>←</span>
          <button
            lang={lang}
            onClick={() => flingForChoice(0)}
            disabled={!enabled}
            style={legendBtn("#f87171")}
          >
            {item.options[0]}
          </button>
          <span style={{ color: "var(--muted)", fontSize: "0.75rem", whiteSpace: "nowrap" }}>
            swipe or ← / →
          </span>
          <button
            lang={lang}
            onClick={() => flingForChoice(1)}
            disabled={!enabled}
            style={legendBtn("#4ade80")}
          >
            {item.options[1]}
          </button>
          <span aria-hidden style={{ color: "var(--muted)", fontSize: "1.1rem" }}>→</span>
        </div>
      ) : (
        <div style={{ display: "grid", gap: "0.5rem", marginTop: "0.9rem" }}>
          {item.options.map((opt, i) => (
            <button
              key={i}
              lang={lang}
              onClick={() => onChoose(i)}
              disabled={!enabled}
              style={{
                background: "transparent",
                color: "var(--fg)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                padding: "0.55rem 0.9rem",
                fontSize: "0.92rem",
                textAlign: "left",
                cursor: enabled ? "pointer" : "default",
              }}
            >
              {opt}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function legendBtn(color: string): CSSProperties {
  return {
    flex: 1,
    background: "transparent",
    color,
    border: `1px solid ${color}`,
    borderRadius: 8,
    padding: "0.5rem 0.7rem",
    fontSize: "0.88rem",
    cursor: "pointer",
    minWidth: 0,
  };
}
