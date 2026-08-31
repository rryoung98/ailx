import "./globals.css";
import type { Metadata } from "next";
import { Fraunces, Caveat } from "next/font/google";

/* Self-hosted at build time (static export stays offline). */
const serif = Fraunces({ subsets: ["latin"], axes: ["opsz"], weight: "variable", variable: "--font-serif", display: "swap" });
const script = Caveat({ subsets: ["latin"], weight: "variable", variable: "--font-script", display: "swap" });
import Link from "next/link";
import { Loader } from "../lib/Loader";
import { NavLink } from "../lib/NavLink";
import { assetUrl, footerModeCopy, isServerMode } from "../lib/mode";

export const metadata: Metadata = {
  title: "AILX — the AI-literacy game that scores like an instrument",
  description:
    "Four playable tracks — build, detect, reason, direct. 400 raw points, audit-grade scoring, built to the AILX 2026.1 specification. Live demo build.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${serif.variable} ${script.variable}`}>
      <body>
        <Loader />
        <a href="#main" className="skip-link">Skip to main content</a>
        <header className="site-header">
          <div className="inner">
            <Link href="/" className="wordmark" aria-label="AILX home">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={assetUrl("/media/logo.svg")} alt="AILX" className="wordmark-img" />
            </Link>
            <nav className="site-nav" aria-label="Primary">
              {/* One scrolling row on a phone (display:contents on desktop, so
                  the links stay direct flex children there). It used to wrap
                  into two rows: 130px of chrome on every page before any
                  content. Every route below is still in it, in both builds. */}
              <div className="nav-links">
                {/* The graded run keeps a plain, obvious slot. It is no longer
                    the pill: the pill is the fast, free thing, and a four-hour
                    sitting is a terrible first click. */}
                <NavLink href="/exam">Full run</NavLink>
                {/* /progress reads the store, so it is hosted-only. Practice
                    plays in BOTH builds (its corpus is bundled) and is the
                    pill, so it is not repeated here. */}
                {isServerMode() && <NavLink href="/progress">Progress</NavLink>}
                <NavLink href="/report">Report</NavLink>
                {/* The share gallery reads the database, so it exists only in
                    the hosted build; the static export links the T4 community
                    wall instead. One nav slot, never a link that cannot work. */}
                {isServerMode() ? (
                  <>
                    <NavLink href="/gallery">Gallery</NavLink>
                    <NavLink href="/world">World</NavLink>
                  </>
                ) : (
                  <NavLink href="/wall">Wall</NavLink>
                )}
                <NavLink href="/methodology">Methodology</NavLink>
                <NavLink href="/validate">Validate</NavLink>
              </div>
              {/* Compact pill twin of the bottom .pill-cta, aligned right, and
                  outside the scrolling row so it is never scrolled off. */}
              <NavLink href="/practice" className="nav-pill"><span className="dot" aria-hidden />Play</NavLink>
            </nav>
          </div>
        </header>
        {/* Skip-link target: every page renders its own <main> landmark
            inside this focusable wrapper. */}
        <div id="main" tabIndex={-1} style={{ outline: "none" }}>
          {children}
        </div>
        <footer className="site-footer">
          <div className="container">
            <p>{footerModeCopy()}</p>
            <p>AILX plays like a game and is built like an instrument.</p>
            <p>
              Instrument spec: <span className="mono">AILX-Spec-2026.1</span> · four tracks,
              400 raw points, re-versioned annually · scoring and item banks are public.
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
