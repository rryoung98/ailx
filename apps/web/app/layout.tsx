import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "AILX — The AI Literacy Examination",
  description:
    "A performance-based benchmark that measures what a person can actually do with, against, and about artificial intelligence.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
