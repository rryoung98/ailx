/**
 * `apps/web/e2e/service.ts` — where the E2E suite believes the exam service is.
 *
 * This is unit-tested rather than trusted because getting it wrong is silent
 * in the worst direction: a default of `localhost:8080` makes a suite that
 * seeds NOTHING look like a suite that passed, and a default of the staging
 * origin writes append-only rows into a database people demo from. Both are
 * one typo away, so the no-default rule is asserted, not just documented.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiRoot, serviceOrigin, siteRoot } from "../e2e/service";

const SERVICE = "https://ailx-backend-932932410694.us-central1.run.app";

function stub(value: string | undefined): void {
  vi.stubEnv("AILX_E2E_API_BASE", value as unknown as string);
}

afterEach(() => vi.unstubAllEnvs());

describe("serviceOrigin", () => {
  it("REFUSES to default — an unset or blank value throws with the recipe", () => {
    for (const v of [undefined, "", "   "]) {
      stub(v);
      expect(() => serviceOrigin(), String(v)).toThrow(/AILX_E2E_API_BASE is not set/);
      // The message must be actionable: it names the variable and the command.
      expect(() => serviceOrigin()).toThrow(/pnpm --filter @ailx\/web e2e/);
    }
  });

  it("never guesses localhost or staging", () => {
    stub(undefined);
    let message = "";
    try {
      serviceOrigin();
    } catch (err) {
      message = String(err);
    }
    // A default would be a value, not an error. Prove there is none.
    expect(message).toContain("not set");
    expect(() => serviceOrigin()).toThrow();
  });

  it("normalizes a good origin (case, default port, one trailing slash)", () => {
    for (const v of [SERVICE, `${SERVICE}/`, `  ${SERVICE}  `]) {
      stub(v);
      expect(serviceOrigin(), v).toBe(SERVICE);
    }
    stub("https://api.ailx.example:443");
    expect(serviceOrigin()).toBe("https://api.ailx.example");
    stub("http://127.0.0.1:8080");
    expect(serviceOrigin()).toBe("http://127.0.0.1:8080");
  });

  it("REFUSES anything that is not a bare absolute http(s) origin", () => {
    for (const bad of [
      "//ailx.example",
      "ailx.example",
      "/v1",
      "javascript:alert(1)",
      "file:///etc/passwd",
      `${SERVICE}/v1`, // a PATH: the helpers append their own
      `${SERVICE}?x=1`,
      `${SERVICE}#frag`,
      "https://user:pw@ailx.example",
    ]) {
      stub(bad);
      expect(() => serviceOrigin(), bad).toThrow(/bare absolute http\(s\) origin/);
    }
  });
});

describe("the two path spaces stay apart", () => {
  it("apiRoot is /v1 — the versioned API the browser calls", () => {
    stub(SERVICE);
    expect(apiRoot()).toBe(`${SERVICE}/v1`);
  });

  it("siteRoot is /api — frozen inside issued share payloads, so it is NOT /v1", () => {
    stub(SERVICE);
    expect(siteRoot()).toBe(`${SERVICE}/api`);
    expect(siteRoot()).not.toContain("/v1");
  });

  it("both refuse when the variable is missing, rather than building a relative URL", () => {
    stub(undefined);
    expect(() => apiRoot()).toThrow();
    expect(() => siteRoot()).toThrow();
  });
});
