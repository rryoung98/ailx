import "./globals.css";
import type { Metadata } from "next";
import Link from "next/link";
import { LocaleSwitcher } from "../lib/LocaleSwitcher";

export const metadata: Metadata = {
  title: "AILX — The AI Literacy Examination",
  description:
    "A task-performance-based AI-literacy examination for adults, built to the AILX 2026.1 specification: four authentic tracks, 400 raw points, audit-grade scoring. Live demo build.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <a href="#main" className="skip-link">Skip to main content</a>
        <header className="site-header">
          <div className="inner">
            <Link href="/" className="wordmark">AIL<span>X</span></Link>
            <nav className="site-nav" aria-label="Primary">
              <Link href="/methodology">Methodology</Link>
              <Link href="/exam">Sit the exam</Link>
              <Link href="/report">Report</Link>
              <Link href="/validate">Validate</Link>
              <LocaleSwitcher />
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
            <p>
              AILX 2026.1 · static showcase build. All model calls in this build are
              deterministic demo simulators (seeded by SHA-256 of their inputs) behind the
              production interfaces — no network calls, everything runs in your browser.
            </p>
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
