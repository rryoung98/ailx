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
import { useCallback, useEffect, useState } from "react";
import {
  clearLlmConnection,
  hasModelEndpoint,
  isUsableModelEndpoint,
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
  statusFailureCopy,
  type KeyStatus,
  type KeyStatusResult,
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
 * Every clause is something THIS code makes true, after a review flagged the
 * first draft for claiming backend guarantees the public repo cannot show:
 *
 *  - "never received your key" — the exchange is the service's, and no module
 *    here can build an `Authorization` header for a provider;
 *  - "only ever shows this fingerprint" — `readStatusBody()` drops anything
 *    that is not 12 hex characters, so it is true whatever arrives;
 *  - "asks the service to delete it", not "deletes it" — the browser makes a
 *    request, and a refusal is now reported instead of claimed as success.
 *
 * The word "sealed" is gone. It is true (AES-256-GCM per identity, in the
 * private repo) and it is not this page's to promise; the service's own
 * README is where a reader can check it.
 */
export function connectedCopy(fingerprint: string | undefined): string {
  const print = fingerprint === undefined ? "" : ` · ${fingerprint}`;
  return `● Connected${print} — this browser never received your key. The AILX service holds it against your account and only ever shows the fingerprint. Disconnect asks the service to delete it.`;
}

/** What the static export is told instead of being offered a key box. */
/** A typed endpoint that cannot be used, and why — never a silent drop. */
export const UNUSABLE_ENDPOINT_COPY =
  "This browser will not use that endpoint. It must be an http(s) URL with no username, password, query or fragment; a key does not belong in a URL, and this box will not carry one.";

/** Storage is blocked, so the panel and the Start gate disagree. Say so. */
export const STORAGE_BLOCKED_COPY =
  "This browser blocked local storage, so the run cannot see the connection this panel is showing. Allow storage for this site, or the Start button stays shut.";

export const STATIC_NO_KEY_COPY =
  "This is the static demo on GitHub Pages. No AILX service, so nothing to sign in to and no key to paste. Use the capped shared demo model, or point this build at a model on your own machine.";

export function ConnectPanel({ attention = 0 }: { attention?: number } = {}) {
  const hosted = modelGatewayAvailable();
  const [baseUrl, setBaseUrl] = useState("");
  const [status, setStatus] = useState<KeyStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showManual, setShowManual] = useState(false);
  /** Storage refused a write, so what this panel says and what the run-start
   *  gate reads have come apart. Said out loud rather than swallowed. */
  const [storageBlocked, setStorageBlocked] = useState(false);

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
   *
   * Defined ABOVE the effects that call it, and stable, so it can be a real
   * dependency rather than a captured closure behind a lint disable — the
   * shape of TEN-64 defect 4, which this panel is not going to repeat.
   */
  const applyStatus = useCallback((s: KeyStatus) => {
    setStatus(s);
    try {
      if (s.connected) window.localStorage.setItem(LLM_BASE_URL_STORAGE, modelGatewayBase());
      else clearLlmConnection(window.localStorage);
      setStorageBlocked(false);
    } catch {
      // A review caught the desync: the panel would say Connected while the
      // Start gate, which reads the slot, stayed shut — and the reader would
      // have no idea why. Say it instead of swallowing it.
      setStorageBlocked(true);
    }
    announceChange();
  }, []);

  /** What the service said, or why it would not say. Refusals are not "no key". */
  const applyResult = useCallback(
    (result: KeyStatusResult) => {
      if (result.ok) {
        applyStatus(result.status);
        setError(null);
      } else {
        setError(statusFailureCopy(result.httpStatus));
      }
    },
    [applyStatus],
  );

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

  /**
   * The callback, as a MUTATION.
   *
   * One non-idempotent call, no retry, no cache entry, side effects in the
   * handlers. It carries a `code` and a `state` and no verifier: the verifier
   * is on the service, which is what moved. `claimModelCallback()` takes the
   * code out of the URL AND records it in memory, so StrictMode's second pass
   * has nothing to spend (TEN-64 defect 1) even in a browser that refuses
   * `history.replaceState`.
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

  /**
   * Hosted: find out what the service holds — ONE effect, because a review
   * found the race when there were two.
   *
   * A landing that carries a callback used to fire the status GET and the
   * callback POST together, and a "not connected" GET answering last
   * overwrote the connection that had just been made. The callback is
   * authoritative when there is one, so the GET is not made at all.
   *
   * It re-runs on FOCUS and on a cross-tab storage write, which is the
   * cheapest honest answer to a sign-out: the tab that signed out is not
   * necessarily this one, and a stale "Connected" here would open the Start
   * gate on a sitting whose model calls all 401.
   */
  useEffect(() => {
    if (!hosted) return;
    const claimed = claimModelCallback();
    if (claimed !== null) {
      claim(claimed);
      return;
    }
    let cancelled = false;
    const read = () => {
      void readKeyStatus().then((result) => {
        if (!cancelled) applyResult(result);
      });
    };
    read();
    window.addEventListener("focus", read);
    window.addEventListener("storage", read);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", read);
      window.removeEventListener("storage", read);
    };
  }, [hosted, claim, applyResult]);

  const updateBaseUrl = (value: string) => {
    setBaseUrl(value);
    try {
      // A half-typed URL is not an error and not a connection: it is simply
      // not usable yet, so nothing is stored and nothing is claimed.
      if (isUsableModelEndpoint(value)) {
        window.localStorage.setItem(LLM_BASE_URL_STORAGE, normalizeBaseUrl(value));
        setError(null);
      } else {
        window.localStorage.removeItem(LLM_BASE_URL_STORAGE);
        setError(hasModelEndpoint(value) ? UNUSABLE_ENDPOINT_COPY : null);
      }
    } catch {
      setStorageBlocked(true);
    }
    announceChange();
  };

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
    onSuccess: applyResult,
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

  // Connected statically means USABLE, not merely non-empty. A review found
  // that any keystroke made `connected` true, which closed the very input the
  // reader was still typing into.
  const endpointSet = isUsableModelEndpoint(baseUrl);
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
          Required to start: T1 (vibe coding) and T4 (image generation) run on your model. If a call fails mid-run, retry it or switch to the free offline simulators in one click.
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
            {hosted ? null : (
              <button type="button" className="btn" style={{ padding: "4px 10px", fontSize: 12 }} onClick={() => setShowManual((v) => !v)}>
                {showManual ? "Hide manual setup" : "Manual setup"}
              </button>
            )}
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
              <button type="button" className="btn" style={{ padding: "6px 10px", fontSize: 12 }} onClick={() => setShowManual((v) => !v)}>
                {showManual ? "Hide manual setup" : "Manual setup"}
              </button>
            )}
          </span>
        )}
      </div>
      {hosted ? (
        <p className="small faint" style={{ margin: 0 }}>
          Signing in sends you to OpenRouter and back. The AILX service does the exchange, so your key never reaches this browser. This page sees only a fingerprint.
        </p>
      ) : (
        <p className="small faint" style={{ margin: 0 }} data-testid="static-no-key">
          {STATIC_NO_KEY_COPY}
        </p>
      )}
      {storageBlocked ? (
        <p role="alert" style={{ margin: 0, color: "var(--bad)", fontSize: 12 }}>{STORAGE_BLOCKED_COPY}</p>
      ) : null}
      {showManual && !hosted ? (
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
