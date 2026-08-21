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
  /** CSS pixel size of the card surface. */
  width: number;
  height: number;
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

function CardMesh({ imageUrl, motion, parallax, width, height }: CardSceneProps & { imageUrl: string }) {
  const gl = useThree((s) => s.gl);
  const texture = useTexture(imageUrl);
  const mesh = useRef<THREE.Mesh>(null);
  const shadow = useRef<THREE.Mesh>(null);
  const curl = useRef(0);

  useEffect(() => {
    texture.anisotropy = gl.capabilities.getMaxAnisotropy();
    texture.needsUpdate = true;
  }, [texture, gl]);

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
      mesh.current.position.x = m.x;
      mesh.current.position.y = -m.y;
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
      shadow.current.position.x = m.x * 1.06;
      shadow.current.position.y = -m.y - 14;
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
        <planeGeometry args={[width * 1.15, height * 1.15]} />
      </mesh>
      <mesh ref={mesh} material={cardMaterial}>
        <planeGeometry args={[width, height, 24, 32]} />
      </mesh>
    </group>
  );
}

export default function CardScene(props: CardSceneProps) {
  return (
    <Canvas
      orthographic
      flat
      dpr={[1, 2]}
      camera={{ position: [0, 0, 300], zoom: 1, near: 0.1, far: 1000 }}
      gl={{ alpha: true, antialias: true, powerPreference: "low-power" }}
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
