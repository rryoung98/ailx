/**
 * Scene registry for the landing track visualizations.
 *
 * SSR-safety contract: this module (and everything the landing page imports
 * statically) must NEVER import `three` or `@react-three/fiber`. The WebGL
 * scenes live in `./scenes` and are reachable ONLY through the dynamic
 * `loadSceneModule()` boundary below, so the server graph and the initial
 * client bundle stay three-free. `test/track3d.test.tsx` pins this.
 */
import type { ComponentType } from "react";

export type SceneId = "T1" | "T2" | "T3" | "T4";

export const SCENE_IDS: readonly SceneId[] = ["T1", "T2", "T3", "T4"] as const;

/** Props every lazily-loaded scene canvas accepts (three-free contract). */
export interface SceneCanvasProps {
  id: SceneId;
  /** In-viewport: drives the render loop; offscreen scenes render one frame. */
  active: boolean;
  /** prefers-reduced-motion: render a single static posed frame, no loop. */
  reducedMotion: boolean;
  /** Pointer over the band: the scene animates faster. */
  hovered: boolean;
}

export interface SceneModule {
  SceneCanvas: ComponentType<SceneCanvasProps>;
}

/** The ONLY entry to the three.js code path. Call from effects, never SSR. */
export function loadSceneModule(): Promise<SceneModule> {
  return import("./scenes");
}
