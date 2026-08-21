import "./globals.css";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "AILX — The AI Literacy Examination",
  description:
    "The first cross-nationally normed, annually re-versioned, task-performance-based AI-literacy examination for adults. Four authentic tracks, 400 raw points, audit-grade scoring.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="site-header">
          <div className="inner">
            <Link href="/" className="wordmark">AIL<span>X</span></Link>
            <nav className="site-nav">
              <Link href="/methodology">Methodology</Link>
              <Link href="/exam">Sit the exam</Link>
              <Link href="/report">Report</Link>
              <Link href="/validate">Validate</Link>
            </nav>
          </div>
        </header>
        {children}
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
