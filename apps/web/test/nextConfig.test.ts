/**
 * Dual-mode build config: the default build must stay a static export (the
 * GitHub Pages showcase), and AILX_BACKEND=1 must switch to a server build
 * that recognises `route.api.ts` route handlers.
 */
import { afterEach, describe, expect, it } from "vitest";

const saved = {
  AILX_BACKEND: process.env.AILX_BACKEND,
  NEXT_PUBLIC_BASE_PATH: process.env.NEXT_PUBLIC_BASE_PATH,
};

let bust = 0;
async function loadConfig(env: Record<string, string | undefined>) {
  delete process.env.AILX_BACKEND;
  delete process.env.NEXT_PUBLIC_BASE_PATH;
  Object.assign(process.env, env);
  const url = new URL("../next.config.mjs", import.meta.url).href;
  const mod = await import(`${url}?bust=${bust++}`);
  return mod.default as Record<string, unknown>;
}

afterEach(() => {
  delete process.env.AILX_BACKEND;
  delete process.env.NEXT_PUBLIC_BASE_PATH;
  for (const [k, v] of Object.entries(saved)) if (v !== undefined) process.env[k] = v;
});

describe("next.config.mjs", () => {
  it("defaults to the static GitHub Pages export", async () => {
    const cfg = await loadConfig({});
    expect(cfg.output).toBe("export");
    expect(cfg.pageExtensions).toBeUndefined(); // route.api.ts stays inert
    expect(cfg.basePath).toBe("/ailx");
    expect((cfg.env as Record<string, string>).NEXT_PUBLIC_AILX_BACKEND).toBe("");
  });

  it("AILX_BACKEND=1 switches to a server build with API route handlers", async () => {
    const cfg = await loadConfig({ AILX_BACKEND: "1" });
    expect(cfg.output).toBeUndefined();
    expect(cfg.pageExtensions).toContain("api.ts");
    expect((cfg.pageExtensions as string[])[0]).toBe("api.ts"); // must win over "ts"
    expect(cfg.basePath).toBe("");
    expect((cfg.env as Record<string, string>).NEXT_PUBLIC_AILX_BACKEND).toBe("1");
  });

  it("any other AILX_BACKEND value stays static (opt-in is exact)", async () => {
    const cfg = await loadConfig({ AILX_BACKEND: "true" });
    expect(cfg.output).toBe("export");
  });

  it("respects an explicit NEXT_PUBLIC_BASE_PATH in both modes", async () => {
    expect((await loadConfig({ NEXT_PUBLIC_BASE_PATH: "/x" })).basePath).toBe("/x");
    expect((await loadConfig({ AILX_BACKEND: "1", NEXT_PUBLIC_BASE_PATH: "/y" })).basePath).toBe("/y");
  });
});
