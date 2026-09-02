// @vitest-environment jsdom
/**
 * The API-base seam.
 *
 * `NEXT_PUBLIC_AILX_API_BASE` decides whether the browser calls this build's
 * own `app/api/**` routes or the separate exam service (Cloud Run). The repo
 * already learned what happens when a base URL is inlined per module: seven
 * files carried `NEXT_PUBLIC_BASE_PATH ?? …` with two different defaults and
 * the same file resolved to two URLs. So this file pins the seam's behaviour
 * under every shipped configuration AND forbids the raw variable from being
 * read anywhere but `lib/mode.ts`.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, sep } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiPath } from "@ailx/contract";
import { apiBase, apiOrigin, siteApiRoot, siteHref } from "../lib/mode";

const SERVICE = "https://ailx-backend-932932410694.us-central1.run.app";
const DIGEST = "sha256:abc";
const SITE_PATH = `/api/site/${DIGEST}/index.html`;

function stub(base: string | undefined, basePath = ""): void {
  vi.stubEnv("NEXT_PUBLIC_AILX_API_BASE", base as unknown as string);
  vi.stubEnv("NEXT_PUBLIC_BASE_PATH", basePath);
}

beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllEnvs());

describe("apiOrigin", () => {
  it("is empty when the variable is unset or blank — same-origin stays the default", () => {
    for (const v of [undefined, "", "   "]) {
      stub(v);
      expect(apiOrigin(), String(v)).toBe("");
    }
  });

  it("normalizes a good origin (case, default port, one trailing slash)", () => {
    for (const v of [SERVICE, `${SERVICE}/`, `  ${SERVICE}  `, SERVICE.toUpperCase().replace("HTTPS", "https")]) {
      stub(v);
      expect(apiOrigin(), v).toBe(SERVICE);
    }
    stub("https://api.ailx.example:443");
    expect(apiOrigin()).toBe("https://api.ailx.example");
    stub("http://localhost:8080");
    expect(apiOrigin()).toBe("http://localhost:8080");
  });

  it("IGNORES anything that is not a bare absolute http(s) origin", () => {
    for (const bad of [
      "//ailx.example", // protocol-relative: would fetch from whatever scheme
      "ailx.example",
      "/v1",
      "javascript:alert(1)",
      "data:text/html,x",
      "file:///etc/passwd",
      `${SERVICE}/v1`, // a PATH: the seam appends its own
      `${SERVICE}?x=1`,
      `${SERVICE}#frag`,
      "https://user:pw@ailx.example",
      "https://",
    ]) {
      stub(bad);
      expect(apiOrigin(), bad).toBe("");
    }
  });
});

describe("apiBase — the versioned root", () => {
  it("keeps the same-origin route prefix, basePath included", () => {
    stub(undefined, "");
    expect(apiBase()).toBe("/api");
    stub(undefined, "/ailx");
    expect(apiBase()).toBe("/ailx/api");
  });

  it("switches to the service's /v1 prefix, ignoring basePath", () => {
    stub(SERVICE, "/ailx");
    expect(apiBase()).toBe(`${SERVICE}/v1`);
  });

  it("composes with a manifest path into the real call shapes", () => {
    stub(SERVICE);
    expect(`${apiBase()}${apiPath("createAttempt")}`).toBe(`${SERVICE}/v1/attempts`);
    expect(`${apiBase()}${apiPath("startPractice")}`).toBe(`${SERVICE}/v1/practice`);
    expect(`${apiBase()}${apiPath("reviewDecision")}`).toBe(`${SERVICE}/v1/gallery/review`);
    expect(`${apiBase()}${apiPath("attemptItems", { id: "a1" })}`).toBe(
      `${SERVICE}/v1/attempts/a1/items`,
    );
  });
});

describe("siteApiRoot / siteHref — the served-site space", () => {
  it("stays /api/site on BOTH hosts (the path is baked into stored payloads)", () => {
    stub(undefined, "");
    expect(siteApiRoot()).toBe("/api");
    expect(siteHref(SITE_PATH)).toBe(SITE_PATH);
    stub(SERVICE);
    expect(siteApiRoot()).toBe(`${SERVICE}/api`);
    expect(siteHref(SITE_PATH)).toBe(`${SERVICE}${SITE_PATH}`);
  });

  it("prefixes the basePath same-origin, never cross-origin", () => {
    stub(undefined, "/ailx");
    expect(siteHref(SITE_PATH)).toBe(`/ailx${SITE_PATH}`);
    stub(SERVICE, "/ailx");
    expect(siteHref(SITE_PATH)).toBe(`${SERVICE}${SITE_PATH}`);
  });

  it("refuses anything that is not a stored site path", () => {
    stub(SERVICE);
    for (const bad of [
      null,
      undefined,
      "",
      "/api/attempts/x",
      "https://evil.example/api/site/x",
      "//evil.example/api/site/x",
      "javascript:alert(1)",
      "/api/site/with space",
      '/api/site/"onmouseover=',
    ]) {
      expect(siteHref(bad as string | null), String(bad)).toBeNull();
    }
  });
});

// ---- the variable is read in exactly one place --------------------------

const webDir = join(dirname(fileURLToPath(import.meta.url)), "..");

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next" || name === "out" || name === "dist") continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) sources(full, out);
    else if (/\.(ts|tsx|mjs)$/.test(name)) out.push(full);
  }
  return out;
}

describe("one seam, not seven", () => {
  it("only lib/mode.ts reads NEXT_PUBLIC_AILX_API_BASE", () => {
    const offenders = sources(join(webDir, "lib"))
      .concat(sources(join(webDir, "app")))
      // A READ of the variable, not a doc comment naming it.
      .filter((f) => readFileSync(f, "utf8").includes("process.env.NEXT_PUBLIC_AILX_API_BASE"))
      .map((f) => relative(webDir, f))
      .filter((f) => f !== join("lib", "mode.ts"));
    expect(offenders, `read the seam variable directly: ${offenders.join(", ")}`).toEqual([]);
  });

  it("no client module hard-codes an /api call path outside the seam", () => {
    const allowed = new Set([
      join("lib", "mode.ts"), // the seam itself
      join("lib", "persistence.ts"), // doc comment on ApiPersistenceOptions
      join("lib", "origin.ts"), // doc comment
      join("lib", "SiteLink.tsx"), // doc comment about the visible text
      join("lib", "Moderation.tsx"), // doc comment naming the route
    ]);
    const offenders: string[] = [];
    for (const file of sources(join(webDir, "lib")).concat(sources(join(webDir, "app")))) {
      const rel = relative(webDir, file);
      if (allowed.has(rel) || rel.startsWith(`app${sep}api${sep}`)) continue;
      const src = readFileSync(file, "utf8");
      // A fetch whose URL literal starts with /api — the pattern the seam replaces.
      if (/fetch\(\s*[`"']\/api\//.test(src) || /fetch\(\s*assetUrl\(\s*[`"']\/api\//.test(src)) {
        offenders.push(rel);
      }
    }
    expect(offenders, `bypass apiBase(): ${offenders.join(", ")}`).toEqual([]);
  });
});
