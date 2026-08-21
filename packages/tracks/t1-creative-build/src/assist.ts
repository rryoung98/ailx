import { sha256Bytes, sha256Hex } from "./sha256.js";

/**
 * DEMO AI assistant — deterministic simulator, clearly labeled.
 *
 * The static showcase makes no network calls at runtime, so where the spec
 * assumes a code assistant we substitute a pure function seeded by
 * sha256(prompt). Same prompt -> same answer, always. It routes on a small
 * keyword vocabulary and returns a self-contained HTML/CSS/JS snippet the
 * candidate can adapt.
 */

export const ASSIST_MODEL_ID = "demo-assist@1";

interface Recipe {
  keywords: string[];
  title: string;
  snippet: (accent: string) => string;
}

const ACCENTS = ["#7c5cff", "#00b8a9", "#f6a821", "#e05297", "#4f9dff", "#7ec850"];

const RECIPES: Recipe[] = [
  {
    keywords: ["nav", "menu", "header"],
    title: "Sticky top navigation",
    snippet: (a) => `<header style="position:sticky;top:0;background:#111;padding:12px 24px">
  <nav aria-label="Main">
    <a href="#about" style="color:${a};margin-right:16px">About</a>
    <a href="#work" style="color:${a};margin-right:16px">Work</a>
    <a href="#contact" style="color:${a}">Contact</a>
  </nav>
</header>`,
  },
  {
    keywords: ["hero", "intro", "landing", "title"],
    title: "Hero section",
    snippet: (a) => `<section id="hero" style="min-height:60vh;display:grid;place-items:center;text-align:center">
  <div>
    <h1 style="font-size:3rem;margin:0">Your Name</h1>
    <p style="color:${a};font-size:1.25rem">What you work on, in one line.</p>
  </div>
</section>`,
  },
  {
    keywords: ["gallery", "grid", "portfolio", "work", "project"],
    title: "Responsive project grid",
    snippet: (a) => `<section id="work" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px;padding:24px">
  <article style="border:1px solid ${a};border-radius:8px;padding:16px"><h3>Project one</h3><p>Short description.</p></article>
  <article style="border:1px solid ${a};border-radius:8px;padding:16px"><h3>Project two</h3><p>Short description.</p></article>
  <article style="border:1px solid ${a};border-radius:8px;padding:16px"><h3>Project three</h3><p>Short description.</p></article>
</section>`,
  },
  {
    keywords: ["contact", "email", "footer"],
    title: "Contact footer",
    snippet: (a) => `<footer id="contact" style="padding:24px;border-top:1px solid ${a}">
  <h2>Contact</h2>
  <p>Reach me at <a href="mailto:you@example.org" style="color:${a}">you@example.org</a>.</p>
</footer>`,
  },
  {
    keywords: ["animation", "animate", "canvas", "particle", "webgl", "shader"],
    title: "Canvas particle background",
    snippet: (a) => `<canvas id="bg" width="800" height="240" style="width:100%;display:block"></canvas>
<script>
  const c = document.getElementById('bg'), x = c.getContext('2d');
  const dots = Array.from({length: 48}, (_, i) => ({p: i / 48, r: 6 + (i % 5)}));
  let t = 0;
  (function frame() {
    x.clearRect(0, 0, c.width, c.height);
    x.fillStyle = '${a}';
    for (const d of dots) {
      const px = ((d.p + t * 0.02) % 1) * c.width;
      const py = 120 + Math.sin(d.p * 12.6 + t) * 80;
      x.beginPath(); x.arc(px, py, d.r, 0, 6.283); x.fill();
    }
    t += 0.016; requestAnimationFrame(frame);
  })();
<\/script>`,
  },
  {
    keywords: ["dark", "theme", "color", "style", "css"],
    title: "Dark theme base styles",
    snippet: (a) => `<style>
  :root { color-scheme: dark; }
  body { margin:0; background:#0b0b10; color:#e8e8ef; font-family:system-ui,sans-serif; line-height:1.6; }
  a { color:${a}; }
  main { max-width:720px; margin:0 auto; padding:24px; }
</style>`,
  },
];

const FALLBACK: Recipe = {
  keywords: [],
  title: "Semantic page skeleton",
  snippet: (a) => `<main>
  <h1>Your Name</h1>
  <p style="color:${a}">Tell the stated audience who you are and what you work on.</p>
  <section id="about" aria-labelledby="about-h"><h2 id="about-h">About</h2><p>…</p></section>
  <section id="work" aria-labelledby="work-h"><h2 id="work-h">Work</h2><p>…</p></section>
</main>`,
};

export interface AssistReply {
  modelId: string;
  title: string;
  code: string;
  note: string;
}

/** Deterministic demo assistant: sha256(prompt) seeds every choice. */
export function demoAssist(prompt: string): AssistReply {
  const norm = prompt.trim().toLowerCase();
  const seed = sha256Bytes("t1-assist:" + norm);
  const matched = RECIPES.filter((r) =>
    r.keywords.some((k) => norm.includes(k)),
  );
  const pool = matched.length > 0 ? matched : [FALLBACK];
  const recipe = pool[seed[0] % pool.length];
  const accent = ACCENTS[seed[1] % ACCENTS.length];
  return {
    modelId: ASSIST_MODEL_ID,
    title: recipe.title,
    code: recipe.snippet(accent),
    note:
      `Demo assistant (deterministic, offline). Suggestion id ` +
      sha256Hex("t1-assist:" + norm).slice(0, 8) +
      ". Adapt the snippet to your brief — judges score coherence between intent and artifact.",
  };
}
