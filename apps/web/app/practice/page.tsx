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
import { PracticeDrill } from "../../features/practice/PracticeDrill";
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
  title: "Foray | Image practice",
  description:
    "Photograph or AI-generated image? Get an explanation after each answer. Practice images are separate from the exam. "
    + PRACTICE_EFFICACY_NOTE_SHORT,
};

export default function PracticePage() {
  return (
    <main className="page">
      <div className="container">
        <p className="eyebrow">PRACTICE · UNSCORED · {PRACTICE_DECK_SIZE} CARDS</p>
        <h1 style={{ maxWidth: "20ch" }}>Spot the AI-generated image.</h1>
        {/* One sentence, deliberately. The second half of this lede used to
            live here and pushed the two call buttons below the fold on a
            phone — you had to scroll before you could answer anything. It now
            sits under the drill, where it reads as the reason to play again
            rather than as a wall between you and the first card. */}
        <p className="lede">
          Choose photograph or AI-generated image. Get the answer and an explanation after each choice.
        </p>

        <PracticeDrill />

        <p className="muted" style={{ maxWidth: "58ch" }}>
          Review the clues you noticed and the ones you missed.
        </p>

        <p className="muted">Practice uses separate images and does not change your test result.</p>
        <details><summary>About this practice</summary>
        {/* The efficacy question, answered before anybody asks it, in the one
            wording every surface shares (@ailx/report). It sits directly
            under the drill because that is where a person decides what the
            last five minutes were worth. */}
        <section aria-labelledby="does-it-work">
          <h2 id="does-it-work">What can practice tell you?</h2>
          <p className="muted" style={{ maxWidth: "62ch" }}>
            {PRACTICE_EFFICACY_NOTE}
          </p>
          <details>
            <summary>What the studies found</summary>
            <p className="small faint" style={{ maxWidth: "62ch" }}>
              Gray et al., <em>R. Soc. Open Sci.</em> 12:250921, 2025, found a twenty-point
              accuracy gap between different groups on one type of AI-generated face.
              Trained non-specialists were more willing to call faces fake, but their ability
              to tell real and fake faces apart did not measurably change.
              Geissler, Robertson &amp; Feuerriegel, <em>arXiv</em> 2507.23492, tested five
              teaching methods with 1,200 people. Text and visual instruction helped on the
              day. Games and practice with immediate feedback did not outperform no training.
              After two weeks, none of the methods did. These studies did not test Foray itself.
            </p>
          </details>
        </section>

        <section aria-labelledby="families">
          <h2 id="families">Three types of visual clues</h2>
          <ul className="checklist">
            {ARTEFACT_FAMILIES.map((family) => (
              <li key={family}>
                <strong>{FAMILY_META[family].name}.</strong> {FAMILY_META[family].blurb}
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="honest">
          <h2 id="honest">Separate from the exam</h2>
          <p className="muted" style={{ maxWidth: "62ch" }}>
            Practice is <strong>not the examination</strong>. It uses a separate set of{" "}
            {PRACTICE_BANK.length} images so you do not see exam answers in advance.
            Your practice answers do not change your exam scores or results.
          </p>
          <p className="small faint" style={{ maxWidth: "62ch" }}>
            The images are freely licensed photographs and AI-generated pictures from Wikimedia
            Commons, credited after each answer. This is a <strong>small</strong> set, with fewer
            examples of cultural mistakes than other visual clues. Three generated images look
            like paintings or computer graphics rather than photographs, making them easier to
            identify. Images repeat, so your percentage correct may reflect remembered answers
            rather than better detection skills.{" "}
            {LOCAL_PRACTICE_BASIS}{" "}
            {isServerMode() ? (
              <>
                When you sign in, rounds are saved to your account and count towards your streak.
                {" "}{CLAIM_PROMISE}{" "}
                <Link href="/progress">See your progress →</Link>
              </>
            ) : null}
          </p>
        </section>
        </details>
      </div>
    </main>
  );
}
