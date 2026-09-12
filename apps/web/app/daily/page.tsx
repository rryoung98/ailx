import type { Metadata } from "next";
import Link from "next/link";
import {
  DAILY_DECK_SIZE,
  DAILY_PITCH,
  DAILY_STREAK_MEANING,
  PRACTICE_EFFICACY_NOTE_SHORT,
} from "@ailx/report";
import { DailyChallenge } from "../../features/daily/DailyChallenge";
import { DAILY_POOL } from "../../lib/instrument/demoItems";

/**
 * /daily — the daily challenge.
 *
 * It exists in BOTH builds and needs neither an account nor a network: the
 * cards are bundled public content, the day comes from the device clock, and
 * the streak lives in this browser. That is the whole design — the loop has
 * to work for somebody who arrived from a pasted grid thirty seconds ago.
 *
 * A plain `page.tsx`, not a `page.api.tsx`: it reads no store, so it is in
 * the static export too.
 */

export const metadata: Metadata = {
  title: "Foray Daily | Five questions a day",
  description:
    "One set of cards a day, the same for everyone: photograph or AI-generated, person or model, "
    + "genuine message or not. Published practice material. No score, no account. "
    + PRACTICE_EFFICACY_NOTE_SHORT,
};

export default function DailyPage() {
  return (
    <main className="page">
      <div className="container">
        <p className="eyebrow">DAILY · UNSCORED · {DAILY_DECK_SIZE} CARDS</p>
        <h1 style={{ maxWidth: "18ch" }}>Today&rsquo;s five.</h1>
        <p className="lede">{DAILY_PITCH}</p>

        <DailyChallenge />

        <section aria-labelledby="how-it-works">
          <h2 id="how-it-works">How it works</h2>
          <ul className="checklist">
            <li>
              <strong>Everyone gets the same five.</strong> Anyone on the same calendar date sees the same set. You do not need an account.
            </li>
            <li>
              <strong>New cards arrive at your local midnight.</strong> Your device clock and timezone set the date. Friends in other timezones may see a different set.
            </li>
            <li>
              <strong>Share your result without the answers.</strong> The grid shows right and wrong answers in order. It does not reveal the cards or their answers.
            </li>
            <li>
              <strong>{DAILY_STREAK_MEANING}</strong>
            </li>
          </ul>
        </section>

        <section aria-labelledby="honest">
          <h2 id="honest">Separate from the exam</h2>
          <p className="muted" style={{ maxWidth: "62ch" }}>
            The daily uses public practice questions. It does not affect exam scores, reports or credentials. You do not need an account. Your daily streak stays in this browser.
          </p>
          <p className="small faint" style={{ maxWidth: "62ch" }}>
            There are {DAILY_POOL.length} cards, so you will see repeats. Try the <Link href="/practice">image practice</Link> for more examples with explanations, or take the <Link href="/exam">full exam</Link>.
          </p>
        </section>

      </div>
    </main>
  );
}
