import type { Metadata } from "next";
import Link from "next/link";
import { PRACTICE_BANK, PRACTICE_DECK_SIZE, ARTEFACT_FAMILIES, FAMILY_META } from "@ailx/report";
import { PracticeDrill } from "../../lib/PracticeDrill";
import { isServerMode } from "../../lib/mode";

/**
 * /practice — the short, unscored training round (spec §13 "Mastery").
 *
 * This page exists in BOTH builds: the corpus is bundled, so the drill plays
 * offline in the static demo, and the hosted build additionally records the
 * round and works the streak out on the server. It is a plain `page.tsx`
 * because it reads nothing from the store — the drill's own client component
 * calls the API, and there is no API in the export.
 */

export const metadata: Metadata = {
  title: "AILX — practice the tells",
  description:
    "A short, unscored training round on the durable artefact families, with immediate feedback on every card. Practice never draws on the scored item bank.",
};

export default function PracticePage() {
  return (
    <main className="page">
      <div className="container">
        <p className="eyebrow">PRACTICE · UNSCORED · {PRACTICE_DECK_SIZE} CARDS</p>
        <h1 style={{ maxWidth: "20ch" }}>Practise the tells.</h1>
        <p className="lede">
          A short round on the three artefact families that survive model generations, with the
          answer and the reason shown the moment you call it. Published work moved typical
          participants from 31% to 51% detection in about five minutes of exactly this — being
          shown the thing you looked straight past is the teaching.
        </p>

        <PracticeDrill />

        <section aria-labelledby="families">
          <h2 id="families">The three families</h2>
          <ul className="checklist">
            {ARTEFACT_FAMILIES.map((family) => (
              <li key={family}>
                <strong>{FAMILY_META[family].name}.</strong> {FAMILY_META[family].blurb}
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="honest">
          <h2 id="honest">What this is, and what it is not</h2>
          <p className="muted" style={{ maxWidth: "62ch" }}>
            Practice is <strong>not the examination</strong> and never touches it. It draws on a
            separate corpus of {PRACTICE_BANK.length} written passages, kept apart from the scored
            item bank on purpose: a bank item somebody has practised is a dead item, and there is
            no way to un-teach an answer. Nothing you do here is scored, reaches a report figure,
            or changes a result.
          </p>
          <p className="small faint" style={{ maxWidth: "62ch" }}>
            Honest about the corpus: these {PRACTICE_BANK.length} passages are a hand-written
            placeholder set. They drill the artefact families in text and they train real
            attention, but they are not the examination&rsquo;s authentic-versus-synthetic media
            call — that drill needs a licensed human-written and model-generated media corpus,
            which is content work, not code.{" "}
            {isServerMode() ? (
              <>
                Your rounds are recorded and your streak is worked out on the server.{" "}
                <Link href="/progress">See your progress →</Link>
              </>
            ) : (
              <>This is the static demo build: rounds play, and nothing is recorded.</>
            )}
          </p>
        </section>
      </div>
    </main>
  );
}
