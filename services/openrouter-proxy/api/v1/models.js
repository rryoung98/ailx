/** Shared-demo model catalog — the allowlist in OpenRouter/OpenAI shape. */
import { applyCors } from "../_lib/guards.js";

const MODELS = [
  { id: "openai/gpt-4.1-nano", name: "GPT-4.1 nano (shared demo)" },
  { id: "google/gemini-3.1-flash-image", name: "Gemini 3.1 Flash Image (shared demo)", architecture: { output_modalities: ["image", "text"] } },
  { id: "google/gemini-3.1-flash-image-lite", name: "Gemini 3.1 Flash Image Lite (shared demo)", architecture: { output_modalities: ["image", "text"] } },
];

export default function handler(req, res) {
  if (applyCors(req, res, ["GET"])) return;
  return res.status(200).json({ data: MODELS });
}
