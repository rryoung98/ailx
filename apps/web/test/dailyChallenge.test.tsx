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
import { DailyChallenge } from "../lib/DailyChallenge";
import { DAILY_POOL } from "../lib/demoItems";
import { ATTEMPT_KEY, LOCAL_PRACTICE_KEY } from "./helpers/keys";

const WEB_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The app's own import graph, over `app/` and `lib/`.
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
      out.push({ specifier: node.moduleSpecifier.text, bindings: clause?.getText() ?? "" });
    }
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      out.push({ specifier: node.arguments[0].text, bindings: "" });
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
  [...sourceFiles(join(WEB_ROOT, "app")), ...sourceFiles(join(WEB_ROOT, "lib"))].map((rel) => {
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
  const DAILY_MODULES = ["lib/dailyState.ts", "lib/DailyChallenge.tsx"];
  /** The modules that score a sitting, keep its log, or show a credential. */
  const SCORING_MODULES = [
    "lib/registry.ts",
    "lib/persistence.ts",
    "lib/checkpoints.ts",
    "lib/credentialView.ts",
    "lib/CredentialPanel.tsx",
  ];
  /** The daily page and everything it imports, transitively. */
  const DAILY_CLOSURE = [...reachable("app/daily/page.tsx")];

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
    // The packages that score, hold identity or spell a service route. The
    // daily may import @ailx/report (the daily rules) and @ailx/session (the
    // StorageLike type), and does. That the daily asks the service for nothing
    // at all is pinned above, where a round is played with fetch stubbed.
    const packageImports = DAILY_CLOSURE.flatMap((f) => MODULE_GRAPH.get(f)?.imports ?? []).filter(
      (i) => !i.specifier.startsWith(".") && !i.specifier.startsWith("@/"),
    );
    expect(packageImports.filter((i) => /^(@ailx\/(core|contract)|@clerk)/.test(i.specifier))).toEqual([]);
    // A package is a leaf, so the NAMES it brings in matter too: @ailx/report
    // holds the daily rules and a credential helper in one barrel, and
    // @ailx/track-t2 holds the item pool and a scorer.
    expect(
      packageImports.filter((i) => /credential|composite|judg|scor|percentile|band/i.test(i.bindings)),
    ).toEqual([]);
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
  });

  it("resolves both spellings of an app module, so the @/ alias is not a leaf", () => {
    // tsconfig.json maps "@/*" onto apps/web, so "@/lib/persistence" and
    // "../lib/persistence" are the same file and must resolve the same way.
    expect(resolveImport("app/daily/page.tsx", "@/lib/persistence")).toBe("lib/persistence.ts");
    expect(resolveImport("app/daily/page.tsx", "../../lib/persistence")).toBe("lib/persistence.ts");
    expect(resolveImport("app/daily/page.tsx", "@ailx/report")).toBeNull();
  });
});
