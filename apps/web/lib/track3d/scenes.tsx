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
 * Look (user-directed "paper realism" pass): every scene is built from
 * lit paper-white surfaces (meshStandardMaterial under one directional
 * light + ambient fill) with deep-green accents and soft blurred shadow
 * planes, floating on the page cream — no flat unlit black slabs.
 *
 * Anti-grain rules (user-reported): textures get sRGB + mipmaps +
 * anisotropy; edges are THICK GEOMETRY (extruded bevels, beam frames),
 * never 1px GL lines, which alias at any DPR.
 */
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { t2VisualMedia } from "../TrackVisuals";
import type { SceneCanvasProps, SceneId } from "./registry";

/* Paper palette: white cards + cream slabs + deep-green accents on the
   page cream (canvas stays transparent; the paper shows through). */
const PAPER = "#fdfcfa";
const CREAM = "#f0e9dd";
const INK = "#33302b";
const ACCENT = "#0b6b47";
const ACCENT_SOFT = "#bcd9cc";
const GOOD = "#0b6b47";
const BAD = "#b91c1c";

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

/** Springy overshoot for pops (checkmark, stamps). */
function easeOutBack(x: number): number {
  const c = Math.min(1, Math.max(0, x));
  const k = 1.70158;
  return 1 + (k + 1) * Math.pow(c - 1, 3) + k * Math.pow(c - 1, 2);
}

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
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(64, 64, 56, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = GOOD;
    ctx.lineWidth = 14;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(34, 68);
    ctx.lineTo(56, 92);
    ctx.lineTo(96, 40);
    ctx.stroke();
  }
  return crispTexture(new THREE.CanvasTexture(canvas));
}

/** Soft radial shadow blob — the "blurred drop shadow" under every card. */
function makeShadowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const g = ctx.createRadialGradient(64, 64, 6, 64, 64, 62);
    g.addColorStop(0, "rgba(26, 26, 26, 0.34)");
    g.addColorStop(0.6, "rgba(26, 26, 26, 0.14)");
    g.addColorStop(1, "rgba(26, 26, 26, 0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function ShadowBlob({
  w,
  h,
  position,
  opacity = 1,
}: {
  w: number;
  h: number;
  position: [number, number, number];
  opacity?: number;
}) {
  const tex = useMemo(() => makeShadowTexture(), []);
  return (
    <mesh position={position}>
      <planeGeometry args={[w, h]} />
      <meshBasicMaterial map={tex} transparent opacity={opacity} depthWrite={false} />
    </mesh>
  );
}

/** Rounded-rectangle shape (shared by cards and slabs). */
function roundedShape(w: number, h: number, r: number): THREE.Shape {
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
  return s;
}

/** Extruded rounded slab with a small bevel — catches the key light so
    paper-white surfaces read as physical cards, not flat rectangles. */
function roundedSlabGeo(w: number, h: number, r: number, depth: number): THREE.ExtrudeGeometry {
  const geo = new THREE.ExtrudeGeometry(roundedShape(w, h, r), {
    depth,
    bevelEnabled: true,
    bevelThickness: 0.012,
    bevelSize: 0.012,
    bevelSegments: 2,
    curveSegments: 8,
  });
  geo.translate(0, 0, -depth / 2);
  return geo;
}

/** A lit paper card: rounded slab + optional accent edge bar on the left. */
function PaperCard({
  w,
  h,
  depth = 0.05,
  color = PAPER,
  edge,
}: {
  w: number;
  h: number;
  depth?: number;
  color?: string;
  edge?: string;
}) {
  const geo = useMemo(() => roundedSlabGeo(w, h, Math.min(0.1, h / 4), depth), [w, h, depth]);
  return (
    <group>
      <mesh geometry={geo}>
        <meshStandardMaterial color={color} roughness={0.82} metalness={0} />
      </mesh>
      {edge ? (
        <mesh position={[-w / 2 + 0.045, 0, depth / 2 + 0.014]}>
          <boxGeometry args={[0.055, h * 0.68, 0.02]} />
          <meshStandardMaterial color={edge} roughness={0.6} metalness={0} />
        </mesh>
      ) : null}
    </group>
  );
}

/** A thin ink strip — one line of "text" on a paper card. */
function InkLine({
  w,
  position,
  color = INK,
  opacity = 1,
}: {
  w: number;
  position: [number, number, number];
  color?: string;
  opacity?: number;
}) {
  return (
    <mesh position={position}>
      <boxGeometry args={[w, 0.045, 0.016]} />
      <meshStandardMaterial color={color} roughness={0.9} transparent opacity={opacity} />
    </mesh>
  );
}

/** Shared key light + ambient fill for every scene. */
function PaperLights() {
  return (
    <>
      <ambientLight intensity={1.15} />
      <directionalLight position={[2.6, 4.2, 5.2]} intensity={1.9} />
      <directionalLight position={[-3, -1.5, 2]} intensity={0.4} color={"#fff7ea"} />
    </>
  );
}

// ---- T1 · Creative Build: a paper browser assembles typed lines into a page

/** Content blocks the typed lines assemble into (cream + green slabs). */
const T1_BLOCKS: { size: [number, number]; to: [number, number]; color: string }[] = [
  { size: [2.18, 0.62], to: [0, 0.42], color: CREAM },        // hero panel
  { size: [0.66, 0.5], to: [-0.76, -0.32], color: ACCENT_SOFT },
  { size: [0.66, 0.5], to: [0, -0.32], color: CREAM },
  { size: [0.66, 0.5], to: [0.76, -0.32], color: ACCENT },
];

const T1_LINES = [0.62, 0.5, 0.56, 0.42, 0.52];

function T1Scene({ speed, reducedMotion }: SceneProps) {
  const group = useRef<THREE.Group>(null);
  const float = useRef<THREE.Group>(null);
  const time = useSceneTime(speed, reducedMotion);
  useParallax(group);
  const lineRefs = useRef<(THREE.Group | null)[]>([]);
  const blockRefs = useRef<(THREE.Group | null)[]>([]);
  const windowGeo = useMemo(() => roundedSlabGeo(3.3, 2.44, 0.12, 0.09), []);
  useFrame(() => {
    const t = time();
    const cycle = (t % 10) / 10;
    // 0–0.34 lines type in · 0.34–0.62 blocks assemble · hold · 0.9– reset
    T1_LINES.forEach((_, i) => {
      const g = lineRefs.current[i];
      if (!g) return;
      const typeIn = easeInOut(Math.min(1, Math.max(0, (cycle - 0.03 - i * 0.055) / 0.08)));
      const giveWay = easeInOut(Math.min(1, Math.max(0, (cycle - 0.36 - i * 0.04) / 0.12)));
      const gone = cycle > 0.92 ? 0 : 1;
      g.scale.x = Math.max(0.0001, typeIn * gone);
      g.visible = typeIn > 0.01 && giveWay < 0.95 && gone > 0;
      g.position.z = 0.08 - giveWay * 0.02;
    });
    T1_BLOCKS.forEach((b, i) => {
      const g = blockRefs.current[i];
      if (!g) return;
      const grow = easeInOut(Math.min(1, Math.max(0, (cycle - 0.38 - i * 0.055) / 0.11)));
      const gone = cycle > 0.9 ? 1 - easeInOut((cycle - 0.9) / 0.08) : 1;
      const s = grow * gone;
      g.scale.setScalar(Math.max(0.0001, s));
      g.visible = s > 0.01;
      g.position.set(b.to[0], b.to[1], 0.1);
    });
    // gentle idle float
    if (float.current) {
      float.current.position.y = Math.sin(t * 0.7) * 0.05;
      float.current.rotation.z = Math.sin(t * 0.4) * 0.012;
    }
  });
  return (
    <group ref={group}>
      <group ref={float}>
        <ShadowBlob w={4.4} h={3.4} position={[0.12, -0.26, -0.5]} opacity={0.85} />
        {/* paper-white browser window */}
        <mesh geometry={windowGeo}>
          <meshStandardMaterial color={PAPER} roughness={0.85} metalness={0} />
        </mesh>
        {/* chrome bar + traffic-light dots */}
        <mesh position={[0, 1.05, 0.062]}>
          <boxGeometry args={[3.22, 0.2, 0.02]} />
          <meshStandardMaterial color={CREAM} roughness={0.9} />
        </mesh>
        {["#e3a49a", "#e8d3a4", ACCENT_SOFT].map((c, i) => (
          <mesh key={c} position={[-1.42 + i * 0.17, 1.05, 0.085]} rotation={[0, 0, 0]}>
            <circleGeometry args={[0.042, 20]} />
            <meshStandardMaterial color={c} roughness={0.6} />
          </mesh>
        ))}
        {/* typed lines (thin ink strips, left-aligned like source code) */}
        {T1_LINES.map((w, i) => (
          <group
            key={i}
            ref={(el) => { lineRefs.current[i] = el; }}
            position={[-1.35 + w / 2 + 0.35, 0.66 - i * 0.28, 0.08]}
          >
            <InkLine w={w} position={[0, 0, 0]} color={i % 3 === 2 ? ACCENT : INK} />
          </group>
        ))}
        {/* assembled page blocks (lit slabs with beveled edges) */}
        {T1_BLOCKS.map((b, i) => (
          <group key={i} ref={(el) => { blockRefs.current[i] = el; }}>
            <PaperCard w={b.size[0]} h={b.size[1]} depth={0.06} color={b.color} />
          </group>
        ))}
      </group>
    </group>
  );
}

// ---- T2 · Authenticity: photos on paper mounts orbit; a stamp slaps on ---

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
      mat.opacity = 0.45 + depth * 0.55;
      // periodically the front card tilts forward and the stamp slaps on
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
      <ShadowBlob w={4.6} h={2.2} position={[0, -1.15, -0.9]} opacity={0.7} />
      {media.map((m, i) => (
        <group key={m.src} ref={(el) => { planes.current[i] = el; }}>
          {/* white paper mount behind each photo (lit, beveled) */}
          <group position={[0, 0, -0.045]}>
            <PaperCard w={1.66} h={1.28} depth={0.05} />
          </group>
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

// ---- T3 · Reasoning: the wrong claim card flips over, corrected ----------

/** A message card: white paper + accent edge + ink text lines. */
function MessageCard({
  w,
  h,
  edge,
  lines,
}: {
  w: number;
  h: number;
  edge?: string;
  lines: number[];
}) {
  return (
    <group>
      <PaperCard w={w} h={h} depth={0.045} edge={edge} />
      {lines.map((lw, i) => (
        <InkLine
          key={i}
          w={lw * w}
          position={[(-w / 2) + 0.16 + (lw * w) / 2, h / 2 - 0.16 - i * 0.13, 0.045]}
          color={INK}
          opacity={0.75}
        />
      ))}
    </group>
  );
}

function T3Scene({ speed, reducedMotion }: SceneProps) {
  const group = useRef<THREE.Group>(null);
  const time = useSceneTime(speed, reducedMotion);
  useParallax(group);
  const flipRef = useRef<THREE.Group>(null);
  const checkRef = useRef<THREE.Sprite>(null);
  const checkTex = useMemo(() => makeCheckTexture(), []);
  useFrame(() => {
    const t = time();
    const cycle = (t % 8) / 8;
    // 0–0.35 wrong claim sits · 0.35–0.6 card flips over · corrected holds
    const flip = cycle < 0.35 ? 0 : cycle < 0.6 ? easeInOut((cycle - 0.35) / 0.25) : 1;
    if (flipRef.current) {
      flipRef.current.rotation.y = flip * Math.PI;
      flipRef.current.position.z = 0.12 + Math.sin(flip * Math.PI) * 0.55;
    }
    if (checkRef.current) {
      const pop = cycle < 0.62 ? 0 : cycle < 0.8 ? easeOutBack((cycle - 0.62) / 0.18) : 1;
      const fade = cycle > 0.94 ? 1 - easeInOut((cycle - 0.94) / 0.06) : 1;
      checkRef.current.scale.set(0.5 * pop, 0.5 * pop, 1);
      (checkRef.current.material as THREE.SpriteMaterial).opacity = Math.min(1, pop) * fade;
    }
    if (group.current) group.current.position.y = Math.sin(t * 0.7) * 0.05;
  });
  return (
    <group ref={group}>
      <ShadowBlob w={4.6} h={3.2} position={[0.1, -0.3, -0.7]} opacity={0.8} />
      {/* stacked conversation: paper-white message cards */}
      <group position={[-0.62, 0.98, -0.3]}>
        <MessageCard w={1.7} h={0.56} edge={ACCENT_SOFT} lines={[0.7, 0.5]} />
      </group>
      <group position={[0.74, -0.86, -0.25]}>
        <MessageCard w={1.5} h={0.5} edge={ACCENT_SOFT} lines={[0.62, 0.4]} />
      </group>
      {/* the claim card: wrong on the front, corrected on the back — it
          flips over with a lift when the seeded error is caught */}
      <group ref={flipRef} position={[0, 0.08, 0.12]}>
        <group>
          <MessageCard w={2.1} h={0.72} edge={BAD} lines={[0.78, 0.6, 0.44]} />
        </group>
        <group rotation={[0, Math.PI, 0]}>
          <MessageCard w={2.1} h={0.72} edge={GOOD} lines={[0.72, 0.55]} />
        </group>
      </group>
      <sprite ref={checkRef} position={[1.05, 0.62, 0.6]} scale={[0.0001, 0.0001, 1]}>
        <spriteMaterial map={checkTex} transparent opacity={0} depthTest={false} />
      </sprite>
    </group>
  );
}

// ---- T4 · Direction: noisy paper tiles settle sharp; one gets the frame --

const T4_VERT = /* glsl */ `
  uniform float uT;
  uniform float uSharp;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vec3 p = position;
    float n = sin(p.x * 7.0 + uT) * sin(p.y * 5.0 - uT * 1.3)
            + 0.5 * sin(p.x * 13.0 - uT * 0.7);
    p.z += n * (1.0 - uSharp) * 0.14;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;

const T4_FRAG = /* glsl */ `
  uniform float uT;
  uniform float uSharp;
  varying vec2 vUv;
  void main() {
    float grain = fract(sin(dot(vUv * (40.0 - 30.0 * uSharp), vec2(12.9898, 78.233)) + uT) * 43758.5453);
    vec3 cream = vec3(0.945, 0.918, 0.868);  // paper cream
    vec3 green = vec3(0.043, 0.420, 0.278);  // deep accent green
    float wash = vUv.y * 0.55 + 0.18 * sin(uT * 0.3 + vUv.x * 4.0);
    vec3 settled = mix(cream, green, clamp(wash, 0.0, 0.85));
    vec3 fuzzy = mix(cream, vec3(grain * 0.35 + 0.5), 0.5);
    vec3 col = mix(fuzzy, settled, uSharp);
    gl_FragColor = vec4(col, 1.0);
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
    () => new THREE.MeshStandardMaterial({ color: ACCENT, roughness: 0.5, transparent: true, opacity: 0 }),
    [],
  );
  const pips = useRef<(THREE.Mesh | null)[]>([]);
  const frameGeos = useMemo(() => {
    const t = 0.05;
    const wide = new THREE.BoxGeometry(1.14, t, t);
    const tall = new THREE.BoxGeometry(t, 1.14 - t * 2, t);
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
    if (group.current) group.current.position.y = Math.sin(t * 0.6) * 0.04;
  });
  return (
    <group ref={group}>
      <ShadowBlob w={4.2} h={3.6} position={[0.1, -0.2, -0.6]} opacity={0.8} />
      {T4_POS.map(([x, y], i) => (
        <group key={i} position={[x, y, 0]}>
          {/* white paper mat behind each render tile */}
          <group position={[0, 0, -0.05]}>
            <PaperCard w={1.12} h={1.12} depth={0.05} />
          </group>
          <mesh>
            <planeGeometry args={[0.96, 0.96, 24, 24]} />
            <shaderMaterial
              ref={(el) => { mats.current[i] = el; }}
              vertexShader={T4_VERT}
              fragmentShader={T4_FRAG}
              uniforms={{ uT: { value: 0 }, uSharp: { value: 0 } }}
            />
          </mesh>
        </group>
      ))}
      {/* the chosen tile's highlight frame (thick beams, shared fading material) */}
      <group position={[T4_POS[CHOSEN][0], T4_POS[CHOSEN][1], 0.09]}>
        <mesh geometry={frameGeos.wide} material={frameMat} position={[0, 0.57 - frameGeos.t / 2, 0]} />
        <mesh geometry={frameGeos.wide} material={frameMat} position={[0, -0.57 + frameGeos.t / 2, 0]} />
        <mesh geometry={frameGeos.tall} material={frameMat} position={[-0.57 + frameGeos.t / 2, 0, 0]} />
        <mesh geometry={frameGeos.tall} material={frameMat} position={[0.57 - frameGeos.t / 2, 0, 0]} />
      </group>
      {/* three quota pips */}
      {[0, 1, 2].map((i) => (
        <mesh key={i} ref={(el) => { pips.current[i] = el; }}>
          <sphereGeometry args={[0.045, 12, 12]} />
          <meshStandardMaterial color={ACCENT} roughness={0.4} />
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
      <PaperLights />
      <Scene speed={hovered ? 1.9 : 1} reducedMotion={reducedMotion} />
    </Canvas>
  );
}
