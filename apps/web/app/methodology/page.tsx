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
            <h1>What is measured, how it is scored, and what is <span className="script-accent">honestly</span> not yet known</h1>
            <Annotation>no black boxes</Annotation>
          </div>
        </div>
        <p className="lede">
          The construct, what the calibration sample allows, judge governance, and the
          modularity rules that keep every score reproducible.
        </p>

        <section className="reveal">
        <span className="paper-chip" aria-hidden="true"><span className="mono paper-chip-sec">§03</span><span className="paper-chip-note">four tracks</span></span>
        <h2 id="construct">Construct definition (§03)</h2>
        <p>
          Foray defines <strong>applied AI literacy</strong> as a person&rsquo;s capacity to produce
          good outcomes in an information environment saturated with generative systems &mdash;
          stated tightly enough to be falsifiable. It resolves into four measurable capabilities,
          each of which is a track:
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
          left to be inferred: T2 is a <strong>direct</strong> measurement (discrimination
          accuracy is the construct); T3 is direct on its planted-error component and a proxy on
          its rubric component; T1 and T4 are <strong>proxy</strong> claims, where artifact
          quality proxies creative capability and the criterion is comparative human judgment,
          not a model score. The composite carries a <strong>predictive &mdash; unvalidated</strong>{" "}
          label: no claim yet that it predicts real-world outcomes, and establishing that needs
          the longitudinal follow-up on the 2028 roadmap.
        </p>

        </section>

        <section className="reveal">
        <span className="paper-chip" aria-hidden="true"><span className="mono paper-chip-sec">§09</span><span className="paper-chip-note">what the sample allows</span></span>
        <h2 id="psychometrics">Psychometric honesty, and what the calibration sample allows (§09)</h2>
        <blockquote>
          <strong>Where the numbers come from, stated plainly.</strong> The 2026 calibration
          cohort was small: <strong>n = 45</strong>. Its job was to develop and calibrate items,
          not to certify anyone. Rasch is used diagnostically to rank item difficulty and cull
          misfitting items at ±1 logit, which n = 45 supports. Person-ability logits are{" "}
          <em>not</em> reported as scores. 2PL and 3PL are off the table entirely: GLAT needed
          n = 355 for 2PL, AICOS needed 514 for 3PL. Absolute cut scores and certification
          claims are deferred until the pooled sample crosses <strong>250</strong>; until then a
          report carries percentiles and bands, never a competence certification.
        </blockquote>
        <ul>
          <li>
            <strong>The anchor-block move.</strong> An embedded block of published, externally
            normed items (AICOS-SV, 18 items, normed on n = 514 adults) costs about eight minutes
            of testing time and buys standing against a real external norm group. It also creates
            the cross-form linkage that makes Year 2 comparable to Year 1.
          </li>
          <li>
            <strong>The composite forces a normal distribution</strong> (rank → percentile →
            inverse-normal → mean 50, SD 15) rather than hoping for one. At n = 45 an empirically
            normal raw distribution is unlikely. Every export says so, and the raw-distribution
            shape is preserved separately in the data.
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
            Bookmark is ruled out: it needs IRT parameters n = 45 cannot produce. So is
            contrasting groups, which at this n is biased toward the smaller group.
          </li>
          <li>
            <strong>Cross-year comparability takes the AP model with ARC-AGI’s calibration
            discipline.</strong> Year 1 is norm-referenced by quota, and a secure anchor block is
            built from day one so Year 2 onward can be equated. The standard, once set by Angoff,
            is held fixed and the raw cut floats. The public-vs-secure performance gap is tracked
            annually as contamination telemetry.
          </li>
        </ul>

        </section>

        <section className="reveal">
        <span className="paper-chip" aria-hidden="true"><span className="mono paper-chip-sec">§10</span><span className="paper-chip-note">jury rules</span></span>
        <h2 id="judges">Judge governance (§10)</h2>
        <p>
          Where models do score, the protocol is the product. Foray adopts
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
              <td className="muted">Swap consistency: GPT-4 65.0%, Claude-v1 23.8% — the bias is strongest when candidates are close in quality</td>
              <td className="muted">Randomised position within every pair; swap used only as part of a combined strategy</td>
            </tr>
            <tr>
              <td><strong>Verbosity</strong></td>
              <td className="muted">Heterogeneous in sign across model families (+0.44 to −0.12)</td>
              <td className="muted">A heterogeneous three-family jury cancels direction; length enters comparative fits as a covariate</td>
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
        {/* No paper chip: those are numbered spec sections, and this one is
            about the app, not the instrument. siteShowcase.test.tsx counts
            them. */}
        <h2 id="storage">What is stored, and who calls the model</h2>
        <p>
          In the hosted build the exam service stores your event log, your answers, and any
          site you published. It also holds the key for the model you connect. The browser
          starts the sign-in, hands back the code it is redirected with, and is told a
          12-character fingerprint. It never receives the key.
        </p>
        <p>
          Connect nothing and the service makes no model call for you. A track that can run
          without one falls back to its own offline simulator, and says so on screen.
        </p>
        <p>
          The static demo on GitHub Pages has no service at all. Every model call there is a
          deterministic simulator seeded by SHA-256 of its inputs, and nothing leaves your
          browser.
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
          <li><strong>The package is the unit of release.</strong> Instruments live in their own repository as signed, immutable OCI artifacts, loaded by digest, never by tag.</li>
          <li><strong>Item banks are content-addressed.</strong> <code>item_id = sha256(canonical_json(item))</code>. An edited item is a <em>new</em> item, never a mutation — cohorts cannot be compared across a silently edited item.</li>
          <li><strong>Prompts are content.</strong> The judge prompt is hashed into <code>rubric_version</code>; changing it is a version bump.</li>
          <li><strong>Locales live beside the item</strong>, with translation provenance recorded, because score comparability across languages is a validity claim that will be challenged.</li>
        </ul>
        <p>
          <code>score()</code> being <strong>pure</strong> is the load-bearing constraint: no network, no clock, no randomness. Model calls happen in pipeline stages whose outputs are stored as inputs;
          <code> score()</code> then consumes stored judgments and returns a number. This is worth
          stating precisely, because an LLM judge does <em>not</em> repeat itself even at
          temperature&nbsp;0: a judgment is evidence collected once, stored immutably and
          content-addressed, and the guarantee is that <strong>re-scoring reproduces, not that
          re-judging does</strong>. Ask the judge the same question twice and you may get two
          answers; ask the scorer twice and you cannot. CI checks purity by running{" "}
          <code>score()</code> inside a harness that replaces the clock ({" "}
          <code>Date.now</code>, zero-argument <code>new Date()</code>,{" "}
          <code>performance.now</code>), randomness (<code>Math.random</code>,{" "}
          <code>crypto</code>), the network (<code>fetch</code>, <code>XMLHttpRequest</code>,{" "}
          <code>WebSocket</code>) and deferred scheduling (<code>setTimeout</code> and friends)
          with stubs that throw, rejects a scorer that returns a promise or adds a global, and
          fails the build on any drift from the per-track golden fixtures. It is a trap set on
          globals, <em>not</em> a sandbox: it cannot see a reference captured before the call, a{" "}
          <code>node:fs</code> imported at module load, or a read of <code>process.env</code>,
          so it is a strong smoke test for accidental impurity rather than a proof of it. The
          proof of record is the golden fixtures plus the append-only inputs. Re-scores are inserts linked
          by <code>superseded_by</code>, so no history is destroyed, and the stored model manifest
          makes it possible in 2029 to prove which model version produced a 2026 certificate.
        </p>
        <p>
          One limit, stated plainly rather than implied away. Byte-identical recomputation is
          verified <em>on the same JavaScript runtime</em>: CI replays every stored score on the
          Node version it pins. Scoring is not yet proven byte-identical <em>across</em> runtime
          versions, because a score record does not currently store the runtime it was produced
          on, and some scoring steps use unicode case folding, whose tables move with the
          engine’s ICU version. Closing that gap means recording the runtime in provenance and
          replaying old scores on it. Until then the claim is: reproducible from stored inputs,
          on a recorded runtime.
        </p>
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
