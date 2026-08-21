#!/usr/bin/env node
/**
 * Generate the four `key:"ai"` text-authenticity passages for the T2 bank
 * GENUINELY via OpenRouter, so the answer key ("AI-generated") is true by
 * construction rather than authored imitation.
 *
 * Usage:  OPENROUTER_API_KEY=... node gen-ai-passages.mjs
 * Output: writes ./generated-ai-passages.json next to this script with
 *         { generated_at, model, slots: [{slot, prompt, text}] }.
 * The API key is read from the environment at generation time only and is
 * never written to disk.
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const KEY = process.env.OPENROUTER_API_KEY;
if (!KEY) {
  console.error("OPENROUTER_API_KEY is not set");
  process.exit(1);
}
const MODEL = process.env.AILX_GEN_MODEL ?? "openai/gpt-4o-mini";

const SLOTS = [
  {
    slot: "en-easy-civic",
    prompt:
      "Write a short paragraph (3-4 sentences) for a city newsletter announcing a new municipal recycling program. Upbeat, professional tone.",
  },
  {
    slot: "en-medium-review",
    prompt:
      "Write a balanced 4-6 sentence customer review of an electric kettle you have used for three months, mentioning pros and cons.",
  },
  {
    slot: "en-hard-techblog",
    prompt:
      "Write one paragraph for an engineering blog post explaining how adding a cache layer fixed a latency problem in a web service. Include a concrete-sounding improvement figure.",
  },
  {
    slot: "ja-medium-storereply",
    prompt:
      "日本語で、飲食店のオーナーとしてお客様のレビューへの丁寧な返信文を書いてください（3〜4文、敬語）。",
  },
];

async function gen(prompt) {
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: "user", content: prompt }],
      max_tokens: 400,
    }),
  });
  if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error("empty completion");
  return text;
}

const out = { generated_at: new Date().toISOString().slice(0, 10), model: MODEL, slots: [] };
for (const s of SLOTS) {
  process.stderr.write(`generating ${s.slot}...\n`);
  out.slots.push({ slot: s.slot, prompt: s.prompt, text: await gen(s.prompt) });
}
const here = dirname(fileURLToPath(import.meta.url));
const outPath = join(here, "generated-ai-passages.json");
writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n");
console.log(`wrote ${outPath}`);
