import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Methodology — AILX" };

export default function Methodology() {
  return (
    <main className="page">
      <div className="container" style={{ maxWidth: 820 }}>
        <div className="eyebrow">AILX 2026.1 · Methodology</div>
        <h1>What is measured, how it is scored, and what is honestly not yet known</h1>
        <p className="lede">
          The key elements of the instrument specification include the construct, the psychometric approach with a sample size of 45, judge governance, and the modularity rules that ensure every score remains reproducible indefinitely.
        </p>

        <h2 id="construct">Construct definition (§03)</h2>
        <p>
          AILX defines <strong>applied AI literacy</strong> A person's ability to produce positive outcomes in an information environment saturated with generative systems can be defined precisely enough to be tested. This ability breaks down into four measurable capabilities, each representing a different track.
        </p>
        <table>
          <thead><tr><th>Track</th><th>Capability</th><th>Failure it detects</th></tr></thead>
          <tbody>
            <tr><td className="mono">T1</td><td><strong>Create with AI</strong> — direct AI tooling to produce an artefact that meets an external standard of quality</td><td className="muted">Can operate a chatbot; cannot ship anything</td></tr>
            <tr><td className="mono">T2</td><td><strong>Discriminate</strong> Distinguish authentic media from synthetic content and identify legitimate messages from hostile ones, with calibrated confidence.</td><td className="muted">Trusts everything, or trusts nothing</td></tr>
            <tr><td className="mono">T3</td><td><strong>Reason with AI</strong> Use a model on a genuinely difficult problem while maintaining and exercising independent judgment.</td><td className="muted">Cognitive offloading; accepts wrong output</td></tr>
            <tr><td className="mono">T4</td><td><strong>Direct generation</strong> Take a communicative brief to a finished visual result and ensure proper attribution.</td><td className="muted">Generates volume; communicates nothing</td></tr>
          </tbody>
        </table>
        <p>
          Construct-validity levels are <em>declared</em>, per NIST AI 800-2, rather than
          left to be inferred: T2 is a <strong>direct</strong> Measurement (where discrimination accuracy is the construct): T3 directly measures its planted error component and serves as a proxy for its rubric component. T1 and T4 are... <strong>proxy</strong> Claims that the quality of an artifact serves as a proxy for creative capability, using comparative human judgment as the criterion, not a model score. The composite measure includes this factor.
          <strong> predictive — unvalidated</strong> There is no claim yet that it predicts real-world outcomes. Establishing this will require longitudinal follow-up as outlined in the roadmap for 2028.
        </p>

        <h2 id="psychometrics">Psychometric honesty at n = 45 (§09)</h2>
        <blockquote>
          <strong>The Year-1 posture, stated plainly.</strong> The 2026 cohort serves as a calibration and item-development group. Rasch analysis is used to rank item difficulty and eliminate misfitting items at ±1 logit. This approach is supported by n = 45. Person-ability logits are then determined. <em>not</em> 2PL and 3PL models are not being used. For the 2PL model, GLAT required a sample size of 355, while AICOS needed 514 for the 3PL model. Absolute cut scores and certification claims will be deferred until the combined sample size exceeds 250. In Year 1, reports include percentiles and bands instead of competence certifications.
        </blockquote>
        <ul>
          <li>
            <strong>The anchor-block move.</strong> An embedded block of published, externally normed items (AICOS-SV, 18 items, normed on n = 514 adults) takes about eight minutes of testing time. This provides a comparison against a real external norm group and creates the cross-form linkage needed to make Year 2 comparable to Year 1.
          </li>
          <li>
            <strong>The composite forces a normal distribution</strong> Instead of relying on hope, use (rank → percentile → inverse-normal → mean 50, SD 15). At n = 45, an empirically normal raw distribution is unlikely. This is clearly stated in every export, and the raw-distribution shape is preserved separately in the data.
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
            experts, two rounds — the only method defensible <em>without examinee data</em>The bookmark method is ruled out because it requires IRT parameters with n = 45, which cannot be produced. The contrasting groups method is also not viable due to bias towards the smaller group at this sample size.
          </li>
          <li>
            <strong>Cross-year comparability uses the AP model with ARC-AGI’s calibration discipline.</strong> Year 1 uses a quota-based norm reference, while a secure anchor block is established from the start. This allows Year 2 and beyond to be equated. The standard, set by Angoff, remains fixed, while the raw cut score adjusts. The annual tracking of the performance gap between public and secure assessments serves as contamination telemetry.
          </li>
        </ul>

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
              <td className="muted">The formatting-invariance ablation was published. T3 was judged based on both stripped and formatted renderings, with the differences reported.</td>
            </tr>
            <tr>
              <td><strong>Position / order</strong></td>
              <td className="muted">GPT-4 has a consistency rate of 65.0%, while Claude-v1 has a rate of 23.8%. This method works best when the candidates are similar in quality.</td>
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
          <li><strong>Judge</strong> Combined mitigation for a heterogeneous three-family jury involves position swaps, chain-of-thought explanations before scoring, and a detailed rubric.</li>
          <li><strong>Anchor</strong> Every decision must cite verbatim, mechanically verified evidence. Unverifiable evidence invalidates the judgment.</li>
          <li><strong>Calibrate</strong> Distribution calibration on about 200 human-labelled examples improved the published essay-scoring QWK from around 0.5 to 0.71.</li>
          <li><strong>Correct</strong> The bias-corrected estimator θ̂ = (p̂ + q₀ − 1)/(q₀ + q₁ − 1) is never a raw judge score, and confidence intervals are propagated.</li>
          <li><strong>Defer</strong> Route jury disagreements and low-confidence cases to humans based on a published trust curve. Include known-wrong items to verify reviewer engagement.</li>
        </ol>
        <p>
          Two things are published <em>before</em> The exam includes an adversarial red-team assessment by our own judges, using a measured attack success rate. We also conduct a formatting-invariance ablation test, tracking the delta.
        </p>

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
          <li><strong>Locales live beside the item</strong>Translation provenance is recorded because the claim that scores can be compared across languages will be challenged.</li>
        </ul>
        <p>
          <code>score()</code> being <strong>pure</strong> The lack of a network, clock, and randomness is the key constraint of the entire architecture. Model calls occur within pipeline stages, and their outputs are stored as inputs.
          <code> score()</code> The system consumes stored judgments and returns a number. Purity is enforced in continuous integration by running tests. <code>score()</code> in a sandbox where{" "}
          <code>fetch</code>, <code>Date.now</code> and <code>Math.random</code> Throw, with golden fixtures per track failing the build on any drift. Re-scores are inserts linked by <code>superseded_by</code>To ensure no history is lost, the stored model manifest allows us to prove which model version produced a 2026 certificate in 2029.
        </p>
        <p className="faint small">
          This showcase build exercises the same contracts client-side: the purity
          harness, content-addressing and golden-fixture checks on the{" "}
          <Link href="/validate">validation page</Link> run the production code paths in your
          browser.
        </p>
      </div>
    </main>
  );
}
