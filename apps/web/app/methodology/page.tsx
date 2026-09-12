import type { Metadata } from "next";
import Link from "next/link";
import { Annotation } from "../../components/ui/Annotation";
import { assetUrl } from "../../lib/mode";

export const metadata: Metadata = { title: "Methodology — Foray" };

export default function Methodology() {
  return (
    <main className="page">
      <div className="container" style={{ maxWidth: 820 }}>
        {/* Zero-style hero band: pastoral panel + cream scrim under the
            serif headline. Decorative (aria-hidden), same disclosure as the
            other AI-generated backdrops (docs/CREDITS.md). */}
        <div className="page-hero">
          <div className="page-hero-media" aria-hidden="true">
            <img
              src={assetUrl("/media/pastoral.jpg")}
              alt="" width={2000} height={1200} decoding="async"
            />
            <div className="page-hero-scrim" />
          </div>
          <div className="page-hero-copy">
            <div className="eyebrow">Foray 2026.1 · Methodology</div>
            <h1>What we measure, and what we <span className="script-accent">still</span> need to learn</h1>
            <Annotation>no black boxes</Annotation>
          </div>
        </div>
        <p className="lede">
          Foray tests how you use AI and make your own decisions. Here are the scoring
          rules, the evidence behind them, and the limits of what a score can tell you.
        </p>

        <section className="reveal">
        <span className="paper-chip" aria-hidden="true"><span className="mono paper-chip-sec">§03</span><span className="paper-chip-note">four tracks</span></span>
        <h2 id="construct">What the tasks measure (§03)</h2>
        <p>
          <strong>Applied AI literacy</strong> means using AI to do useful work while keeping
          your own judgment. Foray tests four skills:
        </p>
        <table>
          <thead><tr><th>Track</th><th>Capability</th><th>What can go wrong</th></tr></thead>
          <tbody>
            <tr><td className="mono">T1</td><td><strong>Create with AI</strong>. Use AI to make something that meets a clear quality standard</td><td className="muted">Can use a chatbot but cannot finish useful work</td></tr>
            <tr><td className="mono">T2</td><td><strong>Spot what to trust</strong>. Tell real media from generated media and safe messages from scams. Judge how sure you are</td><td className="muted">Trusts everything, or trusts nothing</td></tr>
            <tr><td className="mono">T3</td><td><strong>Reason with AI</strong>. Use a model on a difficult problem and check its answers</td><td className="muted">Accepts wrong answers without checking</td></tr>
            <tr><td className="mono">T4</td><td><strong>Direct generation</strong>. Turn a brief into a finished image and credit the sources</td><td className="muted">Makes many images but misses the brief</td></tr>
          </tbody>
        </table>
        <p>
          Each track has limits. Following NIST AI 800-2, we state what each score measures.
          T2 <strong>directly</strong> measures accuracy at spotting differences. T3 directly
          tests whether you catch planted errors, but its rubric score is an indirect measure
          of reasoning. T1 and T4 use work quality as a <strong>proxy</strong>, or indirect
          measure, of creative skill. Human comparisons are the reference for those tracks,
          not model scores. The combined score is <strong>not yet validated as a predictor</strong>
          {" "}of real-world outcomes. Testing that needs long-term follow-up, planned for 2028.
        </p>

        </section>

        <section className="reveal">
        <span className="paper-chip" aria-hidden="true"><span className="mono paper-chip-sec">§09</span><span className="paper-chip-note">what the sample allows</span></span>
        <h2 id="psychometrics">What the early results can tell us (§09)</h2>
        <blockquote>
          The 2026 calibration group had just <strong>45 people</strong>. It helped develop
          questions, not certify anyone. We use the Rasch model to estimate question difficulty
          and flag questions that fit poorly. Person-ability logits are <em>not</em> reported as scores.
          More complex models, called 2PL and 3PL, need larger samples. We defer pass thresholds
          and competence certification until the pooled sample exceeds <strong>250</strong>.
          Until then, percentiles and bands describe relative performance, not certified competence.
        </blockquote>
        <ul>
          <li>
            <strong>Shared questions link results.</strong> The design includes 18 published
            AICOS-SV questions, tested on 514 adults. They take about eight minutes and provide
            an outside comparison group.
          </li>
          <li>
            <strong>The combined score uses a bell-shaped scale.</strong> Ranks become percentiles,
            then scores with a mean of 50 and a standard deviation of 15. This does not mean raw
            performance follows a bell curve. Exports keep the raw distribution separately.
          </li>
          <li>
            <strong>Agreement between judges needs checking.</strong> The plan uses Krippendorff's
            alpha for rubric scores, with .80 as the target, and ICC with 95% confidence intervals
            to measure agreement. Separate judging panels are compared for paired work. T3 also
            uses weighted kappa, a measure of rating agreement, against human judges' agreement.
          </li>
          <li>
            <strong>Experts set the planned pass standard.</strong> Modified Angoff asks 8 to 10
            experts, over two rounds, what a minimally competent person should achieve. The early
            sample is too small for methods that need stable estimates of each question's difficulty
            or comparisons between groups of test takers.
          </li>
          <li>
            <strong>Comparisons across years need stable questions.</strong> The design keeps a
            secure set of questions to link annual versions. Once set, the competence standard stays
            fixed, though the raw score needed may change. Comparing results on public and secure
            questions helps check whether prior exposure is affecting scores.
          </li>
        </ul>

        </section>

        <section className="reveal">
        <span className="paper-chip" aria-hidden="true"><span className="mono paper-chip-sec">§10</span><span className="paper-chip-note">jury rules</span></span>
        <h2 id="judges">How judging is checked (§10)</h2>
        <p>
          Model judges can make mistakes. The judging plan follows
          <strong> NIST AI 800-2, Practices for Automated Benchmark Evaluations</strong>.
          It calls for exact model and prompt versions, results for each question, and uncertainty
          estimates. Reports must separate what the evidence shows from what we infer.
        </p>
        <p>Published studies show these risks. The figures below are not measurements of Foray judges:</p>
        <table>
          <thead><tr><th>Bias</th><th>Reported finding</th><th>Planned check</th></tr></thead>
          <tbody>
            <tr>
              <td><strong>Formatting and style</strong></td>
              <td className="muted">GPT-4 win rate for bold text: 89.5%; links 87.3%; lists 75.8%</td>
              <td className="muted">Compare T3 judgments with and without formatting and report the difference</td>
            </tr>
            <tr>
              <td><strong>Position / order</strong></td>
              <td className="muted">Swap consistency: GPT-4 65.0%, Claude-v1 23.8%. Order matters most when work is close in quality</td>
              <td className="muted">Randomize order and swap pairs, alongside other checks</td>
            </tr>
            <tr>
              <td><strong>Verbosity</strong></td>
              <td className="muted">Some model families favor longer answers; others favor shorter ones, with reported effects from +0.44 to −0.12</td>
              <td className="muted">Use judges from three model families and account for answer length in comparisons</td>
            </tr>
            <tr>
              <td><strong>Favoring related models</strong></td>
              <td className="muted">Judges may favor output from their own model family</td>
              <td className="muted">Exclude judges from labs that supply the tools used in tasks; publish and rotate the panel each year</td>
            </tr>
          </tbody>
        </table>
        <p>The planned judging process:</p>
        <ol>
          <li><strong>Fix the rules.</strong> Save the rubric and prompts as a version. Any change creates a new version.</li>
          <li><strong>Use several judges.</strong> Three model families follow a detailed rubric, explain ratings, and compare work in both orders.</li>
          <li><strong>Check the evidence.</strong> Judges must quote the work. A quote that cannot be verified invalidates the judgment.</li>
          <li><strong>Compare with humans.</strong> Use human-rated examples to adjust model ratings. A published essay study improved rating agreement from about 0.5 to 0.71 using roughly 200 examples; this is not a Foray result.</li>
          <li><strong>Account for errors.</strong> Adjust estimates for measured judge errors and report confidence intervals, rather than treating raw model ratings as truth.</li>
          <li><strong>Ask humans when needed.</strong> Send disagreements and uncertain cases to reviewers. Publish the referral rules and use known-error examples to check reviewer attention.</li>
        </ol>
        <p>
          Before the first scored cohort, the plan requires published tests of attempts to
          manipulate the judges, including attack success rates, and tests of how formatting
          changes ratings. These requirements are not evidence that the checks have already passed.
        </p>

        </section>

        <section className="reveal">
        {/* No paper chip: those are numbered spec sections, and this one is
            about the app, not the instrument. siteShowcase.test.tsx counts
            them. */}
        <h2 id="storage">What is stored, and who calls the model</h2>
        <p>
          On the hosted site, the Foray service stores your activity during a run, your answers,
          and any site you publish. If you connect a model, the service holds its key against
          your account. Your browser receives only a 12-character fingerprint to identify the
          connection, never the key.
        </p>
        <p>
          Tasks that support offline practice can use a simulator and label it on screen.
          A simulator is not a live model, and its results are not an official score.
        </p>
        <p>
          The GitHub Pages demo has no Foray exam service or account sign-in. You can use
          the capped shared model or connect a model running on your own machine. Inputs sent
          to a connected model leave this page, so do not include private information.
        </p>
        </section>

        <section className="reveal">
        <span className="paper-chip" aria-hidden="true"><span className="mono paper-chip-sec">§14</span><span className="paper-chip-note">replayable</span></span>
        <h2 id="modularity">How scores can be checked later (§14)</h2>
        <p>
          Changing next year's rules must not erase this year's results. The goal is simple:
          <strong> recompute the same score from the same stored inputs.</strong> The release
          design has four rules:
        </p>
        <ul>
          <li><strong>Release fixed versions.</strong> The design calls for signed instrument packages loaded by a hash of their contents, not a changeable name.</li>
          <li><strong>Changed questions get new IDs.</strong> Each ID is a hash of the question content. Editing a question creates a new item, so changes cannot silently affect comparisons.</li>
          <li><strong>Save the judging instructions.</strong> The prompt is part of <code>rubric_version</code>. Changing it creates a new version.</li>
          <li><strong>Keep translations with each question.</strong> Record how they were translated. Comparable scores across languages need evidence.</li>
        </ul>
        <p>
          <code>score()</code> uses no network, clock, or randomness. It calculates a score from
          stored answers and judgments. <strong>Re-scoring is reproducible; re-judging is not.</strong>
          {" "}A model may give a different judgment when asked again, even at temperature 0.
          We save its original judgment as an input rather than call it again to check a score.
          Automated tests block common sources of changing results and compare scores with fixed
          examples. These tests are not a sandbox or a proof of purity. They can miss references
          captured earlier, file imports, or environment reads. New scores link to the old records
          through <code>superseded_by</code>, without overwriting the history.
        </p>
        <p>
          There is also a runtime limit. Tests verify byte-identical results on the same
          JavaScript runtime, not across engine versions. Score records do not yet store that
          version. Some text-processing rules can change with the engine. Recording the runtime
          and replaying old scores on it is still needed for a stronger long-term guarantee.
        </p>
        <p className="faint small">
          You can run checks of the scoring code and content IDs in your browser on the{" "}
          <Link href="/validate">validation page</Link>. They check code consistency, not whether
          a score predicts real-world skill.
        </p>
        </section>
      </div>
    </main>
  );
}
