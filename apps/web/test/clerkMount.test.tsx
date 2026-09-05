// @vitest-environment jsdom
/**
 * The Clerk half of the atomic switch (docs/ARCHITECTURE.md §10.2).
 *
 * Four claims, and each one is a way the switch could quietly break:
 *
 *  1. a signed-in session becomes an `Authorization: Bearer` header on every
 *     call, with no call site changed — the seam does its job;
 *  2. a token that is missing, empty or refuses to refresh falls back to the
 *     dev id instead of killing the run (the SERVER decides what is enough);
 *  3. the static GitHub Pages export mounts no provider and resolves no auth
 *     SDK — it is our only public deployment and it has no auth at all;
 *  4. `lib/data/authHeaders.ts` stays SDK-free, and the publishable key is read in
 *     exactly one place.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";
import { act, createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { DEV_USER_HEADER } from "@ailx/contract";
import { browserSources } from "./helpers/browserSources";

const webDir = join(dirname(fileURLToPath(import.meta.url)), "..");

/** The Clerk session this render sees. Reassigned per case. */
let session = {
  isSignedIn: undefined as boolean | undefined,
  getToken: (async () => null) as () => Promise<string | null>,
};

vi.mock("@clerk/nextjs", () => ({
  useAuth: () => session,
  ClerkProvider: ({ children }: { children?: ReactNode }) => children ?? null,
  SignedIn: () => null,
  SignedOut: () => null,
  UserButton: () => null,
}));

const { ClerkTokenBridge } = await import("../lib/auth/ClerkTokenBridge");
const { AuthShell } = await import("../lib/auth/AuthShell");
const { authHeaders, hasAuthTokenSource, setAuthTokenSource } = await import("../lib/data/authHeaders");
const { isClerkEnabled } = await import("../lib/mode");

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const storage = {
  map: new Map<string, string>(),
  getItem: (k: string) => storage.map.get(k) ?? null,
  setItem: (k: string, v: string) => void storage.map.set(k, v),
  removeItem: (k: string) => void storage.map.delete(k),
};

let root: Root | null = null;
let host: HTMLElement | null = null;

function mountBridge(): void {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(createElement(ClerkTokenBridge)));
}

function unmountBridge(): void {
  if (root) act(() => root!.unmount());
  host?.remove();
  root = null;
  host = null;
}

beforeEach(() => {
  storage.map.clear();
  setAuthTokenSource(null);
  session = { isSignedIn: false, getToken: async () => null };
});

afterEach(() => {
  unmountBridge();
  setAuthTokenSource(null);
  vi.unstubAllEnvs();
});

describe("ClerkTokenBridge registers the session with the header seam", () => {
  it("a signed-in user's token rides every call as a bearer header", async () => {
    session = { isSignedIn: true, getToken: async () => "jwt-abc" };
    mountBridge();
    expect(hasAuthTokenSource()).toBe(true);
    expect(await authHeaders(storage)).toEqual({ authorization: "Bearer jwt-abc" });
  });

  it("asks the session for a FRESH token on every call, never caches one", async () => {
    // Clerk's getToken() refreshes a short-lived JWT. Registering its RESULT
    // instead of the function would pin an expiring token for the session.
    const tokens = ["jwt-1", "jwt-2"];
    session = { isSignedIn: true, getToken: async () => tokens.shift() ?? null };
    mountBridge();
    expect(await authHeaders(storage)).toEqual({ authorization: "Bearer jwt-1" });
    expect(await authHeaders(storage)).toEqual({ authorization: "Bearer jwt-2" });
  });

  it("registers nothing while Clerk is still loading", async () => {
    // Clerk reports `isSignedIn: undefined` until it has loaded, and a user who
    // IS signed in looks exactly like a stranger until then. Registering on
    // anything but a literal true would be right only by accident.
    session = { isSignedIn: undefined, getToken: async () => "jwt-abc" };
    mountBridge();
    expect(hasAuthTokenSource()).toBe(false);
    expect(Object.keys(await authHeaders(storage))).toEqual([DEV_USER_HEADER]);
  });

  it("registers on sign-in and unregisters again on sign-out", async () => {
    session = { isSignedIn: true, getToken: async () => "jwt-abc" };
    mountBridge();
    expect(hasAuthTokenSource()).toBe(true);
    session = { isSignedIn: false, getToken: async () => null };
    act(() => root!.render(createElement(ClerkTokenBridge)));
    expect(hasAuthTokenSource()).toBe(false);
    expect(Object.keys(await authHeaders(storage))).toEqual([DEV_USER_HEADER]);
  });

  it("unregisters when it unmounts, so no stale session outlives the tree", () => {
    session = { isSignedIn: true, getToken: async () => "jwt-abc" };
    mountBridge();
    expect(hasAuthTokenSource()).toBe(true);
    unmountBridge();
    expect(hasAuthTokenSource()).toBe(false);
  });
});

describe("a broken token never kills the run", () => {
  it("falls back to the dev id when the session yields no token", async () => {
    session = { isSignedIn: true, getToken: async () => null };
    mountBridge();
    const h = await authHeaders(storage);
    expect(Object.keys(h)).toEqual([DEV_USER_HEADER]);
    expect(h[DEV_USER_HEADER]).toBe(storage.getItem("foray:dev-user"));
  });

  it("falls back on an empty token rather than sending `Bearer `", async () => {
    session = { isSignedIn: true, getToken: async () => "" };
    mountBridge();
    expect(Object.keys(await authHeaders(storage))).toEqual([DEV_USER_HEADER]);
  });

  it("falls back when the refresh throws", async () => {
    session = {
      isSignedIn: true,
      getToken: async () => {
        throw new Error("network");
      },
    };
    mountBridge();
    expect(Object.keys(await authHeaders(storage))).toEqual([DEV_USER_HEADER]);
  });
});

// ---- which build mounts a provider at all -------------------------------

function* walk(node: ReactNode): Generator<ReactElement> {
  if (Array.isArray(node)) {
    for (const n of node) yield* walk(n);
    return;
  }
  if (!isValidElement(node)) return;
  yield node;
  const props = node.props as { children?: ReactNode };
  if (props && props.children !== undefined) yield* walk(props.children);
}

function shellTree(): ReactElement[] {
  return [...walk(AuthShell({ children: createElement("main", null, "page") }))];
}

describe("isClerkEnabled", () => {
  it("is false in the static export even if a key leaks into its env", () => {
    vi.stubEnv("NEXT_PUBLIC_AILX_BACKEND", "");
    vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "pk_test_x");
    expect(isClerkEnabled()).toBe(false);
  });

  it("is false in the hosted build with no key — a keyless deploy still works", () => {
    vi.stubEnv("NEXT_PUBLIC_AILX_BACKEND", "1");
    vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "");
    expect(isClerkEnabled()).toBe(false);
    vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", undefined as unknown as string);
    expect(isClerkEnabled()).toBe(false);
  });

  it("is true only in the hosted build with a key", () => {
    vi.stubEnv("NEXT_PUBLIC_AILX_BACKEND", "1");
    vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "pk_test_x");
    expect(isClerkEnabled()).toBe(true);
  });
});

describe("AuthShell", () => {
  it("renders its children untouched when Clerk is not enabled", () => {
    vi.stubEnv("NEXT_PUBLIC_AILX_BACKEND", "");
    vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "pk_test_x");
    const tree = shellTree();
    expect(tree.some((e) => e.type === ClerkTokenBridge)).toBe(false);
    expect(tree.some((e) => e.type === "main")).toBe(true);
  });

  it("mounts the provider AND the token bridge in the hosted build", () => {
    vi.stubEnv("NEXT_PUBLIC_AILX_BACKEND", "1");
    vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "pk_test_x");
    const tree = shellTree();
    expect(tree.some((e) => e.type === ClerkTokenBridge)).toBe(true);
    // ...and the children are still there, below it.
    expect(tree.some((e) => e.type === "main")).toBe(true);
  });
});

// ---- the static export must not carry an auth SDK -----------------------

const appAndLib = browserSources();
const CLERK_IMPORT = /(?:from|import|require)\s*\(?\s*["']@clerk\/[^"']*["']/;

/** Every name `lib/auth/*` imports from @clerk/nextjs, read from the source. */
function clerkImports(): string[] {
  const wanted = new Set<string>();
  for (const file of appAndLib.filter((f) => relative(webDir, f).startsWith(join("lib", "auth")))) {
    const m = /import\s*\{([^}]*)\}\s*from\s*["']@clerk\/nextjs["']/.exec(readFileSync(file, "utf8"));
    if (m) for (const name of m[1].split(",")) if (name.trim()) wanted.add(name.trim());
  }
  if (wanted.size === 0) throw new Error("no @clerk/nextjs imports found — the scan is broken");
  return [...wanted];
}

describe("one place imports the SDK, one place reads the key", () => {
  it("sees the files it is judging (guards against a silent glob bug)", () => {
    expect(appAndLib.length).toBeGreaterThan(20);
    expect(appAndLib.map((f) => relative(webDir, f))).toContain(join("lib", "data", "authHeaders.ts"));
  });

  it("lib/data/authHeaders.ts imports no auth SDK — the static bundle depends on it", () => {
    const src = readFileSync(join(webDir, "lib", "data", "authHeaders.ts"), "utf8");
    expect(CLERK_IMPORT.test(src)).toBe(false);
  });

  it("only lib/auth/* and the sign-in pages import @clerk/*", () => {
    const allowed = new Set([
      join("lib", "auth", "AuthShell.tsx"),
      join("lib", "auth", "ClerkTokenBridge.tsx"),
      join("lib", "auth", "AuthNav.tsx"),
      join("app", "sign-in", "[[...sign-in]]", "page.api.tsx"),
      join("app", "sign-up", "[[...sign-up]]", "page.api.tsx"),
    ]);
    const offenders = appAndLib
      .filter((f) => CLERK_IMPORT.test(readFileSync(f, "utf8")))
      .map((f) => relative(webDir, f))
      .filter((f) => !allowed.has(f));
    expect(offenders, `import an auth SDK: ${offenders.join(", ")}`).toEqual([]);
  });

  it("only lib/mode.ts reads NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", () => {
    const offenders = appAndLib
      .filter((f) => readFileSync(f, "utf8").includes("process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY"))
      .map((f) => relative(webDir, f))
      .filter((f) => f !== join("lib", "mode.ts"));
    expect(offenders).toEqual([]);
  });

  it("the stub exports every name lib/auth/* imports from @clerk/nextjs", async () => {
    // The export build resolves @clerk/nextjs to the stub, so a name added to
    // an import here and not there is a broken GitHub Pages build — found at
    // deploy time, not now, unless this test holds the pair together.
    const stub = await import("../lib/auth/clerkStub");
    for (const name of clerkImports()) expect(Object.keys(stub), name).toContain(name);
  });

  it("imports no component Clerk Core 3 removed", async () => {
    // @clerk/nextjs v7 still EXPORTS SignedIn/SignedOut/Protect — as functions
    // that throw "not available in @clerk/nextjs Core 3" the moment they
    // render. So an export-name check proves nothing; the only honest question
    // is what the real package does when you call the thing. It cost a failed
    // hosted build to learn, and it is one grep away from happening again the
    // next time somebody pastes a Clerk snippet written for Core 2.
    const real = (await vi.importActual("@clerk/nextjs")) as Record<string, unknown>;
    const removed: string[] = [];
    for (const name of clerkImports()) {
      const value = real[name];
      expect(value, `@clerk/nextjs no longer exports ${name}`).toBeDefined();
      if (typeof value !== "function") continue;
      try {
        (value as (p: unknown) => unknown)({});
      } catch (e) {
        if (/is not available in @clerk\/nextjs/.test(String(e))) removed.push(name);
      }
    }
    expect(removed, `removed in Core 3: ${removed.join(", ")}`).toEqual([]);
  });

  it("the sign-in surface exists only in the hosted build, by name", () => {
    for (const route of ["sign-in/[[...sign-in]]", "sign-up/[[...sign-up]]"]) {
      const dir = join(webDir, "app", route);
      expect(readdirSync(dir), route).toEqual(["page.api.tsx"]);
    }
  });
});
