"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { redirectTarget } from "../lib/redirect404";

export default function NotFound() {
  const [redirecting, setRedirecting] = useState(false);

  useEffect(() => {
    const t = redirectTarget(window.location.pathname, window.location.search, window.location.hash);
    if (t) {
      setRedirecting(true);
      window.location.replace(t);
    }
  }, []);

  return (
    <main className="page">
      <div className="container" style={{ maxWidth: 640, textAlign: "center", paddingTop: "4rem" }}>
        {redirecting ? (
          <p className="muted">Taking you to the right page…</p>
        ) : (
          <>
            <h1>Lost the <span className="script-accent">trail</span>.</h1>
            <p className="lede" style={{ margin: "1rem auto" }}>This page does not exist. The run, the report, and the receipts all do.</p>
            <p><Link className="btn primary" href="/">Back to the start</Link></p>
          </>
        )}
      </div>
    </main>
  );
}
