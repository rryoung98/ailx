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
  title: "AILX Daily — five calls, one minute",
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
          <h2 id="how-it-works">How the day works</h2>
          <ul className="checklist">
            <li>
              <strong>Everyone gets the same five.</strong> Your browser works the cards out from
              the date itself, so anyone on the same calendar date sees the same set. Nothing is
              asked of a server.
            </li>
            <li>
              <strong>It turns over at your own midnight.</strong> Your device&rsquo;s clock and
              timezone decide the day, so a friend eight hours east already has
              tomorrow&rsquo;s cards.
            </li>
            <li>
              <strong>The grid gives nothing away.</strong> You post which calls you got right,
              in order, never which card was which. It spoils nothing for somebody who has not
              played.
            </li>
            <li>
              <strong>{DAILY_STREAK_MEANING}</strong>
            </li>
          </ul>
        </section>

        <section aria-labelledby="honest">
          <h2 id="honest">What this is, and what it is not</h2>
          <p className="muted" style={{ maxWidth: "62ch" }}>
            The daily is a game on <strong>published</strong> material: the released practice
            tier, whose answer keys are public on purpose, and the practice corpus. It is not the
            examination and issues no result. Nothing here reaches a score, a report or a
            credential. It needs no account, and your streak stays on this device, not with us.
          </p>
          <p className="small faint" style={{ maxWidth: "62ch" }}>
            Honest about the pool. There are {DAILY_POOL.length} cards in total, so a card comes
            back every couple of weeks. That is sooner than a real deck, and you may recognise one
            whose answer you have seen. That is the size of the public material, not a design
            goal, and another reason the daily is a game, not a measurement. The{" "}
            <Link href="/practice">practice drill</Link> shows the tell on every card; the{" "}
            <Link href="/exam">full run</Link> is the instrument.
          </p>
        </section>
      </div>
    </main>
  );
}
