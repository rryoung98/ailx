/**
 * TEN-216 — the report tree may not take a VALUE out of a zod-carrying
 * contract module.
 *
 * `packages/contract/src/index.ts` is a barrel, and several of the modules
 * behind it (`credential.ts`, `progress.ts`, `share-view.ts`, `tables.ts`,
 * `gallery.ts`, `profile.ts`) import zod at MODULE SCOPE. Every page in this
 * app imports `apiPath` from that barrel, so the only thing keeping zod off
 * report.html today is the bundler shaking the untouched modules out. That is
 * a property nothing checks: `credentialViewFrom` is a VALUE in the zod-
 * carrying `credential.ts` and is exported from the barrel, while
 * `features/report/CredentialPanel.tsx` takes only `type OwnerCredential`.
 * The day somebody reaches for the value instead of the type, report.html
 * gains zod back and only `test/bundleBudget.test.ts` notices, after the fact
 * and in bytes rather than in names.
 *
 * So the shake-out becomes a CHECKED property. A TYPE import is fine and must
 * stay fine — it is erased before a byte is bundled — which is the whole
 * distinction this guard is built on.
 *
 * The graph walk is `helpers/moduleGraph.ts`, shared with the daily's own
 * "what does this page reach" guard (`dailyChallenge.test.tsx`).
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  MODULE_GRAPH,
  WEB_ROOT,
  type ParsedImport,
  parseImports,
  reachable,
} from "./helpers/moduleGraph";

const CONTRACT_SRC = join(WEB_ROOT, "../../packages/contract/src");

/** Every `*.ts` module in the contract's source, by file name. */
const CONTRACT_MODULES = readdirSync(CONTRACT_SRC).filter((f) => f.endsWith(".ts"));

/** `"./credential.js"` → `"credential.ts"`; null for anything else. */
function contractModuleOf(specifier: string): string | null {
  if (!specifier.startsWith("./")) return null;
  const file = `${specifier.slice(2).replace(/\.js$/, "")}.ts`;
  return CONTRACT_MODULES.includes(file) ? file : null;
}

/**
 * The contract modules that put zod in a bundle, DERIVED rather than listed:
 * a module that imports zod as a value, and any module that imports one of
 * those as a value. A list written by hand here would go stale the first time
 * a schema moves, and staleness in a guard reads exactly like safety.
 */
const ZOD_MODULES: ReadonlySet<string> = (() => {
  const imports = new Map<string, ParsedImport[]>(
    CONTRACT_MODULES.map((f) => [f, parseImports(readFileSync(join(CONTRACT_SRC, f), "utf8"), f)]),
  );
  const carries = new Set<string>();
  for (const [file, list] of imports) {
    if (list.some((i) => i.specifier === "zod" && i.valueNames.length > 0)) carries.add(file);
  }
  for (let changed = true; changed; ) {
    changed = false;
    for (const [file, list] of imports) {
      if (carries.has(file)) continue;
      const reaches = list.some((i) => {
        const target = contractModuleOf(i.specifier);
        return target !== null && carries.has(target) && i.valueNames.length > 0;
      });
      if (reaches) {
        carries.add(file);
        changed = true;
      }
    }
  }
  return carries;
})();

/**
 * Which contract module each barrel name comes from. Read out of the barrel
 * with the same parser, so a name that moves between modules moves here too.
 * A name exported from more than one place maps to all of them.
 */
const NAME_SOURCES: ReadonlyMap<string, string[]> = (() => {
  const barrel = parseImports(readFileSync(join(CONTRACT_SRC, "index.ts"), "utf8"), "index.ts");
  const out = new Map<string, string[]>();
  for (const i of barrel) {
    const module = contractModuleOf(i.specifier);
    if (module === null) continue;
    for (const name of i.names) out.set(name, [...(out.get(name) ?? []), module]);
  }
  return out;
})();

/** Every file under `features/report/`, "/"-spelled relative to apps/web. */
const REPORT_FILES = [...MODULE_GRAPH.keys()].filter((f) => f.startsWith("features/report/"));

/**
 * The report tree AND everything it imports inside this app. Transitive,
 * because a helper the report reaches is in the report's chunk as surely as
 * the report's own file is.
 */
const REPORT_CLOSURE = [...new Set(REPORT_FILES.flatMap((f) => [...reachable(f)]))];

/**
 * Every reason `imports` puts zod on this surface, in words a reader can act
 * on. Empty means the surface is clean.
 */
function zodOffences(where: string, imports: readonly ParsedImport[]): string[] {
  const offences: string[] = [];
  for (const i of imports) {
    if (i.specifier === "zod") {
      offences.push(`${where} imports zod directly — the report may not carry a schema runtime`);
      continue;
    }
    if (i.specifier.startsWith("@ailx/contract/")) {
      // A deep import walks past the barrel, so no name check would see it.
      offences.push(
        `${where} deep-imports ${i.specifier} — import from "@ailx/contract" so this guard can read the name`,
      );
      continue;
    }
    if (i.specifier !== "@ailx/contract") continue;
    for (const name of i.valueNames) {
      if (name === "*") {
        offences.push(
          `${where} takes the whole @ailx/contract namespace — that is every zod module in the barrel; ` +
            "name the bindings you use instead",
        );
        continue;
      }
      const from = (NAME_SOURCES.get(name) ?? []).filter((m) => ZOD_MODULES.has(m));
      if (from.length > 0) {
        offences.push(
          `${where} imports the VALUE "${name}" from @ailx/contract, which lives in ${from.join(", ")} — ` +
            "a zod module, so this puts zod back in report.html. Take it as `import type` if a type is " +
            "all you need; otherwise move the value to a zod-free contract module, or re-measure " +
            "test/bundleBudget.test.ts and say so here.",
        );
      }
    }
  }
  return offences;
}

describe("the report tree keeps zod out by rule, not by tree-shaking luck", () => {
  it("finds the report modules it is supposed to be guarding", () => {
    // A guard over an empty set passes. These three are the named risk: the
    // credential panel, the composite view and the share link all import from
    // the barrel today.
    expect(REPORT_FILES).toContain("features/report/CredentialPanel.tsx");
    expect(REPORT_FILES).toContain("features/report/compositeView.ts");
    expect(REPORT_FILES).toContain("features/report/ShareLink.tsx");
    expect(REPORT_CLOSURE.length).toBeGreaterThan(REPORT_FILES.length);
  });

  it("derives which contract modules carry zod, and the derivation is right", () => {
    // Read from the contract's own source: these six import zod at module
    // scope today.
    for (const file of ["credential.ts", "gallery.ts", "profile.ts", "progress.ts", "share-view.ts", "tables.ts"]) {
      expect([...ZOD_MODULES], file).toContain(file);
    }
    // And these do not, which is why `apiPath`, `CUTLINE_BANDS` and
    // `parseAttemptComposite` are legal on the report.
    for (const file of ["routes.ts", "composite.ts", "share-url.ts", "share.ts", "items.ts", "site-url.ts"]) {
      expect([...ZOD_MODULES], file).not.toContain(file);
    }
  });

  it("maps every barrel name back to the module it came from", () => {
    // The named risk of TEN-216, spelled out: this PR exports a VALUE from a
    // zod module through the barrel, and the type next to it is free.
    expect(NAME_SOURCES.get("credentialViewFrom")).toEqual(["credential.ts"]);
    expect(NAME_SOURCES.get("OwnerCredential")).toEqual(["credential.ts"]);
    expect(NAME_SOURCES.get("apiPath")).toEqual(["routes.ts"]);
  });

  it("takes no value out of a zod-carrying contract module", () => {
    const offences = REPORT_CLOSURE.flatMap((f) =>
      zodOffences(f, MODULE_GRAPH.get(f)?.imports ?? []),
    );
    expect(offences, offences.join("\n")).toEqual([]);
  });

  it("still lets the report take TYPES out of the same zod modules", () => {
    // The permission this guard depends on being true: CredentialPanel.tsx
    // takes `type OwnerCredential` out of credential.ts today, and must keep
    // being allowed to. A guard that banned the type would be obeyed by
    // deleting the type import, which changes nothing about the bundle.
    const panel = MODULE_GRAPH.get("features/report/CredentialPanel.tsx")?.imports ?? [];
    const contract = panel.find((i) => i.specifier === "@ailx/contract");
    expect(contract?.names, "the panel no longer imports from the barrel").toContain("OwnerCredential");
    expect(contract?.valueNames).not.toContain("OwnerCredential");
    expect(zodOffences("features/report/CredentialPanel.tsx", panel)).toEqual([]);
  });

  /**
   * The guard can fail, one shape per rule. None of these is committed: the
   * source is written here and parsed by the same parser the real graph uses,
   * so a rule that stopped firing goes red in this file rather than going
   * quiet in the one it is meant to protect.
   */
  it.each([
    ["the value this PR newly exported", 'import { credentialViewFrom } from "@ailx/contract";'],
    ["a value beside a legal type", 'import { credentialViewFrom, type OwnerCredential } from "@ailx/contract";'],
    ["a renamed value", 'import { credentialViewSchema as s } from "@ailx/contract";'],
    ["a progress schema", 'import { progressResponseSchema } from "@ailx/contract";'],
    ["a share-view schema", 'import { sharedViewSchema } from "@ailx/contract";'],
    ["the response-schema table", 'import { API_RESPONSE_SCHEMAS } from "@ailx/contract";'],
    ["a gallery parser", 'import { parseGalleryQuery } from "@ailx/contract";'],
    ["a re-export of a schema", 'export { credentialViewSchema } from "@ailx/contract";'],
    ["the whole barrel", 'import * as contract from "@ailx/contract";'],
    ["a dynamic barrel import", 'const c = await import("@ailx/contract");'],
    ["a deep import past the barrel", 'import { credentialViewFrom } from "@ailx/contract/dist/credential.js";'],
    ["zod itself", 'import { z } from "zod";'],
  ])("goes red on %s", (_case, source) => {
    expect(zodOffences("a report module", parseImports(source))).not.toEqual([]);
  });

  it.each([
    ["a type from a zod module", 'import type { OwnerCredential } from "@ailx/contract";'],
    ["an inline type from a zod module", 'import { type CredentialView } from "@ailx/contract";'],
    ["a type re-export", 'export type { SharedView } from "@ailx/contract";'],
    ["a value from a zod-free module", 'import { apiPath, API_ROUTES } from "@ailx/contract";'],
    ["the composite parser", 'import { parseAttemptComposite } from "@ailx/contract";'],
    ["a whole non-ailx namespace", 'import * as React from "react";'],
  ])("stays quiet on %s", (_case, source) => {
    expect(zodOffences("a report module", parseImports(source))).toEqual([]);
  });
});

/**
 * ADJACENT PATH: the same exposure elsewhere.
 *
 * `features/report/**` is not the only surface that imports the barrel, and
 * the others are not all clean — nor should they be. The hosted pages that
 * VALIDATE a response (progress, world, verify, share, gallery, review) take
 * `API_RESPONSE_SCHEMAS`, which is zod by design and is inside their measured
 * bundle budget. This is the inventory of those surfaces, so that a NEW one
 * is a decision somebody makes rather than a byte somebody notices later.
 */
describe("the surfaces that do carry zod are the ones that meant to", () => {
  const EXPECTED_ZOD_FEATURE_DIRS = [
    "features/gallery",
    "features/progress",
    "features/review",
    "features/share",
    "features/verify",
    "features/world",
  ];

  it("lists exactly the feature directories that take a zod value", () => {
    const dirs = [
      ...new Set(
        [...MODULE_GRAPH.entries()]
          .filter(([f]) => f.startsWith("features/"))
          .filter(([f, m]) => zodOffences(f, m.imports).length > 0)
          .map(([f]) => f.split("/").slice(0, 2).join("/")),
      ),
    ].sort();
    expect(
      dirs,
      "a feature directory gained (or lost) a zod value import. If that was intended, re-measure " +
        "apps/web/test/bundleBudget.test.ts for the pages that render it and add the directory here; " +
        "if it was not, take the binding as `import type` or move the value to a zod-free contract module.",
    ).toEqual(EXPECTED_ZOD_FEATURE_DIRS);
    // features/report is the one this file exists for, and it is not in the list.
    expect(dirs).not.toContain("features/report");
  });
});
