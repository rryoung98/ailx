import type { Metadata } from "next";
import Link from "next/link";
import { Annotation } from "../../lib/Annotation";
import { assetUrl } from "../../lib/mode";

export const metadata: Metadata = { title: "Methodology — AILX" };

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
            <div className="eyebrow">AILX 2026.1 · Methodology</div>
            <h1>What is measured, how it is scored, and what is <span className="script-accent">honestly</span> not yet known</h1>
            <Annotation>no black boxes</Annotation>
          </div>
        </div>
        <p className="lede">
          The key elements of the instrument specification are the construct, the psychometric approach with a sample size of 45, judge governance, and the modularity rules that ensure scores are reproducible indefinitely.
        </p>

        <section className="reveal">
        <span className="paper-chip" aria-hidden="true"><span className="mono paper-chip-sec">§03</span><span className="paper-chip-note">four tracks</span></span>
        <h2 id="construct">Construct definition (§03)</h2>
        <p>
          AILX defines <strong>applied AI literacy</strong>: a person's ability to achieve positive outcomes in an environment filled with generative systems, defined clearly enough to test. It consists of four measurable skills, each covering a different aspect.
        </p>
        <table>
          <thead><tr><th>Track</th><th>Capability</th><th>Failure it detects</th></tr></thead>
          <tbody>
            <tr><td className="mono">T1</td><td><strong>Create with AI</strong> — direct AI tooling to produce an artifact that meets an external standard of quality</td><td className="muted">Can operate a chatbot; cannot ship anything</td></tr>
            <tr><td className="mono">T2</td><td><strong>Discriminate</strong> — tell authentic media from synthetic and legitimate messages from hostile ones, with calibrated confidence</td><td className="muted">Trusts everything, or trusts nothing</td></tr>
            <tr><td className="mono">T3</td><td><strong>Reason with AI</strong> — use a model on a genuinely difficult problem while keeping and exercising independent judgment</td><td className="muted">Cognitive offloading; accepts wrong output</td></tr>
            <tr><td className="mono">T4</td><td><strong>Direct generation</strong> — take a communicative brief to a finished visual result with proper attribution</td><td className="muted">Generates volume; communicates nothing</td></tr>
          </tbody>
        </table>
        <p>
          Construct-validity levels are <em>declared</em>, per NIST AI 800-2, rather than
          left to be inferred: T2 is a <strong>direct</strong> measurement (discrimination accuracy is the construct); T3 is direct for its planted-error component and a proxy for its rubric component. T1 and T4 are <strong>proxy</strong> measures: artifact quality stands in for creative capability, judged by comparative human judgment rather than a model score. Predictive validity is <strong>unvalidated</strong>: there is no claim yet that any of it predicts real-world outcomes, and establishing that needs the longitudinal follow-up on the 2028 roadmap.
        </p>

        </section>

        <section className="reveal">
        <span className="paper-chip" aria-hidden="true"><span className="mono paper-chip-sec">§09</span><span className="paper-chip-note">n = 45</span></span>
        <h2 id="psychometrics">Psychometric honesty at n = 45 (§09)</h2>
        <blockquote>
          <strong>The Year-1 posture, stated plainly.</strong> The 2026 cohort helps calibrate and develop test items. Rasch analysis ranks item difficulty and removes misfitting items at ±1 logit. This method is based on n = 45 participants. Person abilities are then calculated in logits — <em>not</em> with 2PL or 3PL models, which this sample cannot support: 2PL needed n = 355 for GLAT, and 3PL needed n = 514 for AICOS. Absolute cut scores and certification claims will be postponed until the combined sample size exceeds 250. In Year 1, reports will include percentiles and bands instead of competence certifications.
        </blockquote>
        <ul>
          <li>
            <strong>The anchor-block move.</strong> An embedded block of 18 published items from the AICOS-SV, normed on 514 adults, takes about eight minutes to complete. This allows for a comparison with a real external norm group and establishes the necessary cross-form linkage to ensure Year 2 is comparable to Year 1.
          </li>
          <li>
            <strong>The composite forces a normal distribution</strong> (rank → percentile → inverse-normal → mean 50, SD 15) instead of hoping for one. With n = 45, an empirically normal raw distribution is unlikely. This is clearly stated in every export, and the raw-distribution shape is preserved separately in the data.
          </li>
          <li>
            <strong>Reliability is reported with the right statistics:</strong>{" "}
            Krippendorff’s α (headline, ≥ .80 satisfactory) for rubric-scored tracks;
            ICC(2,k) absolute agreement judged on the 95% CI; split-panel correlation for
            comparative judgement instead of optimistic SSR; QWK for T3 reported against
            the human inter-rater ceiling (~0.72 on comparable essay tasks).
          </li>
          <li>
            <strong>Standard setting is Modified Angoff</strong> — 8–10 subject-matter
            experts, two rounds — the only method defensible <em>without examinee data</em>. The bookmark method is out because it needs IRT parameters that n = 45 cannot supply. Additionally, the contrasting groups method is unreliable at this sample size due to bias toward the smaller group.
          </li>
          <li>
            <strong>Cross-year comparability uses the AP model with ARC-AGI’s calibration discipline.</strong> In Year 1, a quota-based norm reference is used, and a secure anchor block is established from the start. This enables Year 2 and subsequent years to be equated. The standard, set by Angoff, stays fixed, while the raw cut score adjusts annually. The performance gap between public and secure assessments is tracked each year to serve as contamination telemetry.
          </li>
        </ul>

        </section>

        <section className="reveal">
        <span className="paper-chip" aria-hidden="true"><span className="mono paper-chip-sec">§10</span><span className="paper-chip-note">jury rules</span></span>
        <h2 id="judges">Judge governance (§10)</h2>
        <p>
          Where models do score, the protocol is the product. AILX adopts
          <strong> NIST AI 800-2, Practices for Automated Benchmark Evaluations</strong>{" "}
          as its reporting spine: uncertainty quantification with variance decomposed by
          source; documentation down to exact model versions, judge prompts and
          item-level results; qualified claims separating observation from inference; and
          a declared construct-validity level per track.
        </p>
        <p>Known biases are quantified up front, with mitigations:</p>
        <table>
          <thead><tr><th>Bias</th><th>Magnitude</th><th>Mitigation</th></tr></thead>
          <tbody>
            <tr>
              <td><strong>Formatting / style</strong> — the largest single effect</td>
              <td className="muted">GPT-4 win rate for bold text: 89.5%; links 87.3%; lists 75.8%</td>
              <td className="muted">The formatting-invariance ablation was published. T3 was evaluated using both stripped and formatted renderings, with the differences reported.</td>
            </tr>
            <tr>
              <td><strong>Position / order</strong></td>
              <td className="muted">GPT-4 has a consistency rate of 65.0%, while Claude-v1 has a rate of 23.8%. This method performs best when the candidates are similar in quality.</td>
              <td className="muted">Randomised position within every pair; swap used only as part of a combined strategy</td>
            </tr>
            <tr>
              <td><strong>Verbosity</strong></td>
              <td className="muted">Heterogeneous in sign across model families (+0.44 to −0.12)</td>
              <td className="muted">A heterogeneous three-family jury cancels direction; length enters as a covariate in comparative fits.</td>
            </tr>
            <tr>
              <td><strong>Self-enhancement / kinship</strong></td>
              <td className="muted">Preference leakage between judge and candidate tooling</td>
              <td className="muted">No judge should be from a lab that offers its model as a candidate tool. The panel should be published and rotated annually.</td>
            </tr>
          </tbody>
        </table>
        <p>The judging protocol, in order:</p>
        <ol>
          <li><strong>Lock</strong> — frozen rubric bundle; changing a prompt is a version bump, not a config tweak.</li>
          <li><strong>Judge</strong> — a heterogeneous three-family jury with combined mitigations: position swaps, chain-of-thought before scoring, and a detailed rubric.</li>
          <li><strong>Anchor</strong> — every decision must cite verbatim, mechanically verified evidence; unverifiable evidence invalidates the judgment.</li>
          <li><strong>Calibrate</strong> — distribution calibration on ~200 human-labelled examples lifted the published essay-scoring QWK from ~0.5 to 0.71.</li>
          <li><strong>Correct</strong> — report the bias-corrected estimator θ̂ = (p̂ + q₀ − 1)/(q₀ + q₁ − 1), never a raw judge score, with confidence intervals propagated.</li>
          <li><strong>Defer</strong> — route jury disagreements and low-confidence cases to humans on a published trust curve, with known-wrong items planted to keep reviewers engaged.</li>
        </ol>
        <p>
          Two things are published <em>before</em> the first cohort plays: an adversarial red-team assessment of the judges with a measured attack success rate, and a formatting-invariance ablation with the deltas tracked.
        </p>

        </section>

        <section className="reveal">
        <span className="paper-chip" aria-hidden="true"><span className="mono paper-chip-sec">§14</span><span className="paper-chip-note">replayable</span></span>
        <h2 id="modularity">Modularity &amp; reproducibility (§14)</h2>
        <p>
          The failure mode designed against is specific: Year 2 changes a rubric, and Year
          1’s scores silently become irreproducible. Everything serves one property —{" "}
          <strong>any score, ever issued, can be recomputed byte-identically from stored
          inputs.</strong> Four rules make it work:
        </p>
        <ul>
          <li><strong>The package is the unit of release.</strong> Instruments are stored in their own repository as signed, immutable OCI artifacts, which are loaded by digest, not by tag.</li>
          <li><strong>Item banks are content-addressed.</strong> <code>item_id = sha256(canonical_json(item))</code>. An edited item is a <em>new</em> item, never a mutation — cohorts cannot be compared across a silently edited item.</li>
          <li><strong>Prompts are content.</strong> The judge prompt is hashed into <code>rubric_version</code>; changing it is a version bump.</li>
          <li><strong>Locales live beside the item.</strong> Translation provenance is recorded, because the claim that scores compare across languages will be challenged.</li>
        </ul>
        <p>
          <code>score()</code> being <strong>pure</strong> is the load-bearing constraint: no network, no clock, no randomness. Model calls happen in pipeline stages whose outputs are stored as inputs;
          <code> score()</code> then consumes stored judgments and returns a number. CI enforces purity by running <code>score()</code> in a sandbox where{" "}
          <code>fetch</code>, <code>Date.now</code> and <code>Math.random</code> Throw, with golden fixtures per track failing the build on any drift. Re-scores are inserts linked by <code>superseded_by</code>, so no history is lost; the stored model manifest can prove in 2029 which model version produced a 2026 certificate.</p>
        <p className="faint small">
          This showcase build exercises the same contracts client-side: the purity
          harness, content-addressing and golden-fixture checks on the{" "}
          <Link href="/validate">validation page</Link> run the production code paths in your
          browser.
        </p>
        </section>
      </div>
    </main>
  );
}
