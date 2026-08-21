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
          Key content from the instrument specification: the construct, the
          psychometric posture at n = 45, judge governance, and the modularity rules
          that keep every score reproducible forever.
        </p>

        <h2 id="construct">Construct definition (§03)</h2>
        <p>
          AILX defines <strong>applied AI literacy</strong> as a person’s capacity to
          produce good outcomes in an information environment saturated with generative
          systems — stated tightly enough to be falsifiable. It resolves into four
          measurable capabilities, each of which is a track:
        </p>
        <table>
          <thead><tr><th>Track</th><th>Capability</th><th>Failure it detects</th></tr></thead>
          <tbody>
            <tr><td className="mono">T1</td><td><strong>Create with AI</strong> — direct AI tooling to produce an artefact that meets an external standard of quality</td><td className="muted">Can operate a chatbot; cannot ship anything</td></tr>
            <tr><td className="mono">T2</td><td><strong>Discriminate</strong> — distinguish authentic from synthetic media and legitimate from hostile messages, with calibrated confidence</td><td className="muted">Trusts everything, or trusts nothing</td></tr>
            <tr><td className="mono">T3</td><td><strong>Reason with AI</strong> — use a model on a genuinely hard problem while retaining and exercising independent judgement</td><td className="muted">Cognitive offloading; accepts wrong output</td></tr>
            <tr><td className="mono">T4</td><td><strong>Direct generation</strong> — take a communicative brief to a finished visual result and disclose provenance correctly</td><td className="muted">Generates volume; communicates nothing</td></tr>
          </tbody>
        </table>
        <p>
          Construct-validity levels are <em>declared</em>, per NIST AI 800-2, rather than
          left to be inferred: T2 is a <strong>direct</strong> measurement (discrimination
          accuracy is the construct); T3 is direct on its planted-error component and a
          proxy on its rubric component; T1 and T4 are <strong>proxy</strong> claims
          (artefact quality proxies creative capability, with comparative human judgement
          as the criterion, not a model score). The composite carries a
          <strong> predictive — unvalidated</strong> label: no claim yet that it predicts
          real-world outcomes; establishing that requires the longitudinal follow-up on
          the roadmap for 2028.
        </p>

        <h2 id="psychometrics">Psychometric honesty at n = 45 (§09)</h2>
        <blockquote>
          <strong>The Year-1 posture, stated plainly.</strong> The 2026 cohort is a
          calibration and item-development cohort. Rasch is used diagnostically to rank
          item difficulty and cull misfitting items at ±1 logit — which n = 45 supports.
          Person-ability logits are <em>not</em> reported as scores. 2PL and 3PL are off
          the table entirely: GLAT needed n = 355 for 2PL, AICOS needed 514 for 3PL.
          Absolute cut scores and certification claims are deferred until pooled n
          crosses 250. Year 1 reports percentiles and bands, not competence
          certifications.
        </blockquote>
        <ul>
          <li>
            <strong>The anchor-block move.</strong> An embedded block of published,
            externally normed items (AICOS-SV, 18 items, normed on n = 514 adults) costs
            about eight minutes of testing time and buys standing against a real external
            norm group — and creates the cross-form linkage that makes Year 2 comparable
            to Year 1.
          </li>
          <li>
            <strong>The composite forces a normal distribution</strong> (rank →
            percentile → inverse-normal → mean 50, SD 15) rather than hoping for one. At
            n = 45 an empirically normal raw distribution is unlikely. This is disclosed
            openly in every export, and raw-distribution shape is preserved separately in
            the data.
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
            experts, two rounds — the only method defensible <em>without examinee data</em>.
            Bookmark is ruled out (needs IRT parameters n = 45 cannot produce); so is
            Contrasting Groups (biased toward the smaller group at this n).
          </li>
          <li>
            <strong>Cross-year comparability takes the AP model with ARC-AGI’s calibration
            discipline:</strong> Year 1 is norm-referenced by quota, while a secure anchor
            block is built from day one so Year 2 onward can be equated; the standard,
            once set by Angoff, is held fixed and the raw cut floats. The
            public-vs-secure performance gap is tracked annually as contamination
            telemetry.
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
              <td className="muted">Formatting-invariance ablation published; T3 judged on stripped and formatted renderings with the delta reported</td>
            </tr>
            <tr>
              <td><strong>Position / order</strong></td>
              <td className="muted">Swap consistency: GPT-4 65.0%, Claude-v1 23.8% — strongest when candidates are close in quality</td>
              <td className="muted">Randomised position within every pair; swap used only as part of a combined strategy</td>
            </tr>
            <tr>
              <td><strong>Verbosity</strong></td>
              <td className="muted">Heterogeneous in sign across model families (+0.44 to −0.12)</td>
              <td className="muted">Heterogeneous three-family jury cancels direction; length enters comparative fits as a covariate</td>
            </tr>
            <tr>
              <td><strong>Self-enhancement / kinship</strong></td>
              <td className="muted">Preference leakage between judge and candidate tooling</td>
              <td className="muted">No judge from a lab whose model is offered as candidate tooling; panel published and rotated annually</td>
            </tr>
          </tbody>
        </table>
        <p>The judging protocol, in order:</p>
        <ol>
          <li><strong>Lock</strong> — frozen rubric bundle; changing a prompt is a version bump, not a config tweak.</li>
          <li><strong>Judge</strong> — combined mitigation on a heterogeneous three-family jury (position swap + chain-of-thought before score + rubric).</li>
          <li><strong>Anchor</strong> — every decision must cite verbatim, mechanically verified evidence; unverifiable evidence discards the judgement.</li>
          <li><strong>Calibrate</strong> — distribution calibration on ~200 human-labelled examples (the step that moved published essay-scoring QWK from ~0.5 to 0.71).</li>
          <li><strong>Correct</strong> — bias-corrected estimator θ̂ = (p̂ + q₀ − 1)/(q₀ + q₁ − 1), never a raw judge score, with propagated confidence intervals.</li>
          <li><strong>Defer</strong> — route jury disagreement and low-confidence cases to humans on a published trust curve, with planted known-wrong items verifying reviewer engagement.</li>
        </ol>
        <p>
          Two things are published <em>before</em> the exam, not after: an adversarial
          red-team of our own judge with the measured attack success rate, and a
          formatting-invariance ablation with the delta.
        </p>

        <h2 id="modularity">Modularity &amp; reproducibility (§14)</h2>
        <p>
          The failure mode designed against is specific: Year 2 changes a rubric, and Year
          1’s scores silently become irreproducible. Everything serves one property —{" "}
          <strong>any score, ever issued, can be recomputed byte-identically from stored
          inputs.</strong> Four rules make it work:
        </p>
        <ul>
          <li><strong>The package is the unit of release.</strong> Instruments live in their own repository as signed, immutable OCI artefacts, loaded by digest, never by tag.</li>
          <li><strong>Item banks are content-addressed.</strong> <code>item_id = sha256(canonical_json(item))</code>. An edited item is a <em>new</em> item, never a mutation — cohorts cannot be compared across a silently edited item.</li>
          <li><strong>Prompts are content.</strong> The judge prompt is hashed into <code>rubric_version</code>; changing it is a version bump.</li>
          <li><strong>Locales live beside the item</strong>, with translation provenance recorded, because score comparability across languages is a validity claim that will be challenged.</li>
        </ul>
        <p>
          <code>score()</code> being <strong>pure</strong> — no network, no clock, no
          randomness — is the load-bearing constraint of the whole architecture. Model
          calls happen inside pipeline stages and their outputs are stored as inputs;
          <code> score()</code> consumes stored judgments and returns a number. Purity is
          enforced in CI by running <code>score()</code> in a sandbox where{" "}
          <code>fetch</code>, <code>Date.now</code> and <code>Math.random</code> throw,
          with golden fixtures per track failing the build on any drift. Re-scores are
          inserts linked by <code>superseded_by</code>, so no history is destroyed, and
          the stored model manifest makes it possible in 2029 to prove which model
          version produced a 2026 certificate.
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
