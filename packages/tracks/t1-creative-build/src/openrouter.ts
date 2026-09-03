/**
 * Vibe-coding model calls for the T1 assist panel.
 *
 * THE BROWSER HOLDS NO PROVIDER KEY (TEN-62). It used to: the candidate
 * pasted an OpenRouter key, or signed in and did the PKCE exchange here, and
 * the result sat in localStorage under `ailx:openrouter-key`. That slot is
 * gone, and so is every parameter that carried a key into a request. What is
 * left is an OpenAI-compatible ENDPOINT — the exam service's model gateway in
 * the hosted build, the capped shared-demo proxy in the static export, or a
 * local server such as Ollama — plus whatever identity the HOST attaches
 * through the injected fetch. This module cannot send an `Authorization`
 * header, because it has nothing to put in one.
 *
 * Everything here is pure / DOM-free (fetch is injected) so the request
 * builder, fence parser and response handling are unit-testable without
 * network. Model calls happen in the RUNNER only; score() stays pure and
 * consumes the stored artifact.
 */

/** Persisted OpenAI-compatible API base (the gateway, the demo proxy, Ollama). */
export const LLM_BASE_URL_STORAGE = "ailx:llm-base-url";

/** Every browser-local slot that makes up "a connected model". */
export const LLM_CONNECTION_KEYS: ReadonlyArray<string> = [LLM_BASE_URL_STORAGE];

/** Minimal write surface of localStorage (keeps this module DOM-free). */
export interface ClearableStorage {
  removeItem(key: string): void;
}

/**
 * Fully disconnect the browser-local model connection.
 *
 * Clearing only the key leaves a custom base URL behind, which keeps the
 * runner in real mode pointed at the endpoint that just failed: the user is
 * stuck with a dead assistant and no way out short of clearing localStorage
 * by hand. Never throws — storage can be unavailable (private mode).
 */
export function clearLlmConnection(storage: ClearableStorage | null | undefined): void {
  if (!storage) return;
  for (const key of LLM_CONNECTION_KEYS) {
    try {
      storage.removeItem(key);
    } catch {
      /* non-fatal — the in-memory state reset is what unblocks the user */
    }
  }
}
/**
 * Normalize an endpoint: trim, drop trailing slashes. Empty stays EMPTY.
 *
 * There is deliberately no default any more. The old fallback was
 * `https://openrouter.ai/api/v1`, which only worked because a key sat beside
 * it in this browser; with the key gone, a request there is a guaranteed 401
 * dressed up as a connection. "No endpoint" is now a state the caller must
 * handle, and `hasModelEndpoint()` is how it asks. Pure.
 */
export function normalizeBaseUrl(base: string | null | undefined): string {
  return (base ?? "").trim().replace(/\/+$/, "");
}

/** Is there an endpoint to call at all? Pure. */
export function hasModelEndpoint(base: string | null | undefined): boolean {
  return normalizeBaseUrl(base) !== "";
}

/**
 * Is this a URL a browser may be pointed at for model calls?
 *
 * A review found that the manual box persisted whatever was typed, so a key
 * pasted into userinfo (`https://user:sk-or-…@host/v1`) or a query string
 * would land in `localStorage` and in every request URL — the exact leak this
 * change exists to close, through the one input that survived it.
 *
 * So: http(s) only, no credentials, no query, no fragment. `http:` stays
 * allowed because a local model server (Ollama, vLLM) is the reason this box
 * exists, and it reaches no network. Pure.
 */
export function isUsableModelEndpoint(base: string | null | undefined): boolean {
  const normalized = normalizeBaseUrl(base);
  if (normalized === "") return false;
  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return false;
  return url.username === "" && url.password === "" && url.search === "" && url.hash === "";
}

/** chat-completions endpoint for any OpenAI-compatible base. Pure. */
export function chatCompletionsUrl(baseUrl?: string): string {
  return `${normalizeBaseUrl(baseUrl)}/chat/completions`;
}

/** models endpoint for any OpenAI-compatible base. Pure. */
export function modelsUrl(baseUrl?: string): string {
  return `${normalizeBaseUrl(baseUrl)}/models`;
}

/** Curated defaults; the UI also accepts a free-text override. */
export const CURATED_MODELS: ReadonlyArray<string> = [
  "openai/gpt-4.1-nano",
  "openai/gpt-4.1-mini",
  "anthropic/claude-sonnet-5",
  "google/gemini-3.5-flash-lite",
  "deepseek/deepseek-v4-flash",
  "moonshotai/kimi-k3",
  "z-ai/glm-5.2:free",
];

export interface VibeRequestInput {
  model: string;
  brief: string;
  currentHtml: string;
  userPrompt: string;
}

export interface ChatPayload {
  model: string;
  messages: Array<{ role: "system" | "user"; content: string }>;
}

const SYSTEM_PROMPT =
  "You are a vibe-coding assistant inside a timed exam. The candidate is " +
  "building ONE self-contained HTML file (inline CSS/JS only, no external " +
  "resources, no network calls — the preview runs under a strict CSP with " +
  "default-src 'none'). Given the current document and the candidate's " +
  "request, reply with the COMPLETE UPDATED HTML DOCUMENT in exactly one " +
  "fenced code block tagged html (```html ... ```). No partial diffs, no " +
  "commentary outside the fence.";

/** Build the chat-completions payload. Pure. */
export function buildVibeRequest(input: VibeRequestInput): ChatPayload {
  return {
    model: input.model,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content:
          `## Brief\n${input.brief}\n\n` +
          `## Current document (index.html)\n\`\`\`html\n${input.currentHtml}\n\`\`\`\n\n` +
          `## Request\n${input.userPrompt}`,
      },
    ],
  };
}

/**
 * Request init (headers/body) for fetch. Pure.
 *
 * There is no `Authorization` header and no parameter that could become one.
 * The endpoint is either the exam service's gateway — which authenticates the
 * CALLER, not the key, and pays out of a key it holds sealed — or a proxy or
 * a local server that needs no credential from this browser.
 */
export function buildFetchInit(payload: ChatPayload): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  };
}

/**
 * Extract the updated document from the model reply.
 * Prefers the first ```html fence; falls back to any fence whose content
 * looks like a full document; finally, a bare full-document reply.
 * Returns null when no usable document is found.
 */
export function extractHtmlFence(text: string): string | null {
  if (typeof text !== "string" || text.length === 0) return null;
  const fences = [...text.matchAll(/```([a-zA-Z0-9_-]*)[ \t]*\r?\n([\s\S]*?)```/g)];
  const tagged = fences.find((m) => m[1].toLowerCase() === "html");
  if (tagged) {
    const body = tagged[2].trim();
    return body.length > 0 ? body : null;
  }
  const looksLikeDoc = (s: string) => /<!doctype html|<html[\s>]/i.test(s);
  const fallback = fences.find((m) => looksLikeDoc(m[2]));
  if (fallback) return fallback[2].trim();
  const bare = text.trim();
  return looksLikeDoc(bare) && !bare.includes("```") ? bare : null;
}

export class OpenRouterError extends Error {
  constructor(
    message: string,
    public readonly status: number | null,
  ) {
    super(message);
    this.name = "OpenRouterError";
  }
}

type FetchLike = (url: string, init?: RequestInit) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

/**
 * Call the endpoint's chat completions and return the raw assistant text.
 *
 * `fetchImpl` is injected for testability AND for identity: the host passes
 * one that attaches who is asking, which is the only credential a request
 * from this browser now carries.
 */
export async function requestVibeCompletion(
  fetchImpl: FetchLike,
  payload: ChatPayload,
  baseUrl?: string,
): Promise<string> {
  let res: Awaited<ReturnType<FetchLike>>;
  try {
    res = await fetchImpl(chatCompletionsUrl(baseUrl), buildFetchInit(payload));
  } catch {
    throw new OpenRouterError("Network error reaching the model endpoint.", null);
  }
  if (!res.ok) {
    const msg =
      // Mid-run, the only action the candidate actually HAS is the offline
      // assist: the static export has no sign-in, and no build offers a
      // connect button inside a running track. A review caught both messages
      // naming something impossible.
      res.status === 401
        ? "The model endpoint would not accept this request (401). Use the offline demo assist to finish the track."
        : res.status === 402
          ? "The shared demo budget is spent (402). Use the offline demo assist to finish the track."
          : res.status === 429
            ? "Model rate limit (429). Wait a moment and retry."
            : `Model endpoint error (HTTP ${res.status}).`;
    throw new OpenRouterError(msg, res.status);
  }
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    throw new OpenRouterError("OpenRouter returned unparseable JSON.", res.status);
  }
  const content = (json as { choices?: Array<{ message?: { content?: unknown } }> })
    ?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || content.length === 0) {
    throw new OpenRouterError("OpenRouter reply had no message content.", res.status);
  }
  return content;
}

/** Parse GET /models into a sorted id list. Pure; tolerant of junk. */
export function parseModelsResponse(json: unknown): string[] {
  const data = (json as { data?: unknown })?.data;
  if (!Array.isArray(data)) return [];
  return data
    .map((m) => (m as { id?: unknown })?.id)
    .filter((id): id is string => typeof id === "string" && id.length > 0)
    .sort();
}

/** Fetch the model list from any OpenAI-compatible base. No credential. */
export async function fetchModelIds(fetchImpl: FetchLike, baseUrl?: string): Promise<string[]> {
  try {
    const res = await fetchImpl(modelsUrl(baseUrl), {});
    if (!res.ok) return [];
    return parseModelsResponse(await res.json());
  } catch {
    return [];
  }
}
