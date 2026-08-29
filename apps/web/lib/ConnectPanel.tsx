"use client";

/**
 * Run-start OpenRouter connection panel. One place to connect before the
 * clock starts, so track runners stay uncluttered: T1/T4 read the same
 * storage slots and show only a slim status line.
 *
 * Key handling matches the T1 runner: the key lives ONLY in this browser
 * (localStorage), never in the artifact or the event log.
 */
import { useEffect, useState } from "react";
import {
  buildAuthUrl,
  cleanCallbackUrl,
  clearLlmConnection,
  computeCodeChallenge,
  DEFAULT_BASE_URL,
  exchangeCodeForKey,
  extractCallbackCode,
  generateCodeVerifier,
  LLM_BASE_URL_STORAGE,
  normalizeBaseUrl,
  OpenRouterError,
  OPENROUTER_KEY_STORAGE,
  PKCE_VERIFIER_STORAGE,
} from "@ailx/track-t1";

/** Fired on every key/base change so the same page (e.g. the start gate)
 *  can re-read the connection state without prop drilling. */
export const CONNECTION_CHANGED_EVENT = "ailx:connection-changed";

function announceChange() {
  try {
    window.dispatchEvent(new Event(CONNECTION_CHANGED_EVENT));
  } catch {
    /* non-fatal */
  }
}

/** Capped proxy that fronts the operator's OpenRouter key (shared demo). */
export const SHARED_DEMO_BASE_URL = "https://ailx-shared-demo.vercel.app/api/v1";
/** Marker token — the proxy ignores auth; this just satisfies "connected". */
export const SHARED_DEMO_TOKEN = "shared-demo";

export function ConnectPanel({ attention = 0 }: { attention?: number } = {}) {
  const [orKey, setOrKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [ssoBusy, setSsoBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showManual, setShowManual] = useState(false);

  // Hydrate from the shared slots.
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(OPENROUTER_KEY_STORAGE);
      if (stored) setOrKey(stored);
      const storedBase = window.localStorage.getItem(LLM_BASE_URL_STORAGE);
      if (storedBase) setBaseUrl(storedBase);
    } catch {
      /* storage unavailable — connection simply not persisted */
    }
  }, []);

  // OAuth PKCE callback lands back on /exam: exchange ?code= for a key.
  useEffect(() => {
    const code = extractCallbackCode(window.location.search);
    if (!code) return;
    let verifier: string | null = null;
    try {
      verifier = window.localStorage.getItem(PKCE_VERIFIER_STORAGE);
    } catch {
      /* ignore */
    }
    if (!verifier) return;
    let cancelled = false;
    setSsoBusy(true);
    exchangeCodeForKey(fetch, code, verifier)
      .then((key) => {
        if (!cancelled) updateKey(key);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof OpenRouterError ? e.message : "OpenRouter sign-in failed.");
      })
      .finally(() => {
        if (cancelled) return;
        setSsoBusy(false);
        try {
          window.localStorage.removeItem(PKCE_VERIFIER_STORAGE);
        } catch {
          /* ignore */
        }
        window.history.replaceState(null, "", cleanCallbackUrl(window.location.href));
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateKey = (value: string) => {
    setOrKey(value);
    setError(null);
    try {
      if (value.trim().length > 0) window.localStorage.setItem(OPENROUTER_KEY_STORAGE, value.trim());
      else window.localStorage.removeItem(OPENROUTER_KEY_STORAGE);
    } catch {
      /* non-fatal */
    }
    announceChange();
  };

  const updateBaseUrl = (value: string) => {
    setBaseUrl(value);
    setError(null);
    try {
      if (normalizeBaseUrl(value) !== DEFAULT_BASE_URL) window.localStorage.setItem(LLM_BASE_URL_STORAGE, value.trim());
      else window.localStorage.removeItem(LLM_BASE_URL_STORAGE);
    } catch {
      /* non-fatal */
    }
    announceChange();
  };

  /** Disconnect means disconnected: key AND endpoint. Dropping only the key
   *  left the shared-demo/custom base URL in place, so the track runners
   *  stayed in real mode against a dead endpoint. */
  const disconnect = () => {
    setOrKey("");
    setBaseUrl("");
    setError(null);
    try {
      clearLlmConnection(window.localStorage);
    } catch {
      /* non-fatal */
    }
    announceChange();
  };

  const connect = async () => {
    if (ssoBusy) return;
    setSsoBusy(true);
    setError(null);
    try {
      const verifier = generateCodeVerifier((a) => window.crypto.getRandomValues(a));
      window.localStorage.setItem(PKCE_VERIFIER_STORAGE, verifier);
      const challenge = await computeCodeChallenge(verifier, window.crypto.subtle);
      window.location.href = buildAuthUrl(cleanCallbackUrl(window.location.href), challenge);
    } catch {
      setSsoBusy(false);
      setError("Could not start OpenRouter sign-in in this browser.");
    }
  };

  // Attention nudge: the start gate bumps this counter when the disabled
  // Start pill is clicked — pulse the panel and open manual setup.
  useEffect(() => {
    if (attention > 0) setShowManual(true);
  }, [attention]);

  const connected = orKey.trim().length > 0;
  const customBase = baseUrl.trim().length > 0 && normalizeBaseUrl(baseUrl) !== DEFAULT_BASE_URL;
  const sharedDemo = customBase && normalizeBaseUrl(baseUrl) === SHARED_DEMO_BASE_URL;

  // Shared demo: the operator's OpenRouter key lives behind a capped proxy
  // (model allowlist, per-IP rate limit, weekly budget). Nothing to paste.
  const useSharedDemo = () => {
    updateBaseUrl(SHARED_DEMO_BASE_URL);
    updateKey(SHARED_DEMO_TOKEN);
  };

  return (
    <section
      aria-label="AI connection"
      data-pill-clear=""
      className={attention > 0 ? "connect-attention" : undefined}
      key={`attn-${attention}`}
      style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12, padding: "1rem 1.2rem", margin: "1.4rem 0", display: "grid", gap: 8, boxShadow: "0 1px 2px rgba(26,26,26,0.05)" }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <strong style={{ fontSize: 15 }}>Bring a real model</strong>
        <span className="small faint" style={{ flex: 1, minWidth: 220 }}>
          Required to start: T1 vibe coding and T4 image generation run on your model. If a call fails mid-run, you can retry it or switch to the free offline demo simulators in one click.
        </span>
        {connected ? (
          <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
            <span style={{ fontSize: 12, color: "var(--good)" }}>{sharedDemo ? "● Shared demo model — capped, no key needed" : "● Connected — key stays in this browser"}</span>
            <button type="button" className="btn" style={{ padding: "4px 10px", fontSize: 12 }} onClick={disconnect}>
              Disconnect
            </button>
          </span>
        ) : (
          <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
            <button type="button" className="btn primary" style={{ padding: "6px 14px", fontSize: 13, opacity: ssoBusy ? 0.5 : 1 }} onClick={() => void connect()} disabled={ssoBusy}>
              {ssoBusy ? "Connecting…" : "Connect OpenRouter"}
            </button>
            <button type="button" className="btn" style={{ padding: "6px 10px", fontSize: 12 }} onClick={useSharedDemo}>
              Try the shared demo model
            </button>
            <button type="button" className="btn" style={{ padding: "6px 10px", fontSize: 12 }} onClick={() => setShowManual((s) => !s)}>
              {showManual ? "Hide manual setup" : "Manual setup"}
            </button>
          </span>
        )}
      </div>
      {customBase && !connected ? (
        <p className="small faint" style={{ margin: 0 }}>Custom endpoint set — local models need no key.</p>
      ) : null}
      {showManual && !connected ? (
        <div style={{ display: "grid", gap: 6 }}>
          <input
            aria-label="OpenRouter API key"
            type="password"
            autoComplete="off"
            className="mono"
            value={orKey}
            onChange={(e) => updateKey(e.target.value)}
            placeholder="paste an OpenRouter API key (stored only in this browser)"
          />
          <input
            aria-label="API base URL"
            className="mono"
            value={baseUrl}
            onChange={(e) => updateBaseUrl(e.target.value)}
            placeholder={DEFAULT_BASE_URL}
            title="Any OpenAI-compatible endpoint — e.g. http://localhost:11434/v1 for Ollama (key optional for local servers)"
          />
        </div>
      ) : null}
      {error ? (
        <p role="alert" style={{ margin: 0, color: "var(--bad)", fontSize: 12 }}>{error}</p>
      ) : null}
    </section>
  );
}
