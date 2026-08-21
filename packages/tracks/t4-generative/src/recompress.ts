/**
 * Browser-side draft recompression: downscale + JPEG-recompress a real
 * model image so STORED drafts stay under DRAFT_MAX_BYTES (checkpoints
 * carry every draft; finals keep the full-resolution original).
 *
 * DOM/canvas-dependent by nature — the pure byte-size guard lives in
 * imagegen.ts (chooseDraftAsset) and is what tests exercise. This function
 * NEVER throws: any failure resolves to null and the caller keeps the
 * original image.
 */
import { dataUriByteSize } from "./imagegen.js";

const DRAFT_MAX_DIM = 640;
const QUALITY_LADDER = [0.8, 0.6, 0.45, 0.3] as const;

function loadImage(dataUri: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image decode failed"));
    img.src = dataUri;
  });
}

function blobToDataUri(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("blob read failed"));
    r.readAsDataURL(blob);
  });
}

/**
 * Returns a JPEG data URI ≤ maxBytes, or null when the environment cannot
 * recompress (no canvas 2d context, decode failure, still too big, …).
 */
export async function recompressDataUri(
  dataUri: string,
  maxBytes: number,
): Promise<string | null> {
  try {
    const img = await loadImage(dataUri);
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    if (!(w > 0) || !(h > 0)) return null;
    const scale = Math.min(1, DRAFT_MAX_DIM / Math.max(w, h));
    const tw = Math.max(1, Math.round(w * scale));
    const th = Math.max(1, Math.round(h * scale));

    if (typeof OffscreenCanvas !== "undefined") {
      const canvas = new OffscreenCanvas(tw, th);
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      ctx.drawImage(img, 0, 0, tw, th);
      for (const quality of QUALITY_LADDER) {
        const blob = await canvas.convertToBlob({ type: "image/jpeg", quality });
        const out = await blobToDataUri(blob);
        if (dataUriByteSize(out) <= maxBytes) return out;
      }
      return null;
    }

    const canvas = document.createElement("canvas");
    canvas.width = tw;
    canvas.height = th;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, tw, th);
    for (const quality of QUALITY_LADDER) {
      const out = canvas.toDataURL("image/jpeg", quality);
      if (dataUriByteSize(out) <= maxBytes) return out;
    }
    return null;
  } catch {
    return null;
  }
}
