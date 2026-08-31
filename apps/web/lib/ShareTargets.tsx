"use client";

/**
 * SHARE TARGETS — the buttons that actually send a share link somewhere.
 *
 * Rendered on the report (the owner, sharing their own card) and on the share
 * view (whoever holds the link, passing it on). Both get the same component
 * and the same copy source (`@ailx/report/shareText`), so the three networks
 * cannot drift apart or drift from the page.
 *
 * The Web Share API first, when the browser has it: on a phone it opens the
 * OS sheet with every installed app, which is the shortest path from "I
 * finished" to "my friend opened it". It is feature-detected AFTER mount —
 * `navigator.share` does not exist on the server, so detecting it during
 * render would hydrate a different tree than the server sent.
 *
 * Copy link is always there. It is the target that works with no popup
 * blocker, no app installed and no network integration at all.
 *
 * PRIVACY: every string here is derived from the frozen, allowlisted
 * `SharePayload` and the link's own URL (docs/SHARING.md §1). There is no
 * pixel, no beacon and no third-party script — the intents are plain links
 * the reader chooses to follow, and the only measurement AILX keeps is the
 * day-granular view row the share view already writes (§6).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  SHARE_NETWORK_LABEL,
  SHARE_NETWORKS,
  shareIntentUrl,
  shareText,
  shareTitle,
  type SharePayload,
  type SharePerspective,
} from "@ailx/report";

export function ShareTargets({
  url,
  payload,
  perspective = "mine",
  children,
}: {
  /** The absolute `/s/<token>` URL. Nothing else is ever shared. */
  url: string;
  payload: SharePayload;
  perspective?: SharePerspective;
  /** Extra controls (revoke, open) laid out in the same row. */
  children?: React.ReactNode;
}) {
  const [canNativeShare, setCanNativeShare] = useState(false);
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    setCanNativeShare(typeof navigator !== "undefined" && typeof navigator.share === "function");
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, []);

  const flashCopied = useCallback(() => {
    setCopied(true);
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), 1500);
  }, []);

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard?.writeText(url);
      flashCopied();
    } catch {
      // A denied clipboard permission is not an error worth a banner: the URL
      // is in a focusable, selectable field right above these buttons.
    }
  }, [url, flashCopied]);

  /** The OS sheet. A cancelled sheet rejects with AbortError — not a failure. */
  const nativeShare = useCallback(async () => {
    try {
      await navigator.share({
        title: shareTitle(payload),
        text: shareText(payload, "native", perspective),
        url,
      });
    } catch (err) {
      if ((err as Error | undefined)?.name === "AbortError") return;
      void copy();
    }
  }, [payload, perspective, url, copy]);

  return (
    // A named GROUP rather than a <fieldset>: these are links and buttons, not
    // form inputs; the role exists only to give the row one spoken name.
    <div
      className="share-targets"
      role="group"
      aria-label="Share this card"
      data-testid="share-targets"
      style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap", alignItems: "center" }}
    >
      {canNativeShare ? (
        <button
          type="button"
          className="btn small-btn primary"
          data-testid="share-native"
          onClick={() => void nativeShare()}
        >
          Share&hellip;
        </button>
      ) : null}
      {SHARE_NETWORKS.map((network) => (
        <a
          key={network}
          className="btn small-btn"
          data-testid={`share-${network}`}
          href={shareIntentUrl(network, payload, url, perspective)}
          target="_blank"
          rel="noreferrer noopener"
        >
          Share on {SHARE_NETWORK_LABEL[network]}
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
      ))}
      <button type="button" className="btn small-btn" data-testid="share-copy" onClick={() => void copy()}>
        {copied ? "copied \u2713" : "Copy link"}
      </button>
      <span className="sr-only" role="status">
        {copied ? "Link copied to the clipboard" : ""}
      </span>
      {children}
    </div>
  );
}
