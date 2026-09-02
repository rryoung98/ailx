import type { Metadata } from "next";
import { apiPath, shareCardPath, shareUrlPath } from "@ailx/contract";
import type { SharePayload } from "@ailx/report";
import { pageOrigin, serverApiBase } from "../../../lib/server/page";
import { ShareView, type SharedView } from "../../../lib/ShareView";

/**
 * /s/<token> — the share view.
 *
 * Still `page.api.tsx`: the `.api.*` extensions are only in `pageExtensions`
 * for the AILX_BACKEND=1 build (next.config.mjs), so this database-backed
 * page simply does not exist in the GitHub Pages static export. That is the
 * page twin of the long-standing `route.api.ts` rule. The extension controls
 * static INCLUSION, not whether the file is server-only, so the page itself
 * is `lib/ShareView.tsx` and reads `apiBase()/share/<token>` over HTTP
 * (docs/ARCHITECTURE.md §10.1).
 *
 * `generateMetadata` stays on the SERVER and does its own read: the Open
 * Graph card IS the share — a scraper never runs client JavaScript, so
 * without a server read every shared link would unfurl as a bare title.
 */

export const dynamic = "force-dynamic";

type ShareParams = { params: Promise<{ token: string }> };

/** The same anonymous read the page makes. Never counts a view (see below). */
async function readShare(token: string): Promise<SharedView | null> {
  try {
    const res = await fetch(`${await serverApiBase()}${apiPath("shareView", { token })}`, {
      cache: "no-store",
    });
    if (res.status !== 200) return null;
    const body = (await res.json()) as { share?: SharedView };
    return body.share ?? null;
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: ShareParams): Promise<Metadata> {
  const { token } = await params;
  const share = await readShare(token);
  if (share === null) {
    return { title: "AILX — link not found", robots: { index: false, follow: false } };
  }
  const p: SharePayload = share.payload;
  const origin = await pageOrigin();
  const title = `${p.playerType.code} · ${p.playerType.name} — AILX player type`;
  const description = `${p.playerType.tagline} Band: ${p.band}. Find your own type on AILX.`;
  const url = `${origin}${shareUrlPath(token)}`;
  const image = `${origin}${shareCardPath(token)}`;
  return {
    title,
    description,
    // Unlisted, never indexed: a capability URL must not become a search hit.
    robots: { index: false, follow: false },
    alternates: { canonical: url },
    openGraph: {
      type: "profile",
      siteName: "AILX",
      title,
      description,
      url,
      images: [{ url: image, width: 1200, height: 630, alt: `${p.playerType.code} — ${p.playerType.name}` }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [image],
    },
  };
}

export default function SharePage() {
  return <ShareView />;
}
