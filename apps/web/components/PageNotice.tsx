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
import { SERVICE_ERROR_COPY } from "../lib/data/serviceFetch";

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

/**
 * The call never landed, or what came back could not be read. Say so — never
 * an empty page pretending to be data.
 *
 * `message` carries the state's own sentence when there is one, because
 * "we could not reach the service" and "the service said something we could
 * not read" are different facts and the second is our bug, not the reader's
 * network (`SERVICE_INVALID_COPY`).
 */
export function PageError({
  eyebrow,
  title,
  message = SERVICE_ERROR_COPY,
}: {
  eyebrow?: string;
  title: string;
  message?: string;
}) {
  return (
    <PageNotice eyebrow={eyebrow} title={title}>
      {message}
    </PageNotice>
  );
}
