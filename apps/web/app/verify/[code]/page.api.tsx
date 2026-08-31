import type { Metadata } from "next";
import { credentialViewFrom } from "../../../lib/credentialView";
import { serverApiBase } from "../../../lib/server/page";
import { VerifyView } from "../../../lib/VerifyView";

/**
 * /verify/<code> — credential verification.
 *
 * Still `page.api.tsx`: the extension keeps a database-backed page out of the
 * static GitHub Pages export (next.config.mjs `pageExtensions`), because a
 * credential that cannot be verified live is worse than no credential. It
 * does not oblige the file to be server-only, so the page itself is
 * `lib/VerifyView.tsx`, which reads the public JSON twin through `apiBase()`.
 *
 * `generateMetadata` stays on the SERVER and does its own read, because the
 * tab title and description have to be honest about a revocation before any
 * client code runs. It is the only reason this file still fetches at all.
 *
 * NOINDEX: verification is by link, not by search. A credential names a
 * person's sitting; indexing them would build a directory of candidates
 * nobody asked for. It costs a verifier nothing — they arrive with the URL.
 */

export const dynamic = "force-dynamic";

type VerifyParams = { params: Promise<{ code: string }> };

export async function generateMetadata({ params }: VerifyParams): Promise<Metadata> {
  const { code } = await params;
  const robots = { index: false, follow: false };
  let credential = null;
  try {
    const res = await fetch(
      `${await serverApiBase()}/credentials/${encodeURIComponent(code)}`,
      { cache: "no-store" },
    );
    credential = res.status === 200 ? credentialViewFrom(await res.json()) : null;
  } catch {
    // Unreachable service: the PAGE says so out loud. A tab title cannot,
    // so it falls back to the same wording an unknown code gets rather than
    // claiming a credential we did not read.
    credential = null;
  }
  if (credential === null) return { title: "AILX — credential not found", robots };
  return {
    title: `${credential.name} — verification`,
    description:
      credential.status === "revoked"
        ? "This AILX credential has been revoked."
        : "Issued by AILX. This page states exactly what the credential asserts, and what it does not.",
    robots,
  };
}

export default function VerifyPage() {
  return <VerifyView />;
}
