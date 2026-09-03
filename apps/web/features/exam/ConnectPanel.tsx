"use client";

/**
 * Run-start model connection panel — and the ONE place a browser starts or
 * ends a provider connection.
 *
 * THE BROWSER NEVER RECEIVES A PROVIDER CREDENTIAL (TEN-62). It used to hold
 * one: an OpenRouter key, pasted or won by doing the OAuth PKCE exchange
 * here, kept in localStorage. Now the exam service does the exchange and
 * stores the key sealed against the caller's identity; the browser starts the
 * connection, is redirected, comes back with a code it hands straight over,
 * and is told a 12-hex FINGERPRINT. A fingerprint buys nothing.
 *
 * The two builds are honestly different, and this panel says which one you
 * are in rather than offering an affordance that cannot work:
 *
 *  - HOSTED (`AILX_BACKEND=1`): connect, disconnect, and a key held by the
 *    service. Every gateway route refuses an unauthenticated caller.
 *  - STATIC EXPORT (GitHub Pages): there is no exam service and no identity,
 *    so there is NO personal-key affordance at all — not a hidden one, not a
 *    paste box. What is offered is the capped shared demo, and a local
 *    OpenAI-compatible endpoint for anyone running their own model. The
 *    static tier issues no score of record, so it does not need a credential.
 */
import { useMutation } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  clearLlmConnection,
  hasModelEndpoint,
  LLM_BASE_URL_STORAGE,
  normalizeBaseUrl,
} from "@ailx/track-t1";
import {
  claimModelCallback,
  disconnectKey,
  finishConnect,
  modelGatewayAvailable,
  modelGatewayBase,
  readKeyStatus,
  startConnect,
  type KeyStatus,
  type ModelCallback,
} from "../../lib/data/modelGateway";

/** Fired on every connection change so the same page (e.g. the start gate)
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

/**
 * What a connected candidate is told, in the hosted build.
 *
 * Three facts, all of them checkable, and none of them the old claim: the
 * browser never receives the key, the service holds it sealed against this
 * identity, and it can be revoked. It deliberately does NOT say the key
 * cannot be spent by us — it can, that is what connecting it is for.
 */
export function connectedCopy(fingerprint: string | undefined): string {
  const print = fingerprint === undefined ? "" : ` · ${fingerprint}`;
  return `● Connected${print} — this browser never received your key. The AILX service holds it sealed against your account and spends it only for your sitting. Disconnect deletes it.`;
}

/** What the static export is told instead of being offered a key box. */
export const STATIC_NO_KEY_COPY =
  "This is the static demo on GitHub Pages. There is no AILX service here to hold a provider key against, so there is nothing to sign in to and no key to paste. Use the capped shared demo model, or point this build at a model running on your own machine.";

export function ConnectPanel({ attention = 0 }: { attention?: number } = {}) {
  const hosted = modelGatewayAvailable();
  const [baseUrl, setBaseUrl] = useState("");
  const [status, setStatus] = useState<KeyStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showManual, setShowManual] = useState(false);

  // Static export: hydrate the stored endpoint. Nothing else is stored.
  useEffect(() => {
    if (hosted) return;
    try {
      const storedBase = window.localStorage.getItem(LLM_BASE_URL_STORAGE);
      if (storedBase) setBaseUrl(storedBase);
    } catch {
      /* storage unavailable — connection simply not persisted */
    }
  }, [hosted]);

  // Hosted: ask the service whether it is holding a key for this identity.
  useEffect(() => {
    if (!hosted) return;
    let cancelled = false;
    void readKeyStatus().then((s) => {
      if (!cancelled) applyStatus(s);
    });
    return () => {
      cancelled = true;
    };
  }, [hosted]);

  /**
   * Record what the service just said, and mirror it into the ONE endpoint
   * slot the track runners read.
   *
   * The slot holds a URL and never a credential — the gateway's own address,
   * which is public. Mirroring it is what keeps a single seam: the runners
   * and the start gate ask "is there an endpoint", and they get the same
   * answer in both builds without either of them knowing about identities or
   * fingerprints. A stale slot cannot outlive a sign-out, because this runs
   * on mount and clears it when the service says it holds nothing.
   */
  const applyStatus = (s: KeyStatus) => {
    setStatus(s);
    try {
      if (s.connected) window.localStorage.setItem(LLM_BASE_URL_STORAGE, modelGatewayBase());
      else clearLlmConnection(window.localStorage);
    } catch {
      /* non-fatal — the panel still shows the truth it was told */
    }
    announceChange();
  };

  const updateBaseUrl = (value: string) => {
    setBaseUrl(value);
    setError(null);
    try {
      if (hasModelEndpoint(value)) window.localStorage.setItem(LLM_BASE_URL_STORAGE, normalizeBaseUrl(value));
      else window.localStorage.removeItem(LLM_BASE_URL_STORAGE);
    } catch {
      /* non-fatal */
    }
    announceChange();
  };

  /**
   * The callback, as a MUTATION.
   *
   * One non-idempotent call, no retry, no cache entry, side effects in the
   * handlers. It carries a `code` and a `state` and no verifier: the verifier
   * is on the service, which is what moved. `claimModelCallback()` still
   * takes the code OUT of the URL before the request, so StrictMode's second
   * pass has nothing to spend (TEN-64 defect 1) and the code does not sit in
   * browser history.
   */
  const exchange = useMutation({
    mutationFn: (claim: ModelCallback) => finishConnect(claim),
    onSuccess: (result) => {
      if (result.ok) {
        applyStatus(result.status);
        setError(null);
      } else {
        setError(result.message);
      }
    },
    onError: () => setError("The AILX service could not be reached to finish the connection."),
  });
  const claim = exchange.mutate;

  useEffect(() => {
    if (!hosted) return;
    const claimed = claimModelCallback();
    if (claimed !== null) claim(claimed);
  }, [hosted, claim]);

  const connect = useMutation({
    mutationFn: () => startConnect(),
    onSuccess: (result) => {
      if (!result.ok) {
        setError(result.message);
        return;
      }
      // The service minted the URL and holds the verifier; the browser only
      // travels. It never learns the challenge and never sees the key.
      window.location.href = result.start.authorizeUrl;
    },
    onError: () => setError("The AILX service could not be reached to start a connection."),
  });

  const forget = useMutation({
    mutationFn: () => disconnectKey(),
    onSuccess: (s) => {
      applyStatus(s);
      setError(null);
    },
    onError: () => setError("The AILX service could not be reached to disconnect."),
  });

  const busy = connect.isPending || exchange.isPending || forget.isPending;

  /** Static export only: forget the endpoint (there is no key to forget). */
  const clearEndpoint = () => {
    setBaseUrl("");
    setError(null);
    try {
      clearLlmConnection(window.localStorage);
    } catch {
      /* non-fatal */
    }
    announceChange();
  };

  // Attention nudge: the start gate bumps this counter when the disabled
  // Start pill is clicked — pulse the panel and open manual setup.
  useEffect(() => {
    if (attention > 0) setShowManual(true);
  }, [attention]);

  const endpointSet = hasModelEndpoint(baseUrl);
  const sharedDemo = endpointSet && normalizeBaseUrl(baseUrl) === SHARED_DEMO_BASE_URL;
  const connected = hosted ? status?.connected === true : endpointSet;

  /** Shared demo: the operator's key sits behind a capped proxy. Nothing to paste. */
  const useSharedDemo = () => updateBaseUrl(SHARED_DEMO_BASE_URL);

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
            <span style={{ fontSize: 12, color: "var(--good)" }}>
              {hosted
                ? connectedCopy(status?.fingerprint)
                : sharedDemo
                  ? "● Shared demo model — capped, no key needed, no key held"
                  : "● Connected to your own endpoint — no key left this browser, because there is none to leave."}
            </span>
            <button
              type="button"
              className="btn"
              style={{ padding: "4px 10px", fontSize: 12 }}
              onClick={hosted ? () => forget.mutate() : clearEndpoint}
              disabled={busy}
            >
              Disconnect
            </button>
          </span>
        ) : (
          <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
            {hosted ? (
              <button type="button" className="btn primary" style={{ padding: "6px 14px", fontSize: 13, opacity: busy ? 0.5 : 1 }} onClick={() => connect.mutate()} disabled={busy}>
                {busy ? "Connecting…" : "Connect OpenRouter"}
              </button>
            ) : (
              <button type="button" className="btn" style={{ padding: "6px 10px", fontSize: 12 }} onClick={useSharedDemo}>
                Try the shared demo model
              </button>
            )}
            {hosted ? null : (
              <button type="button" className="btn" style={{ padding: "6px 10px", fontSize: 12 }} onClick={() => setShowManual((s) => !s)}>
                {showManual ? "Hide manual setup" : "Manual setup"}
              </button>
            )}
          </span>
        )}
      </div>
      {hosted ? (
        <p className="small faint" style={{ margin: 0 }}>
          Signing in sends you to OpenRouter and back. The AILX service does the exchange: your key never reaches this browser, and this page never sees more of it than a fingerprint.
        </p>
      ) : (
        <p className="small faint" style={{ margin: 0 }} data-testid="static-no-key">
          {STATIC_NO_KEY_COPY}
        </p>
      )}
      {showManual && !connected && !hosted ? (
        <div style={{ display: "grid", gap: 6 }}>
          <input
            aria-label="API base URL"
            className="mono"
            value={baseUrl}
            onChange={(e) => updateBaseUrl(e.target.value)}
            placeholder="http://localhost:11434/v1"
            title="Any OpenAI-compatible endpoint — e.g. http://localhost:11434/v1 for Ollama. No key is sent from this browser."
          />
        </div>
      ) : null}
      {error ? (
        <p role="alert" style={{ margin: 0, color: "var(--bad)", fontSize: 12 }}>{error}</p>
      ) : null}
    </section>
  );
}
