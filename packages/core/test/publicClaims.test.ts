/**
 * The neutrality guard: public copy may not claim that AILX is neutral.
 *
 * The private funding strategy took an adversarial review on 2026-09-01 and
 * dropped the word "neutral" from every claim about ourselves. Editorial
 * independence does not cure who picked the donors, who sets the agenda, or
 * the fact that a next cheque can be withheld. The only claim available is
 * "independent under published governance", and only once the governance is
 * published: contribution caps, no donor veto over methods, staffing,
 * publication or timing, an independent board and conflict register,
 * preregistered methods, mandatory publication of negative results, and
 * funding committed before results are known. None of that exists yet, so
 * the honest public claim is a fact about the METHOD (docs/POSITIONING.md,
 * "What we can claim today").
 *
 * The public copy said "neutral third party" and "neutral examiner" for
 * months after the correction. A doc drifts back the moment somebody writes
 * a confident sentence, so this file goes red instead.
 *
 * SCOPE: prose a stranger reads. `docs/`, the spec, and the frontend's own
 * source under `apps/web/app` and `apps/web/lib`.
 *
 * WHAT IT DOES NOT BAN: the bare words. "neutral" is a legitimate technical
 * term for an alt attribute that must not leak an answer, a locale-neutral
 * media file, or a model with no length preference. "unbiased" is a
 * statistical property of a criterion. "independent" describes statistical
 * independence, an escrow agent, and a candidate's own judgement. The guard
 * matches the CLAIM PATTERN: a banned adjective attached to us, or to the
 * examiner role we want to occupy.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const SCOPE = ["docs", "apps/web/app", "apps/web/lib"];
const EXTRA_FILES = ["AILX-Spec-2026.1.md", "README.md"];
const SKIP_DIRS = new Set(["node_modules", "dist", ".next", "fixtures"]);
const TEXTUAL = /\.(md|mdx|ts|tsx|json)$/;

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const child = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(child));
    else if (entry.isFile() && TEXTUAL.test(entry.name)) {
      out.push(relative(repoRoot, child).split(/[\\/]/).join("/"));
    }
  }
  return out;
}

const files = [
  ...SCOPE.flatMap((d) => walk(join(repoRoot, d))),
  ...EXTRA_FILES.filter((f) => {
    try {
      readFileSync(join(repoRoot, f));
      return true;
    } catch {
      return false;
    }
  }),
];

/**
 * The one claim the correction allows once the governance exists. It is
 * exempt by exact spelling so that publishing it later is a deliberate act,
 * not a side effect of loosening a regex.
 */
const ALLOWED_CLAIM = /independent under published governance/gi;

/**
 * A banned adjective asserted OF US: "AILX is neutral", "we remain impartial".
 * A DENIAL is not a claim: "we are not neutral" is the sentence the correction
 * asks us to write, so the verb may not be followed by a negator.
 */
const SELF_CLAIM =
  /\b(AILX|we|our examination|the examiner)\b[^.\n]{0,60}?\b(is|are|remains?|stays?|becomes?)\s+(?!(?:not|never|no longer|nobody's|no)\b)(an?\s+|the\s+)?(?:[\w-]+[,]?\s+){0,2}(neutral|impartial|unbiased|disinterested|objective|independent)\b/gi;

/** The examiner role dressed in a banned adjective, whoever the subject is. */
const ROLE_CLAIM =
  /\b(neutral|impartial|unbiased|disinterested)\b[^.\n]{0,30}?\b(examiners?|arbiters?|assessors?|referees?|third[- ]part(?:y|ies)|exam boards?)\b/gi;

/** The noun. There is no innocent use of it in public copy. */
const NOUN_CLAIM = /\bneutralit(?:y|ies)\b/gi;

const RULES: readonly { name: string; pattern: RegExp }[] = [
  { name: "claims a banned adjective about AILX", pattern: SELF_CLAIM },
  { name: "attaches a banned adjective to the examiner role", pattern: ROLE_CLAIM },
  { name: 'uses the noun "neutrality"', pattern: NOUN_CLAIM },
];

/** Every banned claim in one string, as `rule: matched text` lines. */
function findClaims(text: string): string[] {
  const stripped = text.replace(ALLOWED_CLAIM, "");
  return RULES.flatMap((rule) =>
    [...stripped.matchAll(rule.pattern)].map((m) => `${rule.name}: ${m[0].trim()}`),
  );
}

describe("the neutrality guard can see the public copy", () => {
  it("reads the files that carried the claim", () => {
    expect(files.length).toBeGreaterThan(20);
    expect(files).toContain("docs/POSITIONING.md");
    expect(files).toContain("docs/CREDENTIAL.md");
    expect(files).toContain("AILX-Spec-2026.1.md");
    expect(files).toContain("apps/web/app/methodology/page.tsx");
  });
});

describe("the pattern separates the claim from the innocent word", () => {
  const offending = [
    "AILX is a neutral third party.",
    "AILX is neutral.",
    "We are an impartial examiner.",
    "Labs benefit from a neutral, non-sales examiner.",
    "## The neutral-third-party seat is empty",
    "the neutrality claim dies quietly",
    "The strategic asset is NEUTRALITY.",
    "Formation playbook (how neutral examiners actually got built)",
    "AILX is an independent, non-profit examiner.",
    "we are objective about our own product",
  ];
  const innocent = [
    'alt="exam material" is deliberately neutral, because a descriptive alt would leak the answer.',
    "Media files are locale-neutral.",
    "GPT-4o is near-neutral on verbosity.",
    "The first render is a neutral shell.",
    "Pointer events are neutralised so the probe reports what is painted.",
    "How far the decision threshold sits from unbiased, in either direction.",
    "A copy is deposited with an independent third party.",
    "Use a model on a hard problem while keeping independent judgment.",
    "Comparisons per candidate-rater are r / 2, independent of cohort size.",
    "Academic instruments are objectively keyed MCQ, not task performance.",
    "Each step is independently releasable.",
    "AILX does not claim to be neutral.",
    "We are not neutral, and we should stop using the word.",
    "AILX is not neutral.",
    "The examiner is never impartial.",
    "We are no longer independent of the labs.",
    "The claim is independent under published governance, once it is provable.",
  ];

  it.each(offending)("flags %j", (line) => {
    expect(findClaims(line)).not.toHaveLength(0);
  });

  it.each(innocent)("allows %j", (line) => {
    expect(findClaims(line)).toEqual([]);
  });
});

describe("public copy makes no neutrality claim", () => {
  it("has none in docs, the spec, or the frontend", () => {
    const hits = files.flatMap((f) =>
      findClaims(readFileSync(join(repoRoot, f), "utf8")).map((h) => `${f} — ${h}`),
    );
    expect(hits).toEqual([]);
  });

  it("says instead what the governance would require", () => {
    const positioning = readFileSync(join(repoRoot, "docs/POSITIONING.md"), "utf8");
    expect(positioning).toContain("What we can claim today");
    expect(positioning).toMatch(/independent under published governance/i);
    for (const condition of [
      "contribution cap",
      "veto over methods",
      "conflict register",
      "Preregistered methods",
      "negative results",
      "before results are known",
    ]) {
      expect(positioning).toContain(condition);
    }
  });
});
