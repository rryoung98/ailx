import "./globals.css";
import type { Metadata } from "next";
import { Fraunces, Caveat } from "next/font/google";

/* Self-hosted at build time (static export stays offline). */
const serif = Fraunces({ subsets: ["latin"], axes: ["opsz"], weight: "variable", variable: "--font-serif", display: "swap" });
const script = Caveat({ subsets: ["latin"], weight: "variable", variable: "--font-script", display: "swap" });
import Link from "next/link";
import { FunnelVisit } from "../components/FunnelVisit";
import { Loader } from "../components/Loader";
import { NavLink } from "../components/ui/NavLink";
import { NavStrip } from "../components/ui/NavStrip";
import { assetUrl, isClerkEnabled } from "../lib/mode";
import { AuthShell } from "../lib/auth/AuthShell";
import { QueryProvider } from "../lib/QueryProvider";
import { AuthNav } from "../lib/auth/AuthNav";

export const metadata: Metadata = {
  title: "Foray | Practise using AI on your terms",
  // Meta descriptions are truncated around 155 characters; the old one ran to
  // 172 and lost its last clause in the SERP.
  description:
    "Explore what AI can do and where it goes wrong. Try free practice with instant feedback, or explore the four-part AI literacy exam.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${serif.variable} ${script.variable}`}>
      <body>
        {/* Clerk, or nothing at all — the static export has no auth and must
            keep rendering without one (docs/ARCHITECTURE.md §10.2). */}
        {/* One query cache for the whole app, outside the auth shell so a
            sign-in does not throw away a page's data (lib/QueryProvider.tsx). */}
        <QueryProvider>
        {/* Step one of the funnel, on every route and outside the auth shell:
            a visit is a visit whether or not Clerk is configured. */}
        <FunnelVisit />
        <AuthShell>
          <Loader />
          <a href="#main" className="skip-link">Skip to main content</a>
          <header className="site-header">
            <div className="inner">
              <Link href="/" className="wordmark" aria-label="Foray home">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={assetUrl("/media/logo.svg")} alt="Foray" className="wordmark-img" />
              </Link>
              <nav className="site-nav" aria-label="Primary">
                <NavStrip>
                  <NavLink href="/mission">Mission</NavLink>
                  <NavLink href="/me">My activity</NavLink>
                  {isClerkEnabled() && <AuthNav />}
                </NavStrip>
                <NavLink href="/test" className="nav-pill">Take the test</NavLink>
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
              <p>Practical AI literacy, open to everyone.</p>
            </div>
          </footer>
        </AuthShell>
        </QueryProvider>
      </body>
    </html>
  );
}
