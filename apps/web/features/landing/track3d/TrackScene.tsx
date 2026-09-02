"use client";

/**
 * One landing scene slot. Decorative only (aria-hidden) — the band copy
 * carries the meaning. Renders the existing CSS TrackVisuals preview until
 * (and unless) WebGL is confirmed and the lazy three.js module arrives;
 * jsdom, non-WebGL browsers, and the SSR pass therefore never touch three.
 */
import { useEffect, useState, type ComponentType } from "react";
import { TRACK_VIZ } from "../TrackVisuals";
import {
  loadSceneModule,
  type SceneCanvasProps,
  type SceneId,
} from "./registry";
import { supportsWebGL, usePrefersReducedMotion, useSceneVisibility } from "./presence";

export function TrackScene({ id }: { id: SceneId }) {
  const { ref, visible } = useSceneVisibility<HTMLDivElement>();
  const reducedMotion = usePrefersReducedMotion();
  const [hovered, setHovered] = useState(false);
  const [SceneCanvas, setSceneCanvas] = useState<ComponentType<SceneCanvasProps> | null>(null);

  // Load the WebGL module only once the scene has been on screen at least
  // once AND the device can actually run it.
  useEffect(() => {
    if (!visible || SceneCanvas || !supportsWebGL()) return;
    let alive = true;
    loadSceneModule()
      .then((m) => {
        if (alive) setSceneCanvas(() => m.SceneCanvas);
      })
      .catch(() => {
        /* stay on the CSS fallback */
      });
    return () => {
      alive = false;
    };
  }, [visible, SceneCanvas]);

  const Fallback = TRACK_VIZ[id];
  return (
    <div
      ref={ref}
      className="track-scene"
      data-testid={`scene-${id.toLowerCase()}`}
      aria-hidden="true"
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
    >
      {SceneCanvas ? (
        <SceneCanvas id={id} active={visible} reducedMotion={reducedMotion} hovered={hovered} />
      ) : (
        <Fallback />
      )}
    </div>
  );
}
