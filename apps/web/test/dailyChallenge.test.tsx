// @vitest-environment jsdom
/**
 * The daily challenge, as a person actually meets it.
 *
 * The rules — the deck, the day, the grid, the streak — are proved in
 * `packages/report/test/daily.test.ts`, where they are decided. What only a
 * RENDERED daily can show is asserted here:
 *
 *  - it plays for somebody with no account and no network at all;
 *  - two devices on the same calendar day get the same five cards;
 *  - the day is remembered, so a reload shows the result instead of dealing
 *    the same puzzle again;
 *  - and the RESULT VIEW — the screen somebody screenshots and the links they
 *    press — carries no card, no tell and no answer. The leak guard is run
 *    against the real pool over the real rendered text, because the grid
 *    being safe in a unit test is not the same as the page being safe.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { BROWSER_ROOTS } from "./helpers/browserSources";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  DAILY_DECK_SIZE,
  DAILY_LEDGER_KEY,
  dailyDay,
  dailyDeck,
  dailyGrid,
  dailyNumber,
  dailyShareLeaks,
  parseDailyLedger,
  serializeDailyLedger,
} from "@ailx/report";
import { DailyChallenge } from "../features/daily/DailyChallenge";
import { DAILY_POOL } from "../lib/demoItems";
import { ATTEMPT_KEY, LOCAL_PRACTICE_KEY } from "./helpers/keys";

const WEB_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The app's own import graph, over every directory in BROWSER_ROOTS:
 * `app/`, `components/`, `features/` and `lib/`.
 *
 * Specifiers come from the TypeScript parser — `import`, `export … from` and
 * dynamic `import()` — so one written in a comment or a string is not one, and
 * the shape of the file does not matter. Only RELATIVE specifiers are
 * resolved; a package name is a leaf, which is what a guard over this app's
 * own modules wants.
 */
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    // Keys are "/"-spelled whatever the platform, so a test can name one.
    // `.js`/`.jsx` are read too: next.config.mjs keeps them in pageExtensions,
    // so a page written in JavaScript is a page.
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(name)) out.push(relative(WEB_ROOT, full).split(sep).join("/"));
  }
  return out;
}

/** One import: where it points, and the names it brings in ("" when none). */
interface ParsedImport {
  specifier: string;
  bindings: string;
  /** The names taken from the module; "*" when the whole namespace is taken. */
  names: string[];
}

/**
 * The names an import clause takes FROM the module, one per binding.
 *
 * `{ a as b }` yields "a", because "a" is what the package handed over. A
 * clause that takes the whole namespace — `import * as c`, `export * from`,
 * a bare side-effect import, a dynamic `import()` — yields "*", so a check
 * over an allowlist of names cannot be dodged by taking everything at once.
 */
function clauseNames(clause: ts.ImportClause | ts.NamedExportBindings | undefined): string[] {
  if (!clause) return ["*"];
  const named = ts.isImportClause(clause) ? clause.namedBindings : clause;
  const out: string[] = [];
  if (ts.isImportClause(clause) && clause.name) out.push("default");
  if (!named) return out.length > 0 ? out : ["*"];
  if (ts.isNamespaceImport(named) || ts.isNamespaceExport(named)) return [...out, "*"];
  for (const element of named.elements) out.push((element.propertyName ?? element.name).text);
  return out;
}

function parseImports(source: string, name = "in.tsx"): ParsedImport[] {
  const file = ts.createSourceFile(name, source, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TSX);
  const out: ParsedImport[] = [];
  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      const clause = ts.isImportDeclaration(node) ? node.importClause : node.exportClause;
      out.push({
        specifier: node.moduleSpecifier.text,
        bindings: clause?.getText() ?? "",
        names: clauseNames(clause),
      });
    }
    if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === "require")) &&
      node.arguments[0] &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      // A dynamic import and a require() both hand over the whole module
      // namespace. require() is read because the graph covers .js and .mjs
      // files, where it is how a module is reached.
      out.push({ specifier: node.arguments[0].text, bindings: "", names: ["*"] });
    }
    // `import x = require("y")`, which TypeScript still compiles.
    if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      ts.isStringLiteralLike(node.moduleReference.expression)
    ) {
      out.push({ specifier: node.moduleReference.expression.text, bindings: "", names: ["*"] });
    }
    node.forEachChild(visit);
  };
  visit(file);
  return out;
}

const parseSpecifiers = (source: string): string[] => parseImports(source).map((i) => i.specifier);

const fileImports = (rel: string): ParsedImport[] =>
  parseImports(readFileSync(join(WEB_ROOT, rel), "utf8"), rel);

/**
 * A specifier as a path under `apps/web`, or null if it is a package. Both
 * spellings of an app module resolve: relative, and the `@/*` alias that
 * `apps/web/tsconfig.json` points at this same root.
 */
function resolveImport(from: string, spec: string): string | null {
  if (!spec.startsWith(".") && !spec.startsWith("@/")) return null;
  const base = spec.startsWith("@/")
    ? join(WEB_ROOT, spec.slice(2))
    : join(WEB_ROOT, dirname(from), spec);
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) {
      return relative(WEB_ROOT, candidate).split(sep).join("/");
    }
  }
  return null;
}

const MODULE_GRAPH = new Map<string, { imports: ParsedImport[]; files: string[] }>(
  BROWSER_ROOTS.flatMap((root) => sourceFiles(join(WEB_ROOT, root))).map((rel) => {
    const imports = fileImports(rel);
    const files = imports
      .map((i) => resolveImport(rel, i.specifier))
      .filter((f): f is string => f !== null);
    return [rel, { imports, files }];
  }),
);

/** Everything `start` imports, transitively, `start` included. */
function reachable(start: string): Set<string> {
  const seen = new Set<string>();
  const stack = [start];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (seen.has(current)) continue;
    seen.add(current);
    for (const next of MODULE_GRAPH.get(current)?.files ?? []) stack.push(next);
  }
  return seen;
}

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const store = new Map<string, string>();
/** Every storage call the app made, so a test can prove one was never made. */
const touched: string[] = [];
Object.defineProperty(window, "localStorage", {
  value: {
    getItem: (k: string) => {
      touched.push(k);
      return store.has(k) ? store.get(k)! : null;
    },
    setItem: (k: string, v: string) => {
      touched.push(k);
      store.set(k, String(v));
    },
    removeItem: (k: string) => {
      touched.push(k);
      store.delete(k);
    },
    clear: () => {
      touched.push("*");
      store.clear();
    },
  },
  configurable: true,
});

/** 2026-03-17, mid-afternoon in London — a plain, unambiguous local day. */
const NOW = Date.parse("2026-03-17T14:00:00.000Z");
const DAY = "2026-03-17";

let container: HTMLDivElement;
let root: Root;
const fetchSpy = vi.fn();

beforeEach(() => {
  store.clear();
  touched.length = 0;
  fetchSpy.mockReset();
  vi.stubGlobal("fetch", fetchSpy);
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  // The device's own timezone decides the day; pin it to UTC so the fixture
  // day is the fixture day on every machine that runs this suite.
  vi.spyOn(Date.prototype, "getTimezoneOffset").mockReturnValue(0);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function mount(): void {
  act(() => root.render(createElement(DailyChallenge)));
}

const buttons = (): HTMLButtonElement[] => [...container.querySelectorAll("button")];
const byText = (label: string): HTMLButtonElement => {
  const found = buttons().find((b) => (b.textContent ?? "").includes(label));
  if (!found) throw new Error(`no button "${label}" in: ${buttons().map((b) => b.textContent).join(" | ")}`);
  return found;
};
const click = (el: HTMLElement): void => act(() => void el.click());
const text = (): string => container.textContent ?? "";

/** Play the whole round, calling `pick` on each card. */
function playRound(pick: (cardIndex: number) => number): void {
  const deck = dailyDeck(DAY, DAILY_POOL);
  for (let i = 0; i < deck.length; i++) {
    click(byText(deck[i].options[pick(i)]));
    click(byText(i === deck.length - 1 ? "See today" : "Next card"));
  }
}

describe("the daily plays for a stranger", () => {
  it("deals today's five cards with no account and no request", () => {
    mount();
    expect(text()).toContain(`daily #${dailyNumber(DAY)}`);
    expect(text()).toContain(`Card 1 of ${DAILY_DECK_SIZE}`);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("shows the same five cards to two devices on the same calendar day", () => {
    // Tokyo, an hour after midnight; London, mid-afternoon. Same date.
    const tokyo = dailyDay(Date.parse("2026-03-17T01:00:00.000Z"), 9 * 60);
    expect(tokyo).toBe(DAY);
    expect(dailyDeck(tokyo, DAILY_POOL).map((c) => c.id)).toEqual(
      dailyDeck(DAY, DAILY_POOL).map((c) => c.id),
    );
  });

  it("teaches on every card, and only after the call", () => {
    mount();
    const first = dailyDeck(DAY, DAILY_POOL)[0];
    expect(text()).not.toContain(first.tell);
    click(byText(first.options[0]));
    expect(text()).toContain(first.tell);
  });

  it("finishes with a grid, a tally and a share row", () => {
    mount();
    const deck = dailyDeck(DAY, DAILY_POOL);
    playRound((i) => deck[i].key); // every call right
    expect(text()).toContain(dailyGrid(deck.map(() => "hit")));
    expect(text()).toContain(`${DAILY_DECK_SIZE} of ${DAILY_DECK_SIZE}`);
    expect(container.querySelector('[data-testid="share-targets"]')).not.toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("records the day, so a reload shows the result instead of dealing it again", () => {
    mount();
    const deck = dailyDeck(DAY, DAILY_POOL);
    playRound((i) => deck[i].key);
    const ledger = parseDailyLedger(store.get(DAILY_LEDGER_KEY));
    expect(ledger.days).toEqual([DAY]);
    expect(ledger.last?.results).toEqual(deck.map(() => "hit"));

    act(() => root.unmount());
    root = createRoot(container);
    mount();
    expect(text()).toContain(`AILX Daily #${dailyNumber(DAY)}`);
    expect(text()).not.toContain("Card 1 of");
  });

  it("shows a streak once the browser has one, and says what it means", () => {
    store.set(
      DAILY_LEDGER_KEY,
      serializeDailyLedger({ days: ["2026-03-15", "2026-03-16"], last: null }),
    );
    mount();
    const deck = dailyDeck(DAY, DAILY_POOL);
    playRound((i) => deck[i].key);
    expect(text()).toContain("days in a row");
    expect(text()).toContain("counts the days you came back");
    expect(text()).not.toMatch(/percentile|top \d/i);
  });

  it("does not count a picture that never loaded against the player", () => {
    mount();
    // This day's first card is a picture — the deck is deterministic, so the
    // fixture can say so rather than branching on what it finds.
    const image = container.querySelector("img");
    expect(image).not.toBeNull();
    act(() => void image!.dispatchEvent(new Event("error")));
    expect(text()).toContain("has not been counted for or against you");
    click(byText("Skip this card"));
    expect(text()).toContain(`Card 2 of ${DAILY_DECK_SIZE}`);
  });

  it("survives a rewritten or corrupt store instead of failing to render", () => {
    store.set(DAILY_LEDGER_KEY, '{"days":["not-a-day",{"day":"2026-13-45"}],"last":{"results":7}}');
    mount();
    expect(text()).toContain(`Card 1 of ${DAILY_DECK_SIZE}`);
  });
});

describe("the result view gives the day away to nobody", () => {
  it("renders no card, no id, no tell and no answer once the round is over", () => {
    mount();
    const deck = dailyDeck(DAY, DAILY_POOL);
    playRound((i) => (i % 2 === 0 ? deck[i].key : 1 - deck[i].key));
    expect(dailyShareLeaks(text(), DAILY_POOL)).toEqual([]);
  });

  it("puts nothing in a share link that is not in the grid", () => {
    mount();
    const deck = dailyDeck(DAY, DAILY_POOL);
    playRound((i) => deck[i].key);
    const links = [...container.querySelectorAll<HTMLAnchorElement>('[data-testid^="share-"] , a[data-testid^="share-"]')]
      .map((a) => a.getAttribute("href"))
      .filter((href): href is string => href !== null);
    expect(links.length).toBeGreaterThan(0);
    for (const href of links) {
      expect(dailyShareLeaks(decodeURIComponent(href), DAILY_POOL)).toEqual([]);
    }
  });
});

describe("the pool is published material and nothing else", () => {
  it("draws only on the practice corpus and the released-practice tier", async () => {
    const { PRACTICE_BANK } = await import("@ailx/report");
    const { snapshotTrack } = await import("../lib/instrument");
    const released = new Set(
      (snapshotTrack("t2").bank?.items ?? []).map((i) => (i as { id: string }).id),
    );
    const practice = new Set(PRACTICE_BANK.map((i) => i.id));
    expect(DAILY_POOL.length).toBeGreaterThan(DAILY_DECK_SIZE);
    for (const card of DAILY_POOL) {
      expect(practice.has(card.id) || released.has(card.id), card.id).toBe(true);
    }
  });

  it("asks a one-bit question on every card, with the signal call first", () => {
    for (const card of DAILY_POOL) {
      expect(card.options).toHaveLength(2);
      expect([0, 1]).toContain(card.key);
      expect(card.stem.length).toBeGreaterThan(0);
      expect(card.tell.length).toBeGreaterThan(0);
    }
  });
});

/**
 * TEN-18's second constraint: a daily result may be ranked and shared, and it
 * may never touch the credential.
 *
 * `packages/report/test/daily.test.ts` proves the GRID carries no key. What is
 * proved here: playing a round writes the daily ledger key and nothing else,
 * the daily imports no module that scores a sitting or shows a credential, and
 * no page that does either reaches a daily module. The practice ledger has the
 * same guard in `anonymousScoredSitting.test.ts`; the daily had none.
 *
 * One gap, stated so it is not mistaken for coverage. The graph follows import
 * specifiers inside `apps/web`. A package is a leaf, so what `@ailx/report`
 * itself imports is that package's own tests to prove, and a module named by a
 * computed string is not followed at all.
 */
describe("the daily never touches the credential", () => {
  /** The daily's own modules. */
  const DAILY_MODULES = ["features/daily/dailyState.ts", "features/daily/DailyChallenge.tsx"];
  /** The modules that score a sitting, keep its log, or show a credential. */
  const SCORING_MODULES = [
    "lib/registry.ts",
    "lib/persistence.ts",
    "lib/checkpoints.ts",
    "features/verify/credentialView.ts",
    "features/report/CredentialPanel.tsx",
  ];
  /** The daily page and everything it imports, transitively. */
  const DAILY_CLOSURE = [...reachable("app/daily/page.tsx")];

  /** Packages that score a sitting, or that carry an identity. */
  const BANNED_PACKAGES = /^(@ailx\/core|@clerk)/;
  /** Binding names that score, judge, rank or touch the credential. */
  const BANNED_BINDINGS = /credential|composite|judg|scor|percentile|band/i;
  /**
   * The ONLY names the daily may take from `@ailx/contract` (TEN-52).
   *
   * The package is banned by name everywhere else in this guard, because its
   * barrel also hands out `CredentialRecord`, `OwnerCredential` and the share
   * and moderation wire types. But the funnel event schema lives there too —
   * one schema, spelled once, because the browser emits the events and the
   * private service stores them — and the daily fires `play_started` and
   * `play_completed` through `lib/funnel.ts`.
   *
   * WHY THIS LIST IS SAFE, and a reader can check it in two steps:
   *
   *  1. Every name below is re-exported from `./funnel.js` and from nowhere
   *     else. The test "allows only names the funnel schema module exports"
   *     reads `packages/contract/src/index.ts` and proves it, so a name that
   *     drifts to another module drops out of the allowance.
   *  2. `packages/contract/src/funnel.ts` is the event schema: eight step
   *     names, a batch limit, a URL path, a schema version and the parsers
   *     over them. It scores nothing, judges nothing and states in its own
   *     header that no exam evidence and no share token may cross it.
   *
   * This is a list of NAMES, not a licence for type-only imports. A type
   * today is a value after one refactor, and the guard would not notice; a
   * ninth name would not be on this list, so it goes red and a human looks.
   */
  const CONTRACT_BINDINGS_ALLOWED = [
    "FUNNEL_BATCH_MAX",
    "FUNNEL_EVENTS_PATH",
    "FUNNEL_SCHEMA_VERSION",
    "FunnelBody",
    "FunnelEnvelope",
    "FunnelEvent",
    "FunnelPlayMode",
    "FunnelStep",
  ];

  /** Every import in `imports` the daily may not have, and why it may not. */
  function forbiddenImports(imports: ParsedImport[]): string[] {
    const packages = imports.filter(
      (i) => !i.specifier.startsWith(".") && !i.specifier.startsWith("@/"),
    );
    const offences: string[] = [];
    for (const i of packages) {
      if (BANNED_PACKAGES.test(i.specifier)) offences.push(`banned package: ${i.specifier}`);
      // A package is a leaf, so the NAMES it brings in matter too: @ailx/report
      // holds the daily rules and a credential helper in one barrel, and
      // @ailx/track-t2 holds the item pool and a scorer.
      if (BANNED_BINDINGS.test(i.bindings)) offences.push(`banned binding: ${i.specifier} ${i.bindings}`);
      // Taking a whole @ailx barrel takes every name in it, so no name check
      // can see what is used. `import * as React from "react"` stays legal:
      // the barrels this guard is about are ours.
      if (i.specifier.startsWith("@ailx/") && i.names.includes("*")) {
        offences.push(`whole package taken: ${i.specifier}`);
      }
      if (i.specifier === "@ailx/contract") {
        for (const name of i.names) {
          if (!CONTRACT_BINDINGS_ALLOWED.includes(name)) {
            offences.push(`banned binding: @ailx/contract ${name}`);
          }
        }
      } else if (i.specifier.startsWith("@ailx/contract/")) {
        // A deep import reaches a contract module directly, so the allowance
        // above never sees it. `@ailx/contract/dist/share-url.js` is the
        // shape that walks past a check on the package name alone.
        offences.push(`deep import: ${i.specifier}`);
      }
    }
    return offences;
  }

  it("keeps its days in a store neither the sitting nor practice reads", () => {
    for (const other of [ATTEMPT_KEY, LOCAL_PRACTICE_KEY]) {
      expect(DAILY_LEDGER_KEY).not.toBe(other);
      expect(DAILY_LEDGER_KEY.startsWith(other)).toBe(false);
      expect(other.startsWith(DAILY_LEDGER_KEY)).toBe(false);
    }
  });

  it("leaves the attempt log and the practice ledger byte-identical after a round", () => {
    // Sentinels, not key names: a daily that imported ATTEMPT_KEY and wrote to
    // it would still pass a test that only compares the spellings.
    const attempt = '{"attemptId":"att-sentinel","events":[{"seq":0,"type":"attempt_started"}]}';
    const practice = '{"days":[{"day":"2026-03-16","sessions":1,"answered":6,"correct":4}]}';
    store.set(ATTEMPT_KEY, attempt);
    store.set(LOCAL_PRACTICE_KEY, practice);
    touched.length = 0;

    mount();
    const deck = dailyDeck(DAY, DAILY_POOL);
    playRound((i) => deck[i].key);

    expect(store.get(ATTEMPT_KEY)).toBe(attempt);
    expect(store.get(LOCAL_PRACTICE_KEY)).toBe(practice);
    // The round did happen, so the two above are unchanged because nothing
    // wrote them, not because nothing ran.
    expect(parseDailyLedger(store.get(DAILY_LEDGER_KEY)).days).toEqual([DAY]);
    // And no third key either: a new store is a new place a streak could go.
    expect([...store.keys()].sort()).toEqual(
      [ATTEMPT_KEY, DAILY_LEDGER_KEY, LOCAL_PRACTICE_KEY].sort(),
    );
    // Equal bytes at the end would also hold for a read, or for a write and a
    // restore, so every storage CALL is recorded and only one key was named.
    expect([...new Set(touched)]).toEqual([DAILY_LEDGER_KEY]);
  });

  it("imports nothing from the exam, scoring or credential path", () => {
    // Transitive, and read from parsed imports rather than from the text: the
    // page reaches lib/demoItems.ts and lib/instrument.ts, so a scoring module
    // pulled in one step further along would be missed by a per-file grep.
    expect(SCORING_MODULES.filter((m) => DAILY_CLOSURE.includes(m))).toEqual([]);
    // The daily may import @ailx/report (the daily rules), @ailx/session (the
    // StorageLike type) and the funnel schema out of @ailx/contract, and does.
    // That the daily asks the service for nothing at all is pinned above,
    // where a round is played with fetch stubbed.
    const offences = forbiddenImports(DAILY_CLOSURE.flatMap((f) => MODULE_GRAPH.get(f)?.imports ?? []));
    expect(offences, offences.join("; ")).toEqual([]);
  });

  it("allows only names the funnel schema module exports", () => {
    // The allowance above is safe because every name in it comes from
    // packages/contract/src/funnel.ts. That claim is read out of the contract
    // barrel rather than trusted: a name that moves to another module, or one
    // added to the allowance that was never funnel schema, fails here.
    const barrel = readFileSync(
      join(WEB_ROOT, "../../packages/contract/src/index.ts"),
      "utf8",
    );
    const fromFunnel = parseImports(barrel, "index.ts")
      .filter((i) => i.specifier === "./funnel.js")
      .flatMap((i) => i.names);
    expect(fromFunnel).toContain("FUNNEL_SCHEMA_VERSION");
    expect(CONTRACT_BINDINGS_ALLOWED.filter((n) => !fromFunnel.includes(n))).toEqual([]);
    // And the barrel does hand out the names this allowance is narrow about,
    // so "not on the list" is a real exclusion and not a spelling accident.
    const everything = parseImports(barrel, "index.ts").flatMap((i) => i.names);
    expect(everything).toContain("CredentialRecord");
    expect(everything).toContain("ShareStatus");
  });

  /**
   * The guard can fail, one mutation per rule.
   *
   * Each case is a module the daily could plausibly grow tomorrow. None is
   * committed; the source is written here and parsed by the same parser the
   * real graph uses, so a rule that stopped firing is red in this file.
   */
  it.each([
    // The first two are the names TEN-52 is about: the contract's barrel
    // hands out `CredentialRecord` and `OwnerCredential` today, and a
    // scoring name would be as easy to take. None may reach the daily.
    ["a scoring binding from the contract", 'import { compositeBand } from "@ailx/contract";'],
    ["a credential type from the contract", 'import type { OwnerCredential } from "@ailx/contract";'],
    ["a credential record from the contract", 'import { CredentialRecord } from "@ailx/contract";'],
    ["a share type from the contract", 'import { type ShareStatus } from "@ailx/contract";'],
    ["the whole contract namespace", 'import * as contract from "@ailx/contract";'],
    ["a re-export of the whole contract", 'export * from "@ailx/contract";'],
    ["a renamed credential binding", 'import { OwnerCredential as X } from "@ailx/contract";'],
    ["a dynamic contract import", 'const m = await import("@ailx/contract");'],
    ["a require of the contract", 'const c = require("@ailx/contract");'],
    ["an import-equals of the contract", 'import c = require("@ailx/contract");'],
    ["a deep import past the barrel", 'import type { ShareStatus } from "@ailx/contract/dist/share-url.js";'],
    ["the whole report barrel", 'import * as report from "@ailx/report";'],
    ["a dynamic report import", 'const r = await import("@ailx/report");'],
    ["a scorer from core", 'import { round3 } from "@ailx/core";'],
    ["a judge helper from report", 'import { judgeDemo } from "@ailx/report";'],
    ["an identity SDK", 'import { useUser } from "@clerk/nextjs";'],
  ])("fails on %s", (_case, source) => {
    expect(forbiddenImports(parseImports(source))).not.toEqual([]);
  });

  it("stays quiet on the funnel imports the daily actually has", () => {
    // The mirror of the mutations: the emitter's own import list, verbatim,
    // must pass. Otherwise the rule above could be "ban everything" and every
    // mutation would still be red.
    const emitter = MODULE_GRAPH.get("lib/funnel.ts")?.imports ?? [];
    expect(emitter.some((i) => i.specifier === "@ailx/contract")).toBe(true);
    expect(forbiddenImports(emitter)).toEqual([]);
  });

  it("is reached by no page that scores or shows a credential", () => {
    // Every route file the app has, not a hand-picked six: a page added
    // tomorrow is in this list without anybody remembering to add it.
    const pages = [...MODULE_GRAPH.keys()].filter((f) => /^app\/.*(page|route)(\.api)?\.tsx?$/.test(f));
    expect(pages.length).toBeGreaterThan(10);
    expect(pages).toContain("app/report/page.tsx");
    expect(pages).toContain("app/daily/page.tsx");

    const offenders = pages
      .map((page) => ({ page, reaches: reachable(page) }))
      .filter(({ reaches }) => SCORING_MODULES.some((m) => reaches.has(m)))
      .map(({ page, reaches }) => ({ page, daily: DAILY_MODULES.filter((m) => reaches.has(m)) }))
      .filter((r) => r.daily.length > 0);
    expect(offenders, JSON.stringify(offenders)).toEqual([]);
  });

  it("is reached by no layout, which Next wraps around every page", () => {
    // A page closure holds what the page imports. Next also renders each page
    // inside its ancestor layouts, so those are read here rather than folded
    // into the page closures: the root layout mounts the auth shell, and
    // folding it in would make every page an identity-reaching page.
    const layouts = [...MODULE_GRAPH.keys()].filter((f) => /^app\/.*(layout|template)\.tsx?$/.test(f));
    expect(layouts).toContain("app/layout.tsx");
    for (const layout of layouts) {
      const reaches = reachable(layout);
      expect(DAILY_MODULES.filter((m) => reaches.has(m)), layout).toEqual([]);
    }
  });

  it("classifies the pages this guard depends on, so it cannot pass by finding nothing", () => {
    // If `app/report/page.tsx` stopped counting as a scoring page, the test
    // above would go quiet instead of red.
    for (const page of ["app/report/page.tsx", "app/exam/page.tsx", "app/verify/[code]/page.api.tsx"]) {
      const reaches = reachable(page);
      expect(SCORING_MODULES.filter((m) => reaches.has(m)), page).not.toEqual([]);
    }
    // And the daily page does reach the daily, so the modules being looked for
    // are spelled the way the app spells them.
    expect(DAILY_MODULES.filter((m) => reachable("app/daily/page.tsx").has(m))).toEqual(DAILY_MODULES);
  });

  it("reaches no identity, so a signed-in player's daily is the same daily", () => {
    expect(DAILY_CLOSURE.filter((f) => /^lib\/auth/.test(f))).toEqual([]);
  });

  it("reads imports with the compiler, so no string can hide one", () => {
    // The regex stripper this replaced cut everything after a `//` inside a
    // string, which deleted real code from the text being checked.
    expect(parseSpecifiers('const url = "https://x";\nimport { a } from "./persistence";')).toEqual([
      "./persistence",
    ]);
    // A specifier in a comment or a string is not an import.
    expect(parseSpecifiers('/** imports "./checkpoints" one day */\nconst s = "./registry";')).toEqual([]);
    expect(parseSpecifiers('// import { x } from "./credentialView";')).toEqual([]);
    // The three shapes that do reach a module.
    expect(parseSpecifiers('import type { S } from "@ailx/session";')).toEqual(["@ailx/session"]);
    expect(parseSpecifiers('export { a } from "./dailyState";')).toEqual(["./dailyState"]);
    expect(parseSpecifiers('const m = await import("./DailyChallenge");')).toEqual(["./DailyChallenge"]);
    // A constant template literal is a specifier, not a computed one.
    expect(parseSpecifiers("const m = await import(`./persistence`);")).toEqual(["./persistence"]);
    // The names an import brings in are kept, so a package leaf can be judged
    // by what it hands over.
    expect(parseImports('import { credentialView as v } from "@ailx/report";')[0].bindings).toContain(
      "credentialView",
    );
    // And as names, taken from the package's side of the rename, so an
    // allowlist reads what the package handed over rather than the local
    // spelling. Taking the whole namespace is the name "*", which no
    // allowlist holds.
    expect(parseImports('import { credentialView as v } from "@ailx/report";')[0].names).toEqual([
      "credentialView",
    ]);
    expect(parseImports('import * as r from "@ailx/report";')[0].names).toEqual(["*"]);
    expect(parseImports('export * from "@ailx/report";')[0].names).toEqual(["*"]);
    expect(parseImports('import "@ailx/report";')[0].names).toEqual(["*"]);
    expect(parseImports('import r from "@ailx/report";')[0].names).toEqual(["default"]);
    // The two CommonJS shapes reach a module as surely as an import does, and
    // this graph reads .js and .mjs files where they are the only shapes.
    expect(parseSpecifiers('const r = require("@ailx/report");')).toEqual(["@ailx/report"]);
    expect(parseSpecifiers('import r = require("@ailx/report");')).toEqual(["@ailx/report"]);
    expect(parseSpecifiers('const r = notRequire("@ailx/report");')).toEqual([]);
  });

  it("resolves both spellings of an app module, so the @/ alias is not a leaf", () => {
    // tsconfig.json maps "@/*" onto apps/web, so "@/lib/persistence" and
    // "../lib/persistence" are the same file and must resolve the same way.
    expect(resolveImport("app/daily/page.tsx", "@/lib/persistence")).toBe("lib/persistence.ts");
    expect(resolveImport("app/daily/page.tsx", "../../lib/persistence")).toBe("lib/persistence.ts");
    expect(resolveImport("app/daily/page.tsx", "@ailx/report")).toBeNull();
  });
});
