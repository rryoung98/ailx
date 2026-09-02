"use client";

/**
 * The two things a page can say instead of its content, in one place.
 *
 * Every page that moved off the in-process handlers can now fail in a way it
 * never could before: the network. A blank page would be a lie by omission,
 * and seven private copies of "sorry" would drift, so both states live here
 * and keep the same chrome as the page they replace.
 */
import type { ReactNode } from "react";
import { SERVICE_ERROR_COPY } from "../lib/serviceFetch";

export function PageNotice({
  eyebrow,
  title,
  width = "24ch",
  children,
}: {
  eyebrow?: string;
  title: string;
  width?: string;
  children?: ReactNode;
}) {
  return (
    <main className="page">
      <div className="container">
        {eyebrow === undefined ? null : <p className="eyebrow">{eyebrow}</p>}
        <h1 style={{ maxWidth: width }}>{title}</h1>
        {children === undefined ? null : (
          <p className="lede" aria-live="polite">
            {children}
          </p>
        )}
      </div>
    </main>
  );
}

/** While the call is in flight. Announced, so a screen reader is not left silent. */
export function PageLoading({ eyebrow, title }: { eyebrow?: string; title: string }) {
  return (
    <PageNotice eyebrow={eyebrow} title={title}>
      Loading&hellip;
    </PageNotice>
  );
}

/** The call never landed. Say so — never an empty page pretending to be data. */
export function PageError({ eyebrow, title }: { eyebrow?: string; title: string }) {
  return (
    <PageNotice eyebrow={eyebrow} title={title}>
      {SERVICE_ERROR_COPY}
    </PageNotice>
  );
}
