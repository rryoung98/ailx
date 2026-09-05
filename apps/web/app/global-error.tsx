"use client";
/**
 * Last-resort boundary: a throw in the ROOT layout never reaches app/error.tsx,
 * so this one replaces the whole document. It ships its own inline styling
 * because the layout (and therefore globals.css) is exactly what failed.
 */
import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[ailx] global error", {
      message: error.message,
      digest: error.digest,
      stack: error.stack,
    });
  }, [error]);

  return (
    <html lang="en">
      <body style={{ margin: 0, background: "#f7f4f2", color: "#1a1a1a", fontFamily: "system-ui, sans-serif" }}>
        <main style={{ maxWidth: 640, margin: "0 auto", padding: "3rem 1.25rem" }}>
          <div role="alert" style={{ background: "#ffffff", border: "1px solid #e3ddd6", borderRadius: 12, padding: "1.5rem" }}>
            <h1 style={{ marginTop: 0, fontSize: "1.4rem" }}>Foray could not render this page</h1>
            <p style={{ color: "#595650" }}>
              Your run is stored in this browser and was not affected. Reload to
              continue where you left off.
            </p>
            <button
              onClick={() => reset()}
              style={{
                background: "#0b6b47", color: "#ffffff", border: "none", borderRadius: 8,
                padding: "0.6rem 1.2rem", fontSize: "1rem", cursor: "pointer",
              }}
            >
              Reload
            </button>
            <p style={{ color: "#6b665f", fontSize: "0.8rem", fontFamily: "ui-monospace, monospace" }}>
              {error.digest ? `digest ${error.digest} · ` : ""}{error.message || "unknown error"}
            </p>
          </div>
        </main>
      </body>
    </html>
  );
}
