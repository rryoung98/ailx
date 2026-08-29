import "./globals.css";
import type { Metadata } from "next";
import { Fraunces, Caveat } from "next/font/google";

/* Self-hosted at build time (static export stays offline). */
const serif = Fraunces({ subsets: ["latin"], axes: ["opsz"], weight: "variable", variable: "--font-serif", display: "swap" });
const script = Caveat({ subsets: ["latin"], weight: "variable", variable: "--font-script", display: "swap" });
import Link from "next/link";
import { Loader } from "../lib/Loader";
import { NavLink } from "../lib/NavLink";
import { footerModeCopy } from "../lib/mode";

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
              <img src={`${process.env.NEXT_PUBLIC_BASE_PATH ?? "/ailx"}/media/logo.svg`} alt="AILX" className="wordmark-img" />
            </Link>
            <nav className="site-nav" aria-label="Primary">
              <NavLink href="/methodology">Methodology</NavLink>
              <NavLink href="/report">Report</NavLink>
              <NavLink href="/gallery">Gallery</NavLink>
              <NavLink href="/validate">Validate</NavLink>
              {/* Compact pill twin of the bottom .pill-cta, aligned right. */}
              <NavLink href="/exam" className="nav-pill"><span className="dot" aria-hidden />Play</NavLink>
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
              Instrument spec: <span className="mono">AILX-Spec-2026.1</span> · pilot cohort
              n = 45 · US / Japan / Korea · YTL Summit 2026.
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
