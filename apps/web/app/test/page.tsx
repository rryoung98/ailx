import { Suspense } from "react";
import { ConsumerTest } from "../../features/consumer/ConsumerTest";
export const metadata = { title: "Foray | Your AI working style", description: "Try eight decisions about working with AI and explore your skills snapshot. A public demo designed for 4–5 minutes." };
export default function TestPage() {
  return <Suspense fallback={<main className="container"><p>Opening your test…</p></main>}><ConsumerTest /></Suspense>;
}
