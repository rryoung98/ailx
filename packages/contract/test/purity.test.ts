import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * THE PURITY GUARD.
 *
 * `@ailx/contract` is imported by the BROWSER bundle and vendored into the
 * private exam service. Both properties die the moment something here reaches
 * for a runtime: a `node:` builtin cannot load in a browser, and
 * `process.env` or a clock would make the same call answer differently on the
 * two sides of the split. So the source is read as TEXT and asserted, rather
 * than trusted to review.
 *
 * The second half is the dependency list: a contract that depends on a server
 * package would drag `pg`, `node:fs` and the operational bank back into the
 * browser transitively, which is exactly the split this package exists to
 * make possible.
 */

const srcDir = fileURLToPath(new URL("../src", import.meta.url));
const pkgPath = fileURLToPath(new URL("../package.json", import.meta.url));

/** Source with comments removed: prose ABOUT a runtime is not a runtime. */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

const sources = readdirSync(srcDir)
  .filter((name) => name.endsWith(".ts"))
  .map((name) => ({ name, text: code(readFileSync(join(srcDir, name), "utf8")) }));

/** Anything that is not pure derivation over its arguments. */
const FORBIDDEN: readonly { readonly what: string; readonly re: RegExp }[] = [
  { what: "a node builtin", re: /from\s+"node:[a-z/]+"|require\("node:/ },
  { what: "the environment", re: /process\.env/ },
  { what: "a clock", re: /Date\.now\(\)|new Date\(\s*\)/ },
  { what: "randomness", re: /Math\.random\(|crypto\.getRandomValues|randomUUID/ },
  { what: "the network", re: /\bfetch\(|XMLHttpRequest/ },
  { what: "a database", re: /from\s+"pg"|db\.query\(/ },
];

/** Packages that carry a runtime. Depending on one would undo the split. */
const SERVER_PACKAGES = ["@ailx/backend", "@ailx/instrument", "pg", "@clerk/backend", "@vercel/blob"];

describe("@ailx/contract is pure", () => {
  it("reads its own source", () => {
    expect(sources.length).toBeGreaterThan(5);
    expect(sources.map((s) => s.name)).toContain("index.ts");
    expect(code("/* process.env */\n// fetch(\nconst a = 1;\n").trim()).toBe("const a = 1;");
  });

  it.each(sources.map((s) => s.name))("%s reaches for no runtime", (name) => {
    const { text } = sources.find((s) => s.name === name)!;
    for (const { what, re } of FORBIDDEN) {
      expect({ file: name, uses: what, found: re.test(text) }).toEqual({
        file: name,
        uses: what,
        found: false,
      });
    }
  });

  /**
   * The model gateway's own spellings, which say the OPPOSITE of a leak.
   *
   * `modelKey`, `disconnectModelKey` and the `/key` path are the routes by
   * which a browser asks whether the SERVICE is holding a provider key for it
   * and tells it to forget one (TEN-62). No route returns a key — a caller
   * sees a 12-hex fingerprint — and a provider key is not a marking scheme in
   * any case. They are removed before the check so the rule below keeps its
   * teeth everywhere else: an answer key, a rationale or a rubric would still
   * fail on the bare word.
   */
  const MODEL_GATEWAY_KEY_SPELLINGS = /\bdisconnectModelKey\b|\bmodelKey\b|\/key\b/g;

  it("names no marking scheme — the browser holds no key", () => {
    for (const { name, text } of sources) {
      const scanned = text.replace(MODEL_GATEWAY_KEY_SPELLINGS, "");
      expect({ name, leaks: /\bkey\b|rationale|rubric|judgePrompt|answerKey/i.test(scanned) }).toEqual({
        name,
        leaks: false,
      });
    }
  });

  it("the model-gateway exemption is narrow: an answer key still fails", () => {
    const scan = (text: string) =>
      /\bkey\b|rationale|rubric|judgePrompt|answerKey/i.test(text.replace(MODEL_GATEWAY_KEY_SPELLINGS, ""));
    expect(scan('modelKey: { method: "GET", path: `${MODEL_ROOT}/key` }')).toBe(false);
    expect(scan("const answerKey = 3;")).toBe(true);
    expect(scan("the key is B")).toBe(true);
    expect(scan("rubric weights")).toBe(true);
  });

  it("depends on no server package", () => {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const deps = Object.keys(pkg.dependencies ?? {});
    for (const server of SERVER_PACKAGES) {
      expect(deps).not.toContain(server);
      expect(Object.keys(pkg.devDependencies ?? {})).not.toContain(server);
    }
    // What it MAY depend on: pure derivation the browser already ships, and
    // `zod`, which IS how the wire shapes are declared here — the types are
    // inferred from the schemas, so it is not an extra layer over them
    // (docs/ADR-zod-tanstack.md). It reaches for no runtime either: the source
    // rules above run over this package, and zod's own dist imports no
    // `node:` builtin.
    expect(deps).toEqual(["@ailx/report", "zod"]);
  });
});
