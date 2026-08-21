"use client";
/** WebGL feature detection — false during SSR and in non-WebGL browsers. */
let cached: boolean | null = null;

export function detectWebGL(): boolean {
  if (cached !== null) return cached;
  if (typeof document === "undefined") return false;
  // jsdom & very old browsers: no WebGL constructor at all.
  if (typeof WebGLRenderingContext === "undefined") {
    cached = false;
    return false;
  }
  try {
    const canvas = document.createElement("canvas");
    const gl =
      canvas.getContext("webgl2") ||
      canvas.getContext("webgl") ||
      canvas.getContext("experimental-webgl");
    cached = Boolean(gl);
  } catch {
    cached = false;
  }
  return cached;
}

/** test hook */
export function __resetWebGLCache(): void {
  cached = null;
}
