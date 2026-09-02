import type { Metadata } from "next";
import Link from "next/link";
import {
  CLAIM_PROMISE,
  LOCAL_PRACTICE_BASIS,
  PRACTICE_BANK,
  PRACTICE_DECK_SIZE,
  PRACTICE_EFFICACY_NOTE,
  PRACTICE_EFFICACY_NOTE_SHORT,
  ARTEFACT_FAMILIES,
  FAMILY_META,
} from "@ailx/report";
import { PracticeDrill } from "../../lib/PracticeDrill";
import { isServerMode } from "../../lib/mode";

/**
 * /practice — the short, unscored round (spec §13 "Mastery").
 *
 * It claims NOTHING for itself. See PRACTICE_EFFICACY_NOTE in @ailx/report
 * for why, and apps/web/test/efficacyCopy.test.tsx for the gate.
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
    "A short, unscored round on the durable artefact families: real photograph or AI-generated image, with the tell shown on every card. Practice never draws on the scored item bank. "
    + PRACTICE_EFFICACY_NOTE_SHORT,
};

export default function PracticePage() {
  return (
    <main className="page">
      <div className="container">
        <p className="eyebrow">PRACTICE · UNSCORED · {PRACTICE_DECK_SIZE} CARDS</p>
        <h1 style={{ maxWidth: "20ch" }}>Practise the tells.</h1>
        {/* One sentence, deliberately. The second half of this lede used to
            live here and pushed the two call buttons below the fold on a
            phone — you had to scroll before you could answer anything. It now
            sits under the drill, where it reads as the reason to play again
            rather than as a wall between you and the first card. */}
        <p className="lede">
          Real photographs and real AI-generated images, one at a time, with the answer and the
          reason the moment you call it.
        </p>

        <PracticeDrill />

        <p className="muted" style={{ maxWidth: "58ch" }}>
          Being shown the thing you looked straight past is the whole content of the round.
        </p>

        {/* The efficacy question, answered before anybody asks it, in the one
            wording every surface shares (@ailx/report). It sits directly
            under the drill because that is where a person decides what the
            last five minutes were worth. */}
        <section aria-labelledby="does-it-work">
          <h2 id="does-it-work">Does this actually work?</h2>
          <p className="muted" style={{ maxWidth: "62ch" }}>
            {PRACTICE_EFFICACY_NOTE}
          </p>
          <p className="small faint" style={{ maxWidth: "62ch" }}>
            The detail, since we would rather you checked it than trusted us. The five-minute
            training study this round is modelled on (Gray et al., <em>R. Soc. Open Sci.</em>{" "}
            12:250921, 2025) separated <strong>different groups of people</strong> by twenty
            points of accuracy on one family of AI-generated faces — and its trained
            non-specialists showed no measurable change in sensitivity at all, so what moved was
            willingness to call a face fake, not the ability to see that it was. The larger
            trial (Geissler, Robertson &amp; Feuerriegel, <em>arXiv</em> 2507.23492, N = 1,200)
            tested five ways of teaching this. Plain text and plain visual instruction worked on
            the day. <strong>Gamified practice and immediate-feedback practice — this round —
            did not beat doing nothing</strong>, and two weeks later nothing beat doing nothing.
            We are keeping the round because it is a good time and the tells are real; we are
            not going to tell you it made you sharper.
          </p>
        </section>

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
            separate corpus of {PRACTICE_BANK.length} images, kept apart from the scored item bank
            on purpose: a bank item somebody has practised is a dead item, and there is no way to
            un-teach an answer. Nothing you do here is scored, reaches a report figure, or changes
            a result.
          </p>
          <p className="small faint" style={{ maxWidth: "62ch" }}>
            Honest about the corpus. Every picture here is real and freely licensed — genuine
            photographs and genuine model-generated images, all from Wikimedia Commons under CC0,
            CC-BY, CC-BY-SA or public domain, credited under each card. It is a{" "}
            <strong>small</strong> set, and the three families are not equally deep: the
            sociocultural side of the generated half is the thinnest, because a generated picture
            has to be culturally specific before it can be culturally wrong. Three of the
            generated pictures are a painting or a CGI render rather than a photorealistic
            generation, so they can be called from their finish alone — they are marked as such
            in the corpus data. So a round repeats material sooner than the scored deck would —
            which is also why your practice percentage is not a measurement of you: past the
            first few rounds you are partly recognising pictures whose answer you have already
            been given.{" "}
            {LOCAL_PRACTICE_BASIS}{" "}
            {isServerMode() ? (
              <>
                Signed in, the round is recorded on your account instead, and the streak is
                worked out on the server. {CLAIM_PROMISE}{" "}
                <Link href="/progress">See your progress →</Link>
              </>
            ) : null}
          </p>
        </section>
      </div>
    </main>
  );
}
