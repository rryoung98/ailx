/**
 * `lib/server/page.ts` — the two things a server COMPONENT still needs.
 *
 * Only `generateMetadata` uses them, and only because a social or HR scraper
 * never runs client code: the share card and the credential tab title have to
 * be built from a real read, on the server, where a relative `/api` is not a
 * URL `fetch` can resolve.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const SERVICE = "https://ailx-backend.example";

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ host: "reached.example" }),
}));

const { pageOrigin, serverApiBase } = await import("../lib/server/page");

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_BASE_PATH", "");
});
afterEach(() => vi.unstubAllEnvs());

describe("pageOrigin", () => {
  it("prefers the configured public origin over anything a request claims", async () => {
    vi.stubEnv("AILX_PUBLIC_ORIGIN", "https://ailx.example");
    expect(await pageOrigin()).toBe("https://ailx.example");
  });
});

describe("serverApiBase", () => {
  it("makes the same-origin base absolute, basePath included", async () => {
    vi.stubEnv("AILX_PUBLIC_ORIGIN", "https://ailx.example");
    vi.stubEnv("NEXT_PUBLIC_BASE_PATH", "/ailx");
    expect(await serverApiBase()).toBe("https://ailx.example/ailx/api");
  });

  it("leaves the exam service's own base alone — it is already absolute", async () => {
    vi.stubEnv("AILX_PUBLIC_ORIGIN", "https://ailx.example");
    vi.stubEnv("NEXT_PUBLIC_AILX_API_BASE", SERVICE);
    expect(await serverApiBase()).toBe(`${SERVICE}/v1`);
  });

  it("ignores basePath entirely once the seam points elsewhere", async () => {
    vi.stubEnv("AILX_PUBLIC_ORIGIN", "https://ailx.example");
    vi.stubEnv("NEXT_PUBLIC_BASE_PATH", "/ailx");
    vi.stubEnv("NEXT_PUBLIC_AILX_API_BASE", SERVICE);
    expect(await serverApiBase()).toBe(`${SERVICE}/v1`);
  });
});
