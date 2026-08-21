"use client";

/**
 * The four landing WebGL scenes. This module is the far side of the lazy
 * boundary in ./registry — it is the ONLY file in apps/web that imports
 * `three` / `@react-three/fiber`, and it is loaded exclusively from a
 * client-side effect after a WebGL capability check.
 *
 * GPU budget: one small Canvas per band, low-power context; offscreen or
 * reduced-motion scenes fall back to frameloop="demand" (a single posed
 * frame, no loop). DPR renders at the device ratio up to 2 — rendering
 * below devicePixelRatio upscales and reads as grain; the budget levers
 * are the paused frameloop and scene size, not DPR.
 *
 * Anti-grain rules (user-reported): textures get sRGB + mipmaps +
 * anisotropy; edges are THICK GEOMETRY (inverted-hull rims, beam frames),
 * never 1px GL lines, which alias at any DPR.
 */
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { t2VisualMedia } from "../TrackVisuals";
import type { SceneCanvasProps, SceneId } from "./registry";

const ACCENT = "#5b8cff";
const ACCENT_DIM = "#2d4a99";
const SLAB = "#141821";
const GOOD = "#4ade80";
const BAD = "#f87171";

/** Fixed pose time used when prefers-reduced-motion is set. */
const POSE_T = 4.6;

interface SceneProps {
  speed: number;
  reducedMotion: boolean;
}

/** Own clock: hover scales speed without jumping phase; reduced-motion pins the pose. */
function useSceneTime(speed: number, reducedMotion: boolean): () => number {
  const t = useRef(POSE_T);
  useFrame((_, delta) => {
    if (!reducedMotion) t.current += Math.min(delta, 0.1) * speed;
  });
  return () => t.current;
}

/** Pointer parallax: ease the group toward the pointer each frame. */
function useParallax(ref: React.RefObject<THREE.Group | null>, strength = 0.22) {
  useFrame(({ pointer }) => {
    const g = ref.current;
    if (!g) return;
    g.rotation.y += (pointer.x * strength - g.rotation.y) * 0.06;
    g.rotation.x += (-pointer.y * strength * 0.6 - g.rotation.x) * 0.06;
  });
}

function easeInOut(x: number): number {
  const c = Math.min(1, Math.max(0, x));
  return c * c * (3 - 2 * c);
}

/** Text stamp/glyph as a canvas-backed sprite texture. */
function crispTexture<T extends THREE.Texture>(tex: T, maxAniso = 8): T {
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = maxAniso;
  return tex;
}

function makeLabelTexture(text: string, color: string): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.clearRect(0, 0, 256, 128);
    ctx.strokeStyle = color;
    ctx.lineWidth = 6;
    ctx.strokeRect(10, 14, 236, 100);
    ctx.fillStyle = color;
    ctx.font = "bold 64px ui-monospace, Menlo, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, 128, 68);
  }
  return crispTexture(new THREE.CanvasTexture(canvas));
}

function makeCheckTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.strokeStyle = GOOD;
    ctx.lineWidth = 14;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(28, 68);
    ctx.lineTo(54, 96);
    ctx.lineTo(102, 34);
    ctx.stroke();
  }
  return crispTexture(new THREE.CanvasTexture(canvas));
}

/** Rim thickness for inverted-hull outlines (world units). */
const RIM = 0.022;

/**
 * A slab (mesh) plus a thick accent rim. The rim is an inverted hull —
 * the same box scaled out by RIM and rendered BackSide — so the edge
 * reads as a solid glow band instead of an aliasing 1px GL line.
 */
function Slab({
  size,
  color = SLAB,
  edge = ACCENT,
  edgeOpacity = 0.9,
}: {
  size: [number, number, number];
  color?: string;
  edge?: string;
  edgeOpacity?: number;
}) {
  const geo = useMemo(() => new THREE.BoxGeometry(...size), [size]);
  const rimScale = useMemo(
    () =>
      [
        (size[0] + RIM * 2) / size[0],
        (size[1] + RIM * 2) / size[1],
        (size[2] + RIM * 2) / size[2],
      ] as [number, number, number],
    [size],
  );
  return (
    <group>
      <mesh geometry={geo}>
        <meshBasicMaterial color={color} />
      </mesh>
      <mesh geometry={geo} scale={rimScale}>
        <meshBasicMaterial color={edge} side={THREE.BackSide} transparent opacity={edgeOpacity} />
      </mesh>
    </group>
  );
}

/** A flat rectangular frame built from four beam boxes (thick, alias-free). */
function BeamFrame({
  w,
  h,
  t = 0.05,
  depth = 0.05,
  color = ACCENT,
  opacity = 1,
}: {
  w: number;
  h: number;
  t?: number;
  depth?: number;
  color?: string;
  opacity?: number;
}) {
  return (
    <group>
      <mesh position={[0, h / 2 - t / 2, 0]}>
        <boxGeometry args={[w, t, depth]} />
        <meshBasicMaterial color={color} transparent opacity={opacity} />
      </mesh>
      <mesh position={[0, -h / 2 + t / 2, 0]}>
        <boxGeometry args={[w, t, depth]} />
        <meshBasicMaterial color={color} transparent opacity={opacity} />
      </mesh>
      <mesh position={[-w / 2 + t / 2, 0, 0]}>
        <boxGeometry args={[t, h - t * 2, depth]} />
        <meshBasicMaterial color={color} transparent opacity={opacity} />
      </mesh>
      <mesh position={[w / 2 - t / 2, 0, 0]}>
        <boxGeometry args={[t, h - t * 2, depth]} />
        <meshBasicMaterial color={color} transparent opacity={opacity} />
      </mesh>
    </group>
  );
}

// ---- T1 · Creative Build: wire rects assemble into a tiny 3D site --------

const T1_SLABS: { size: [number, number, number]; to: [number, number, number]; from: [number, number, number] }[] = [
  { size: [2.5, 0.78, 0.1], to: [0, 0.62, 0.05], from: [-2.2, 1.9, -1.6] }, // hero slab
  { size: [0.76, 0.6, 0.1], to: [-0.87, -0.28, 0.05], from: [-2.4, -1.7, 1.2] },
  { size: [0.76, 0.6, 0.1], to: [0, -0.28, 0.05], from: [0.4, -2.3, -1.8] },
  { size: [0.76, 0.6, 0.1], to: [0.87, -0.28, 0.05], from: [2.6, -1.2, 1.5] },
];

function T1Scene({ speed, reducedMotion }: SceneProps) {
  const group = useRef<THREE.Group>(null);
  const spin = useRef<THREE.Group>(null);
  const slabs = useRef<(THREE.Group | null)[]>([]);
  const time = useSceneTime(speed, reducedMotion);
  useParallax(group);
  useFrame(() => {
    const t = time();
    const cycle = (t % 9) / 9; // assemble → hold → scatter
    const p =
      cycle < 0.45 ? easeInOut(cycle / 0.45) : cycle < 0.8 ? 1 : 1 - easeInOut((cycle - 0.8) / 0.2);
    T1_SLABS.forEach((s, i) => {
      const g = slabs.current[i];
      if (!g) return;
      const k = easeInOut(Math.min(1, Math.max(0, p * 1.6 - i * 0.18)));
      g.position.set(
        s.from[0] + (s.to[0] - s.from[0]) * k,
        s.from[1] + (s.to[1] - s.from[1]) * k,
        s.from[2] + (s.to[2] - s.from[2]) * k,
      );
      g.rotation.set((1 - k) * 1.8, (1 - k) * 2.4, 0);
    });
    if (spin.current) spin.current.rotation.y = Math.sin(t * 0.25) * 0.34;
  });
  return (
    <group ref={group}>
      <group ref={spin}>
        {/* browser frame: front + receded back beam rects give the 3D wire read */}
        <group position={[0, 0, 0.12]}>
          <BeamFrame w={3.1} h={2.3} t={0.045} depth={0.045} color={ACCENT} opacity={0.85} />
        </group>
        <group position={[0, 0, -0.12]}>
          <BeamFrame w={3.1} h={2.3} t={0.045} depth={0.045} color={ACCENT_DIM} opacity={0.8} />
        </group>
        {/* chrome bar */}
        <mesh position={[0, 1.02, 0.06]}>
          <planeGeometry args={[3.04, 0.16]} />
          <meshBasicMaterial color={ACCENT_DIM} transparent opacity={0.5} />
        </mesh>
        {T1_SLABS.map((s, i) => (
          <group key={i} ref={(el) => { slabs.current[i] = el; }}>
            <Slab size={s.size} edgeOpacity={i === 0 ? 1 : 0.7} />
          </group>
        ))}
      </group>
    </group>
  );
}

// ---- T2 · Authenticity: real snapshot photos orbit; a stamp slaps on -----

function T2Scene({ speed, reducedMotion }: SceneProps) {
  const group = useRef<THREE.Group>(null);
  const time = useSceneTime(speed, reducedMotion);
  useParallax(group, 0.3);
  const invalidate = useThree((s) => s.invalidate);
  const gl = useThree((s) => s.gl);
  const media = useMemo(() => t2VisualMedia().slice(0, 2), []);
  const textures = useMemo(() => {
    const maxAniso = Math.min(8, gl.capabilities.getMaxAnisotropy());
    return media.map((m) =>
      crispTexture(
        new THREE.TextureLoader().load(m.src, () => invalidate()),
        maxAniso,
      ),
    );
  }, [media, invalidate, gl]);
  const stamps = useMemo(
    () => media.map((m) => makeLabelTexture(m.real ? "REAL" : "AI", m.real ? GOOD : BAD)),
    [media],
  );
  const planes = useRef<(THREE.Group | null)[]>([]);
  const mats = useRef<(THREE.MeshBasicMaterial | null)[]>([]);
  const stampSprites = useRef<(THREE.Sprite | null)[]>([]);
  useFrame(() => {
    const t = time();
    media.forEach((_, i) => {
      const g = planes.current[i];
      const mat = mats.current[i];
      const sprite = stampSprites.current[i];
      if (!g || !mat) return;
      const a = t * 0.55 + i * Math.PI; // shared axis, opposite phase
      const z = Math.sin(a);
      g.position.set(Math.cos(a) * 1.15, Math.sin(t * 0.8 + i) * 0.08, z * 0.75);
      const depth = (z + 1) / 2; // 0 back … 1 front
      const s = 0.72 + depth * 0.42;
      g.scale.setScalar(s);
      mat.opacity = 0.35 + depth * 0.65;
      // periodically the front plane tilts forward and the stamp slaps on
      const phase = (t + i * 3.5) % 7;
      const slapIn = phase > 4.6 && phase < 6.4 ? easeInOut((phase - 4.6) / 0.5) : 0;
      const slap = slapIn * (phase > 6.0 ? 1 - easeInOut((phase - 6.0) / 0.4) : 1);
      g.rotation.x = -0.38 * slap * depth;
      if (sprite) {
        const pop = slap * depth;
        sprite.scale.set(0.62 * (1.6 - 0.6 * pop), 0.31 * (1.6 - 0.6 * pop), 1);
        (sprite.material as THREE.SpriteMaterial).opacity = pop;
      }
    });
  });
  return (
    <group ref={group}>
      {media.map((m, i) => (
        <group key={m.src} ref={(el) => { planes.current[i] = el; }}>
          <mesh>
            <planeGeometry args={[1.5, 1.05]} />
            <meshBasicMaterial
              ref={(el) => { mats.current[i] = el; }}
              map={textures[i]}
              transparent
              toneMapped={false}
            />
          </mesh>
          <sprite ref={(el) => { stampSprites.current[i] = el; }} position={[-0.42, 0.28, 0.12]}>
            <spriteMaterial map={stamps[i]} transparent opacity={0} depthTest={false} />
          </sprite>
        </group>
      ))}
    </group>
  );
}

// ---- T3 · Reasoning: a chat bubble shatters and reassembles corrected ----

function roundedRectGeo(w: number, h: number, r: number): THREE.ShapeGeometry {
  const s = new THREE.Shape();
  s.moveTo(-w / 2 + r, -h / 2);
  s.lineTo(w / 2 - r, -h / 2);
  s.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r);
  s.lineTo(w / 2, h / 2 - r);
  s.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2);
  s.lineTo(-w / 2 + r, h / 2);
  s.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r);
  s.lineTo(-w / 2, -h / 2 + r);
  s.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2);
  return new THREE.ShapeGeometry(s);
}

function Bubble({ w, h, edge }: { w: number; h: number; edge: string }) {
  // Fill plate on top of a slightly larger edge-colored plate: a thick,
  // alias-free outline (flat shapes cannot use the inverted-hull trick).
  const geo = useMemo(() => roundedRectGeo(w, h, 0.12), [w, h]);
  const rim = useMemo(() => roundedRectGeo(w + RIM * 2.4, h + RIM * 2.4, 0.13), [w, h]);
  return (
    <group>
      <mesh geometry={rim} position={[0, 0, -0.004]}>
        <meshBasicMaterial color={edge} transparent opacity={0.9} />
      </mesh>
      <mesh geometry={geo} position={[0, 0, 0.004]}>
        <meshBasicMaterial color={SLAB} />
      </mesh>
    </group>
  );
}

const SHARDS: [number, number][] = [
  [-0.45, 0.14],
  [0.45, 0.14],
  [-0.45, -0.14],
  [0.45, -0.14],
];

function T3Scene({ speed, reducedMotion }: SceneProps) {
  const group = useRef<THREE.Group>(null);
  const time = useSceneTime(speed, reducedMotion);
  useParallax(group);
  const shardRefs = useRef<(THREE.Group | null)[]>([]);
  const fixedRef = useRef<THREE.Group>(null);
  const checkRef = useRef<THREE.Sprite>(null);
  const checkTex = useMemo(() => makeCheckTexture(), []);
  useFrame(() => {
    const t = time();
    const cycle = (t % 8) / 8;
    // 0–0.3 intact wrong bubble · 0.3–0.55 shatter · 0.55–0.85 corrected · fade
    const burst = cycle < 0.3 ? 0 : cycle < 0.55 ? easeInOut((cycle - 0.3) / 0.25) : 1;
    const heal = cycle < 0.55 ? 0 : cycle < 0.85 ? easeInOut((cycle - 0.55) / 0.3) : 1;
    SHARDS.forEach(([sx, sy], i) => {
      const g = shardRefs.current[i];
      if (!g) return;
      const fly = burst * (1 - heal * 0);
      g.position.set(sx + sx * fly * 1.4, 0.12 + sy + sy * fly * 2.2, fly * 0.5);
      g.rotation.z = fly * (i % 2 === 0 ? 0.8 : -0.8);
      g.scale.setScalar(1 - heal); // shards give way to the corrected bubble
      g.visible = heal < 0.98;
    });
    if (fixedRef.current) {
      fixedRef.current.scale.setScalar(0.2 + 0.8 * heal);
      fixedRef.current.visible = heal > 0.02;
    }
    if (checkRef.current) {
      const rise = Math.max(0, heal - 0.3) / 0.7;
      checkRef.current.position.y = 0.55 + rise * 0.45;
      (checkRef.current.material as THREE.SpriteMaterial).opacity = rise;
    }
    if (group.current) group.current.position.y = Math.sin(t * 0.7) * 0.06;
  });
  return (
    <group ref={group}>
      {/* stacked conversation */}
      <group position={[-0.55, 0.95, -0.35]}>
        <Bubble w={1.5} h={0.5} edge={ACCENT_DIM} />
      </group>
      <group position={[0.7, -0.75, -0.2]}>
        <Bubble w={1.3} h={0.44} edge={ACCENT_DIM} />
      </group>
      {/* the wrong claim: four shards */}
      {SHARDS.map(([sx, sy], i) => (
        <group key={i} ref={(el) => { shardRefs.current[i] = el; }} position={[sx, 0.12 + sy, 0]}>
          <Bubble w={0.9} h={0.28} edge={BAD} />
        </group>
      ))}
      {/* the corrected bubble */}
      <group ref={fixedRef} position={[0, 0.12, 0.05]}>
        <Bubble w={1.9} h={0.58} edge={GOOD} />
      </group>
      <sprite ref={checkRef} position={[0.95, 0.55, 0.3]} scale={[0.4, 0.4, 1]}>
        <spriteMaterial map={checkTex} transparent opacity={0} depthTest={false} />
      </sprite>
    </group>
  );
}

// ---- T4 · Direction: noisy tiles settle sharp; one gets the frame --------

const T4_VERT = /* glsl */ `
  uniform float uT;
  uniform float uSharp;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vec3 p = position;
    float n = sin(p.x * 7.0 + uT) * sin(p.y * 5.0 - uT * 1.3)
            + 0.5 * sin(p.x * 13.0 - uT * 0.7);
    p.z += n * (1.0 - uSharp) * 0.16;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;

const T4_FRAG = /* glsl */ `
  uniform float uT;
  uniform float uSharp;
  varying vec2 vUv;
  void main() {
    float grain = fract(sin(dot(vUv * (40.0 - 30.0 * uSharp), vec2(12.9898, 78.233)) + uT) * 43758.5453);
    vec3 deep = vec3(0.055, 0.075, 0.106);   // #0e1319
    vec3 blue = vec3(0.177, 0.290, 0.600);   // accent-dim-ish
    vec3 base = mix(deep, blue, vUv.y * 0.7 + 0.15 * sin(uT * 0.3 + vUv.x * 4.0));
    vec3 noisy = mix(base, vec3(grain * 0.35), (1.0 - uSharp) * 0.6);
    gl_FragColor = vec4(noisy, 1.0);
  }
`;

const T4_POS: [number, number][] = [
  [-0.52, 0.52],
  [0.52, 0.52],
  [-0.52, -0.52],
  [0.52, -0.52],
];
const CHOSEN = 3;

function T4Scene({ speed, reducedMotion }: SceneProps) {
  const group = useRef<THREE.Group>(null);
  const time = useSceneTime(speed, reducedMotion);
  useParallax(group);
  const mats = useRef<(THREE.ShaderMaterial | null)[]>([]);
  const frameMat = useMemo(
    () => new THREE.MeshBasicMaterial({ color: ACCENT, transparent: true, opacity: 0 }),
    [],
  );
  const pips = useRef<(THREE.Mesh | null)[]>([]);
  const frameGeos = useMemo(() => {
    const t = 0.045;
    const wide = new THREE.BoxGeometry(1.06, t, t);
    const tall = new THREE.BoxGeometry(t, 1.06 - t * 2, t);
    return { wide, tall, t };
  }, []);
  useFrame(() => {
    const t = time();
    const cycle = (t % 10) / 10;
    T4_POS.forEach((_, i) => {
      const m = mats.current[i];
      if (!m) return;
      // tiles settle sharp one-by-one, then everything relaxes noisy again
      const start = 0.08 + i * 0.14;
      const sharp =
        cycle < start ? 0 : cycle < start + 0.12 ? easeInOut((cycle - start) / 0.12) : cycle < 0.9 ? 1 : 0;
      m.uniforms.uT.value = t;
      m.uniforms.uSharp.value = sharp;
    });
    frameMat.opacity = cycle > 0.72 && cycle < 0.9 ? easeInOut((cycle - 0.72) / 0.08) : 0;
    pips.current.forEach((p, i) => {
      if (!p) return;
      const a = t * 0.9 + (i * Math.PI * 2) / 3;
      p.position.set(Math.cos(a) * 1.55, Math.sin(a) * 1.15, Math.sin(a * 1.3) * 0.3);
    });
  });
  return (
    <group ref={group}>
      {T4_POS.map(([x, y], i) => (
        <mesh key={i} position={[x, y, 0]}>
          <planeGeometry args={[0.96, 0.96, 24, 24]} />
          <shaderMaterial
            ref={(el) => { mats.current[i] = el; }}
            vertexShader={T4_VERT}
            fragmentShader={T4_FRAG}
            uniforms={{ uT: { value: 0 }, uSharp: { value: 0 } }}
          />
        </mesh>
      ))}
      {/* the chosen tile's highlight frame (thick beams, shared fading material) */}
      <group position={[T4_POS[CHOSEN][0], T4_POS[CHOSEN][1], 0.09]}>
        <mesh geometry={frameGeos.wide} material={frameMat} position={[0, 0.53 - frameGeos.t / 2, 0]} />
        <mesh geometry={frameGeos.wide} material={frameMat} position={[0, -0.53 + frameGeos.t / 2, 0]} />
        <mesh geometry={frameGeos.tall} material={frameMat} position={[-0.53 + frameGeos.t / 2, 0, 0]} />
        <mesh geometry={frameGeos.tall} material={frameMat} position={[0.53 - frameGeos.t / 2, 0, 0]} />
      </group>
      {/* three quota pips */}
      {[0, 1, 2].map((i) => (
        <mesh key={i} ref={(el) => { pips.current[i] = el; }}>
          <sphereGeometry args={[0.045, 12, 12]} />
          <meshBasicMaterial color={ACCENT} />
        </mesh>
      ))}
    </group>
  );
}

// ---- shared canvas -------------------------------------------------------

const SCENES: Record<SceneId, (p: SceneProps) => React.JSX.Element> = {
  T1: T1Scene,
  T2: T2Scene,
  T3: T3Scene,
  T4: T4Scene,
};

export function SceneCanvas({ id, active, reducedMotion, hovered }: SceneCanvasProps) {
  const Scene = SCENES[id];
  return (
    <Canvas
      dpr={[1, 2]}
      frameloop={active && !reducedMotion ? "always" : "demand"}
      camera={{ position: [0, 0, 4.1], fov: 40 }}
      gl={{ alpha: true, antialias: true, powerPreference: "low-power" }}
    >
      <Scene speed={hovered ? 1.9 : 1} reducedMotion={reducedMotion} />
    </Canvas>
  );
}
