/**
 * Image generation for the T4 draft loop.
 *
 * Mirrors t1/src/openrouter.ts conventions, including the one that changed in
 * TEN-62: THE BROWSER HOLDS NO PROVIDER KEY. There is no key slot and no
 * parameter that could carry a key into a request. What is left is an
 * OpenAI-compatible ENDPOINT — the exam service's model gateway, the capped
 * shared-demo proxy, or a local server — read from the SAME slot T1 uses
 * (LLM_BASE_URL_STORAGE), so connecting once connects both tracks. The
 * constant is `@ailx/core`'s and is re-exported here: the track packages do
 * not depend on each other, but both depend on core, and a duplicated string
 * is how the footer came to read a slot it never heard change.
 *
 * Everything here is pure / DOM-free (fetch is injected) so the request
 * builder, response parser and error mapping are unit-testable without
 * network. Model calls happen in the RUNNER only; score() stays pure and
 * consumes the stored artifact.
 */

/**
 * Same slot as T1, and now literally the same constant: `@ailx/core` spells
 * it once (`connection.ts`) and both tracks re-export it under the name
 * their callers already use.
 */
export { MODEL_ENDPOINT_SLOT as LLM_BASE_URL_STORAGE } from "@ailx/core";

/**
 * Normalize an endpoint (trim, strip trailing slashes). Empty stays EMPTY —
 * the old `https://openrouter.ai/api/v1` default only worked because a key
 * sat beside it in this browser. Pure.
 */
export function normalizeBaseUrl(base: string | null | undefined): string {
  return (base ?? "").trim().replace(/\/+$/, "");
}

/** Is there an endpoint to call at all? Pure. */
export function hasModelEndpoint(base: string | null | undefined): boolean {
  return normalizeBaseUrl(base) !== "";
}

/** chat-completions endpoint for any OpenAI-compatible base. Pure. */
export function chatCompletionsUrl(baseUrl?: string): string {
  return `${normalizeBaseUrl(baseUrl)}/chat/completions`;
}

/**
 * Curated image-capable models; the UI also accepts a free-text override.
 * Verified: OpenRouter returns generated images for these via the
 * chat-completions endpoint with modalities ["image","text"].
 */
export const CURATED_IMAGE_MODELS: ReadonlyArray<string> = [
  "google/gemini-3.1-flash-image",
  "google/gemini-3.1-flash-lite-image",
  "openai/gpt-5-image-mini",
  "google/gemini-3-pro-image",
];

export interface ImageChatPayload {
  model: string;
  messages: Array<{ role: "user"; content: string }>;
  modalities: ["image", "text"];
}

/** Build the image-generation chat payload. Pure. */
export function buildImageRequest(prompt: string, model: string): ImageChatPayload {
  return {
    model,
    messages: [{ role: "user", content: prompt }],
    modalities: ["image", "text"],
  };
}

/**
 * Request init (headers/body) for fetch. Pure.
 *
 * No `Authorization` header, and no parameter that could become one: the
 * endpoint holds its own key, and the host's injected fetch says who is
 * asking.
 */
export function buildImageFetchInit(payload: ImageChatPayload): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  };
}

export type ImageGenErrorKind =
  | "auth"
  | "rate-limit"
  | "http"
  | "network"
  | "bad-json"
  | "refusal"
  | "no-image"
  | "timeout"
  | "cancelled";

export class ImageGenError extends Error {
  constructor(
    message: string,
    public readonly kind: ImageGenErrorKind,
    public readonly status: number | null = null,
  ) {
    super(message);
    this.name = "ImageGenError";
  }
}

export interface GeneratedImage {
  /** data:image/...;base64,... URI (or a plain image URL from some models). */
  dataUri: string;
  /** Model id that actually served the request. */
  modelId: string;
}

interface ChatShape {
  model?: unknown;
  choices?: Array<{
    message?: {
      content?: unknown;
      images?: Array<{ image_url?: { url?: unknown } }>;
    };
  }>;
}

/**
 * Extract the generated image from a chat-completions response. Pure.
 * Throws ImageGenError('refusal') when the model answered with text only
 * (safety refusal / clarification) and ImageGenError('no-image') when the
 * reply carries neither image nor text.
 */
export function parseImageResponse(json: unknown, requestedModel: string): GeneratedImage {
  const j = json as ChatShape;
  const msg = j?.choices?.[0]?.message;
  const url = msg?.images?.[0]?.image_url?.url;
  const modelId =
    typeof j?.model === "string" && j.model.length > 0 ? j.model : requestedModel;
  if (typeof url === "string" && (url.startsWith("data:image") || /^https?:\/\//.test(url))) {
    return { dataUri: url, modelId };
  }
  const content = msg?.content;
  if (typeof content === "string" && content.trim().length > 0) {
    throw new ImageGenError(
      `The model replied with text instead of an image: "${content.trim().slice(0, 160)}"`,
      "refusal",
    );
  }
  throw new ImageGenError("The model reply contained no image.", "no-image");
}

type FetchLike = (url: string, init?: RequestInit) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

/**
 * How long one image call may take, and what a stall says (TEN-212).
 *
 * Same defect and same shape as T1's assist: the call carried no bound, so an
 * endpoint that accepted the request and then said nothing left `genBusy`
 * true for the rest of the track — Generate disabled, clock running, nothing
 * to press. The deadline is OURS, not the transport's, because a fetch that
 * never settles never rejects either. Duplicated rather than shared for the
 * reason at the top of this file: the track packages do not depend on each
 * other. 90s, because an image is slower than a document rewrite.
 */
export const IMAGE_REQUEST_TIMEOUT_MS = 90_000;

/** Said out loud — the alternative is a candidate watching a clock. */
export const IMAGE_TIMEOUT_MESSAGE =
  "The model did not answer within 90s — no draft was made. Retry, or use the offline demo model.";

/** A stop the candidate asked for is not a failure and must not read as one. */
export const IMAGE_CANCELLED_MESSAGE = "You stopped the request — no draft was made.";

/** Deadline and cancel control for one image call. */
export interface ModelCallOptions {
  /** The runner's Stop button. */
  readonly signal?: AbortSignal;
  /** Override the deadline (tests, and a slower endpoint later). */
  readonly timeoutMs?: number;
}

/**
 * Run `work` under a deadline and the caller's cancel control.
 *
 * The race — not the signal — is what ends the wait: an injected fetch (and a
 * body read) can hang without ever observing an abort. The signal still goes
 * down so a real request is torn down rather than left in flight against a
 * candidate we have already answered.
 */
async function withDeadline<T>(
  work: (signal: AbortSignal) => Promise<T>,
  options: ModelCallOptions | undefined,
  fail: (kind: "timeout" | "cancelled") => Error,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stalled = new Promise<never>((_resolve, reject) => {
    const stop = (kind: "timeout" | "cancelled") => {
      controller.abort();
      reject(fail(kind));
    };
    timer = setTimeout(() => stop("timeout"), options?.timeoutMs ?? IMAGE_REQUEST_TIMEOUT_MS);
    const outer = options?.signal;
    if (!outer) return;
    if (outer.aborted) stop("cancelled");
    else outer.addEventListener("abort", () => stop("cancelled"), { once: true });
  });
  try {
    return await Promise.race([work(controller.signal), stalled]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Call the image model and return { dataUri, modelId }. fetch is injected
 * for testability; throws ImageGenError with a user-facing message on
 * 401/429/network/shape/refusal failures.
 */
export async function requestImage(
  fetchImpl: FetchLike,
  payload: ImageChatPayload,
  baseUrl?: string,
  options?: ModelCallOptions,
): Promise<GeneratedImage> {
  return withDeadline(
    (signal) => callImage(fetchImpl, payload, baseUrl, signal),
    options,
    (kind) =>
      kind === "timeout"
        ? new ImageGenError(IMAGE_TIMEOUT_MESSAGE, "timeout")
        : new ImageGenError(IMAGE_CANCELLED_MESSAGE, "cancelled"),
  );
}

/** The request itself. Everything that can hang is INSIDE the deadline — the
 *  body read as much as the round trip, because a provider that stops
 *  mid-stream stalls `json()` and never the fetch. */
async function callImage(
  fetchImpl: FetchLike,
  payload: ImageChatPayload,
  baseUrl: string | undefined,
  signal: AbortSignal,
): Promise<GeneratedImage> {
  let res: Awaited<ReturnType<FetchLike>>;
  try {
    res = await fetchImpl(chatCompletionsUrl(baseUrl), { ...buildImageFetchInit(payload), signal });
  } catch {
    throw new ImageGenError("Network error reaching the image endpoint.", "network");
  }
  if (!res.ok) {
    if (res.status === 401) {
      throw new ImageGenError(
        // The only action a candidate has mid-run is the offline simulator.
        "The image endpoint would not accept this request (401). Use the offline demo to finish the track.",
        "auth",
        401,
      );
    }
    if (res.status === 429) {
      throw new ImageGenError(
        "Image rate limit (429). Wait a moment and retry.",
        "rate-limit",
        429,
      );
    }
    throw new ImageGenError(`Image endpoint error (HTTP ${res.status}).`, "http", res.status);
  }
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    throw new ImageGenError("Image endpoint returned unparseable JSON.", "bad-json", res.status);
  }
  return parseImageResponse(json, payload.model);
}

/* ------------------------------------------------------------------ */
/* Draft size discipline — real dataUris can be ~1MB; drafts store a  */
/* recompressed copy ≤ DRAFT_MAX_BYTES, finals keep full resolution.  */
/* ------------------------------------------------------------------ */

/** Hard cap for a STORED draft image (checkpoints hold every draft). */
export const DRAFT_MAX_BYTES = 200 * 1024;

/** Decoded byte size of a data URI (base64-aware). Pure. */
export function dataUriByteSize(uri: string): number {
  const comma = uri.indexOf(",");
  if (uri.startsWith("data:") && comma >= 0) {
    const meta = uri.slice(0, comma);
    const body = uri.slice(comma + 1);
    if (/;base64$/i.test(meta)) {
      const padding = body.endsWith("==") ? 2 : body.endsWith("=") ? 1 : 0;
      return Math.max(0, Math.floor((body.length * 3) / 4) - padding);
    }
    return body.length;
  }
  return uri.length;
}

/** True when a draft copy of this image must be recompressed. Pure. */
export function draftNeedsRecompress(uri: string): boolean {
  return dataUriByteSize(uri) > DRAFT_MAX_BYTES;
}

/**
 * Pure guard over the recompress result: keep the recompressed copy only
 * when it is a real image data URI, fits the cap, and actually shrank.
 * Any failure (null / junk / still too big / grew) keeps the ORIGINAL —
 * we never lose the image over a size optimization.
 */
export function chooseDraftAsset(original: string, recompressed: string | null): string {
  if (
    typeof recompressed === "string" &&
    recompressed.startsWith("data:image") &&
    dataUriByteSize(recompressed) <= DRAFT_MAX_BYTES &&
    dataUriByteSize(recompressed) < dataUriByteSize(original)
  ) {
    return recompressed;
  }
  return original;
}
