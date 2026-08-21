/** Shared-demo model catalog — the allowlist in OpenRouter/OpenAI shape. */
const MODELS = [
  { id: "openai/gpt-4.1-nano", name: "GPT-4.1 nano (shared demo)" },
  { id: "google/gemini-3.1-flash-image", name: "Gemini 3.1 Flash Image (shared demo)", architecture: { output_modalities: ["image", "text"] } },
  { id: "google/gemini-3.1-flash-image-lite", name: "Gemini 3.1 Flash Image Lite (shared demo)", architecture: { output_modalities: ["image", "text"] } },
];
export default function handler(req, res) {
  const origin = req.headers.origin ?? "";
  res.setHeader("Access-Control-Allow-Origin", origin.startsWith("http://localhost") ? origin : "https://rryoung98.github.io");
  res.setHeader("Access-Control-Allow-Headers", "content-type, authorization");
  res.status(200).json({ data: MODELS });
}
