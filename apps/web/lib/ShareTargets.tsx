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
  dailyShareIntentUrl,
  dailyShareText,
  dailyShareTitle,
  shareIntentUrl,
  shareText,
  shareTitle,
  type DailyShare,
  type ShareNetwork,
  type SharePayload,
  type SharePerspective,
} from "@ailx/report";

/**
 * What the row says, whatever it is sharing. Two things are shared through
 * these buttons — a player-type CARD and a DAILY result — and they differ
 * only in their words and in what "copy" puts on the clipboard, so they get
 * one component rather than two copies of the Web Share plumbing.
 */
interface ShareTargetsCopy {
  /** The spoken name of the row. */
  groupLabel: string;
  title: string;
  nativeText: string;
  intentUrl: (network: ShareNetwork) => string;
  /** What the copy button writes. A link for a card; the grid for a daily. */
  clipboard: string;
  copyLabel: string;
  copiedLabel: string;
  /** What the live region says. Spoken, so it names the thing, not the icon. */
  copiedStatus: string;
}

function payloadCopy(
  payload: SharePayload,
  perspective: SharePerspective,
  url: string,
): ShareTargetsCopy {
  return {
    groupLabel: "Share this card",
    title: shareTitle(payload),
    nativeText: shareText(payload, "native", perspective),
    intentUrl: (network) => shareIntentUrl(network, payload, url, perspective),
    clipboard: url,
    copyLabel: "Copy link",
    copiedLabel: "copied \u2713",
    copiedStatus: "Link copied to the clipboard",
  };
}

/**
 * The daily's copy button puts the GRID and the link on the clipboard, not
 * the link alone: the grid is the thing people paste, and a share that made
 * you retype it would not be pasted at all. Everything in it comes from
 * `dailyShareText`, so it cannot say more than the grid already may.
 */
function dailyCopy(share: DailyShare, url: string): ShareTargetsCopy {
  return {
    groupLabel: "Share today's result",
    title: dailyShareTitle(share),
    nativeText: dailyShareText(share, "native"),
    intentUrl: (network) => dailyShareIntentUrl(network, share, url),
    clipboard: `${dailyShareText(share, "native")}\n${url}`,
    copyLabel: "Copy result",
    copiedLabel: "copied \u2713",
    copiedStatus: "Result copied to the clipboard",
  };
}

/**
 * Exactly one of `payload` (a player-type card) and `daily` (a daily result)
 * is given. The union is the type doing the work: there is no state in which
 * the row has both or neither to render.
 */
export type ShareTargetsProps = {
  /** The absolute URL. Nothing else is ever shared. */
  url: string;
  /** Extra controls (revoke, open) laid out in the same row. */
  children?: React.ReactNode;
} & (
  | { payload: SharePayload; perspective?: SharePerspective; daily?: undefined }
  | { daily: DailyShare; payload?: undefined; perspective?: undefined }
);

export function ShareTargets({ url, children, ...source }: ShareTargetsProps) {
  const copySource: ShareTargetsCopy =
    source.daily !== undefined
      ? dailyCopy(source.daily, url)
      : payloadCopy(source.payload, source.perspective ?? "mine", url);
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
      await navigator.clipboard?.writeText(copySource.clipboard);
      flashCopied();
    } catch {
      // A denied clipboard permission is not an error worth a banner: the URL
      // is in a focusable, selectable field right above these buttons.
    }
  }, [copySource.clipboard, flashCopied]);

  /** The OS sheet. A cancelled sheet rejects with AbortError — not a failure. */
  const nativeShare = useCallback(async () => {
    try {
      await navigator.share({
        title: copySource.title,
        text: copySource.nativeText,
        url,
      });
    } catch (err) {
      if ((err as Error | undefined)?.name === "AbortError") return;
      void copy();
    }
  }, [copySource.title, copySource.nativeText, url, copy]);

  return (
    // A named GROUP rather than a <fieldset>: these are links and buttons, not
    // form inputs; the role exists only to give the row one spoken name.
    <div
      className="share-targets"
      role="group"
      aria-label={copySource.groupLabel}
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
          href={copySource.intentUrl(network)}
          target="_blank"
          rel="noreferrer noopener"
        >
          Share on {SHARE_NETWORK_LABEL[network]}
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
      ))}
      <button type="button" className="btn small-btn" data-testid="share-copy" onClick={() => void copy()}>
        {copied ? copySource.copiedLabel : copySource.copyLabel}
      </button>
      <span className="sr-only" role="status">
        {copied ? copySource.copiedStatus : ""}
      </span>
      {children}
    </div>
  );
}
