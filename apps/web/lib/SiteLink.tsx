"use client";

/**
 * Link to a published T1 site snapshot. The href is the server path — the
 * VISIBLE text must not be: the raw `/api/site/sha256:…/` string wrapped
 * over three lines on a phone and could not be pasted anywhere useful
 * (staging dogfood). One component so the run flow and the report label it
 * identically.
 */
export function SiteLink({ url, label = "Open your site" }: { url: string; label?: string }) {
  return (
    <a href={url} target="_blank" rel="noreferrer" title={url}>
      {label} <span aria-hidden>↗</span>
    </a>
  );
}
