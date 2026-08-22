"use client";
/**
 * CardScene — WebGL layer for image cards (three.js via @react-three/fiber).
 *
 * ONE persistent Canvas lives for the whole deck (mounted once by
 * SwipeDeck, never remounted per card). The top image card is a
 * PlaneGeometry (24x32 segments) whose vertex shader bends the card along
 * the drag direction (curl ∝ drag velocity, easing back on release), with
 * a soft blurred shadow plane underneath and a slight parallax tilt from
 * the pointer position. Orthographic camera at zoom 1 → world units = px,
 * so the mesh tracks the DOM gesture layer exactly.
 *
 * WebGL discipline: DPR capped at 2, textures loaded with max anisotropy,
 * disposed on unmount. This module is loaded lazily (React.lazy) so SSR /
 * static export never touches three.
 */
import { Suspense, useEffect, useMemo, useRef } from "react";
import type { MutableRefObject } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useTexture } from "@react-three/drei";
import * as THREE from "three";
import type { CardMotion } from "./useSwipeCard.js";

export interface ParallaxTarget {
  /** -1..1 pointer position over the deck. */
  x: number;
  y: number;
}

export interface CardSceneProps {
  /** data: or same-origin URL of the top card's image; null hides the mesh. */
  imageUrl: string | null;
  motion: MutableRefObject<CardMotion>;
  parallax: MutableRefObject<ParallaxTarget>;
  /** CSS pixel size of the image slot the plane must fill. */
  width: number;
  height: number;
  /** Slot center offset (px) from the container center — aligns the plane to
      the DOM image slot inside the card (stem stays DOM-rendered above). */
  offsetX?: number;
  offsetY?: number;
  /** Fired once the texture for imageUrl is decoded and the mesh is visible. */
  onTextureReady?: (imageUrl: string) => void;
  /** Fired if the WebGL context is lost — callers must fall back to DOM. */
  onContextLost?: () => void;
}

const DEG = Math.PI / 180;

const CARD_VERT = /* glsl */ `
  uniform float uCurl;
  uniform float uDir;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vec3 p = position;
    float arc = sin(uv.x * 3.14159265);
    // Cloth-like curl along the drag axis + a slight directional fold.
    p.z += uCurl * uDir * arc * 26.0;
    p.z += uCurl * uDir * (uv.x - 0.5) * 14.0;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;

const CARD_FRAG = /* glsl */ `
  uniform sampler2D uMap;
  varying vec2 vUv;
  void main() {
    vec4 c = texture2D(uMap, vUv);
    gl_FragColor = c;
  }
`;

const SHADOW_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const SHADOW_FRAG = /* glsl */ `
  uniform float uOpacity;
  varying vec2 vUv;
  void main() {
    float d = length((vUv - 0.5) * 2.0);
    float a = (1.0 - smoothstep(0.35, 1.0, d)) * uOpacity;
    gl_FragColor = vec4(0.0, 0.0, 0.0, a);
  }
`;

function CardMesh({ imageUrl, motion, parallax, width, height, offsetX = 0, offsetY = 0, onTextureReady }: CardSceneProps & { imageUrl: string }) {
  const gl = useThree((s) => s.gl);
  const texture = useTexture(imageUrl);
  const mesh = useRef<THREE.Mesh>(null);
  const shadow = useRef<THREE.Mesh>(null);
  const curl = useRef(0);

  useEffect(() => {
    texture.anisotropy = gl.capabilities.getMaxAnisotropy();
    texture.needsUpdate = true;
  }, [texture, gl]);

  // useTexture suspends until decode completes, so first mount for this url
  // means the stimulus is actually visible — anchor latency/exposure here.
  useEffect(() => {
    onTextureReady?.(imageUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageUrl]);

  // contain-fit: preserve the image's aspect ratio inside the card box
  // (mirrors the DOM path's objectFit: "contain") instead of stretching.
  const img = texture.image as { width?: number; height?: number } | undefined;
  const fit = useMemo(() => {
    const iw = img?.width ?? width;
    const ih = img?.height ?? height;
    const scale = Math.min(width / iw, height / ih);
    return { w: iw * scale, h: ih * scale };
  }, [img?.width, img?.height, width, height]);

  const cardMaterial = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: CARD_VERT,
        fragmentShader: CARD_FRAG,
        uniforms: {
          uMap: { value: texture },
          uCurl: { value: 0 },
          uDir: { value: 1 },
        },
        transparent: true,
      }),
    [texture],
  );

  const shadowMaterial = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: SHADOW_VERT,
        fragmentShader: SHADOW_FRAG,
        uniforms: { uOpacity: { value: 0.45 } },
        transparent: true,
        depthWrite: false,
      }),
    [],
  );

  // Dispose GPU resources on unmount (and when the texture/url changes).
  useEffect(() => {
    return () => {
      cardMaterial.dispose();
      texture.dispose();
      useTexture.clear(imageUrl);
    };
  }, [cardMaterial, texture, imageUrl]);
  useEffect(() => () => shadowMaterial.dispose(), [shadowMaterial]);

  useFrame((_, dt) => {
    const m = motion.current;
    const p = parallax.current;
    if (mesh.current) {
      mesh.current.position.x = m.x + offsetX;
      mesh.current.position.y = -m.y - offsetY;
      mesh.current.rotation.z = -m.rot * DEG;
      // Parallax tilt from pointer position (subtle).
      const targetRX = p.y * 0.08;
      const targetRY = -p.x * 0.1;
      mesh.current.rotation.x += (targetRX - mesh.current.rotation.x) * Math.min(1, dt * 8);
      mesh.current.rotation.y += (targetRY - mesh.current.rotation.y) * Math.min(1, dt * 8);
    }
    // Curl eases toward the gesture's target intensity, back to 0 on rest.
    curl.current += (m.curl - curl.current) * Math.min(1, dt * 10);
    cardMaterial.uniforms.uCurl.value = curl.current;
    cardMaterial.uniforms.uDir.value = m.vx < 0 || (m.vx === 0 && m.x < 0) ? -1 : 1;
    if (shadow.current) {
      shadow.current.position.x = m.x * 1.06 + offsetX;
      shadow.current.position.y = -m.y - 14 - offsetY;
      shadow.current.rotation.z = -m.rot * DEG;
      const lift = Math.min(1, Math.abs(m.x) / 200 + curl.current);
      (shadowMaterial.uniforms.uOpacity as { value: number }).value = 0.35 + lift * 0.2;
      const s = 1 + lift * 0.08;
      shadow.current.scale.set(s, s, 1);
    }
  });

  return (
    <group>
      <mesh ref={shadow} position={[0, -14, -30]} material={shadowMaterial}>
        <planeGeometry args={[fit.w * 1.15, fit.h * 1.15]} />
      </mesh>
      <mesh ref={mesh} material={cardMaterial}>
        <planeGeometry args={[fit.w, fit.h, 24, 32]} />
      </mesh>
    </group>
  );
}

/**
 * The canvas is purely presentational (pointerEvents: none), so the default
 * pointer-event manager is dead weight — and its connect() races a fast
 * unmount: answering a card quickly can tear the container down while r3f is
 * still attaching DOM listeners, throwing "addEventListener of null". An
 * inert manager never touches the DOM.
 */
const inertEvents = () => ({
  enabled: false,
  priority: 0,
  connected: false,
  handlers: {},
  connect: () => {},
  disconnect: () => {},
  update: () => {},
});

export default function CardScene(props: CardSceneProps) {
  return (
    <Canvas
      events={inertEvents as never}
      orthographic
      flat
      // ALWAYS: toggling to "never" between cards raced the texture-ready
      // callback — the DOM img was already swapped out (opacity 0) while the
      // canvas never drew another frame, leaving a blank card (live bug).
      frameloop="always"
      dpr={[1, 2]}
      camera={{ position: [0, 0, 300], zoom: 1, near: 0.1, far: 1000 }}
      gl={{ alpha: true, antialias: true, powerPreference: "low-power" }}
      onCreated={(state) => {
        // Context loss (mobile GPUs, tab switches) would blank the deck while
        // the DOM stimulus stays hidden — surface it so the deck falls back.
        state.gl.domElement.addEventListener("webglcontextlost", (e) => {
          e.preventDefault();
          props.onContextLost?.();
        });
      }}
      style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
    >
      {props.imageUrl ? (
        <Suspense fallback={null}>
          <CardMesh {...props} imageUrl={props.imageUrl} />
        </Suspense>
      ) : null}
    </Canvas>
  );
}
