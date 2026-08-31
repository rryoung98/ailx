import type { Metadata } from "next";
import { Suspense } from "react";
import { GalleryView } from "../../lib/GalleryView";
import { PageLoading } from "../../lib/PageNotice";

/**
 * /gallery — the public wall.
 *
 * Still `page.api.tsx`: the extension is what keeps a database-backed page
 * out of the static GitHub Pages export (next.config.mjs `pageExtensions`),
 * and the static build links to the T4 community wall at /wall instead.
 *
 * The file is now a server shell for `metadata` alone — a client component
 * cannot export it. The page is `lib/GalleryView.tsx`, which fetches
 * `apiBase()/gallery` over HTTP (docs/ARCHITECTURE.md §10.1). The Suspense
 * boundary is what `useSearchParams` requires; the page is force-dynamic, so
 * it is a formality rather than a render path.
 */

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "AILX gallery — how people are actually doing with AI",
  description:
    "Player-type cards people chose to publish from real AILX runs: what they built, how their four tracks came out, and the type it adds up to.",
};

export default function GalleryPage() {
  return (
    <Suspense
      fallback={
        <PageLoading
          eyebrow="PUBLIC GALLERY · PUBLISHED BY THEIR OWNERS"
          title="What people can actually do with AI."
        />
      }
    >
      <GalleryView />
    </Suspense>
  );
}
