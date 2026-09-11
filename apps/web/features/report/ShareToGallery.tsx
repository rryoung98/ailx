"use client";

/**
 * OPT-IN SHARE OF THE T4 CHOSEN SET TO THE PUBLIC COMMUNITY WALL.
 *
 * Uploads ONLY on click: the recompressed finals, the direction note and the
 * model id, and nothing else. Votes there are a human aesthetic signal and
 * never part of the score.
 *
 * IT LIVES IN ITS OWN FILE BECAUSE IT IS THE ONE THING ON THE REPORT THAT
 * TALKS TO A THIRD PARTY (TEN-235). It was an inline helper in
 * `app/report/page.tsx` with a hardcoded host, no deadline and no unmount
 * guard: a 1.3 MB POST to a demo host that stalls left the button on
 * "Sharing…" for the life of the page, and a per-DAY rate limit was reported
 * as "try again later", which is wrong by roughly a day.
 */
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { fetchWithDeadline, isTimeout } from "../../lib/data/deadline";
import { DEMO_GALLERY_API } from "../../lib/data/demoProxy";

/** Largest image the demo proxy accepts, and what we recompress toward. */
const MAX_IMAGE_BYTES = 440 * 1024;
/** The proxy takes at most three images per share. */
const MAX_IMAGES = 3;

type State =
  | { kind: "idle" }
  | { kind: "busy" }
  | { kind: "done" }
  | { kind: "failed"; said: string };

/**
 * What the candidate is told, by what actually happened.
 *
 * The two statuses that have their own sentence are the two the proxy really
 * issues and the two a generic "try again later" gets WRONG:
 * `services/openrouter-proxy/api/gallery/index.js` answers 429 for a DAILY
 * share limit and 413 for an image over its size cap. Neither is fixed by
 * waiting a moment, and 413 is not fixed by waiting at all.
 */
function failureCopy(status: number | null, timedOut: boolean): string {
  if (timedOut) {
    return "The community wall did not answer in time, so nothing was shared. It is slow rather than down — your set is untouched, so try again.";
  }
  if (status === 429) {
    return "The community wall takes one share per browser per day, and this one has had its share. Nothing was uploaded. Come back tomorrow.";
  }
  if (status === 413) {
    return "That set is too large for the community wall even after recompression, so nothing was uploaded. Sharing fewer or smaller images is the only thing that changes it.";
  }
  if (status !== null) {
    return `The community wall was reached and refused this (HTTP ${status}), so nothing was uploaded. Your set is untouched.`;
  }
  return "That did not reach the community wall. Your set is untouched — try again in a moment.";
}

export function ShareToGallery({ artifact }: { artifact: unknown }) {
  const [state, setState] = useState<State>({ kind: "idle" });
  /**
   * THE UNMOUNT GUARD. The upload is bounded but it is not instant, and a
   * candidate who navigates away mid-share used to leave a `setState` firing
   * into an unmounted tree. A ref rather than a local flag, because the
   * handler is not the effect: one flag has to outlive every click.
   */
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  const a = artifact as {
    finals?: { images?: { dataUri?: string; asset?: string; prompt?: string; modelId?: string }[] };
    chosenSet?: number[];
    note?: string;
  } | null;
  const chosen = (a?.chosenSet ?? []).map((i) => a?.finals?.images?.[i]).filter((f) => f?.dataUri);
  if (chosen.length === 0) return null;

  const share = async () => {
    setState({ kind: "busy" });
    try {
      const { recompressDataUri } = await import("@ailx/track-t4");
      const images = await Promise.all(
        chosen.slice(0, MAX_IMAGES).map(async (f) => {
          const uri = f!.dataUri!;
          return uri.length > MAX_IMAGE_BYTES ? await recompressDataUri(uri, MAX_IMAGE_BYTES) : uri;
        }),
      );
      /* BOUNDED AS AN `upload`, from the one table (lib/data/deadline.ts).
         The body is up to three recompressed images — megabytes on a phone's
         uplink — so a `write` bound would give up on a share that was still
         going out. `fetchWithDeadline` bounds the REQUEST, and that is the
         right shape here because nothing reads the body: the button only
         needs to know the wall accepted it. */
      const res = await fetchWithDeadline("upload", DEMO_GALLERY_API, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          images,
          note: (a?.note ?? "").slice(0, 800),
          model: chosen[0]?.modelId ?? "",
        }),
      });
      if (!live.current) return;
      if (!res.ok) {
        setState({ kind: "failed", said: failureCopy(res.status, false) });
        return;
      }
      setState({ kind: "done" });
    } catch (err) {
      if (!live.current) return;
      setState({ kind: "failed", said: failureCopy(null, isTimeout(err)) });
    }
  };

  return (
    <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: "0.6rem", flexWrap: "wrap" }}>
      {state.kind === "done" ? (
        <Link className="btn small-btn" href="/wall">On the wall — see the sets →</Link>
      ) : (
        <button className="btn small-btn" onClick={share} disabled={state.kind === "busy"}>
          {state.kind === "busy" ? "Sharing…" : "Share this set to the community wall"}
        </button>
      )}
      {state.kind === "failed" ? (
        <span className="small faint" role="alert" data-testid="wall-share-error">
          {state.said}
        </span>
      ) : null}
      <span className="small faint">
        Opt-in and public. Uploads the chosen finals + direction note, nothing else.
      </span>
    </div>
  );
}
