import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { Runner } from "../src/Runner.js";

const props = {
  attemptId: "a-1",
  locale: "en" as const,
  config: {},
  onEvent: () => {},
  onComplete: () => {},
  secondsRemaining: 1234,
};

describe("T1 Runner (SSR smoke)", () => {
  it("renders brief, editor, sandboxed preview and demo assist", () => {
    const html = renderToStaticMarkup(createElement(Runner, props));
    expect(html).toContain("Brief");
    expect(html).toContain("aria-label=\"HTML editor\"");
    expect(html).toContain("sandbox=\"allow-scripts\"");
    expect(html).not.toContain("allow-same-origin");
    expect(html).toContain("Content-Security-Policy");
    expect(html).toContain("demo simulator");
    expect(html).toContain("20:34"); // secondsRemaining formatted
  });
  it("keeps the runner uncluttered: no key inputs, just the start-screen hint (SSR default)", () => {
    const html = renderToStaticMarkup(createElement(Runner, props));
    // Connection moved to the run start screen — the runner carries no
    // key/base inputs of its own, only a pointer plus the model selects.
    expect(html).not.toContain("aria-label=\"OpenRouter API key\"");
    expect(html).not.toContain("aria-label=\"API base URL\"");
    expect(html).toContain("aria-label=\"Assist model\"");
    expect(html).toContain("aria-label=\"Custom model override\"");
    expect(html).toContain("No model is connected");
    expect(html).not.toMatch(/sk-or-/);
  });
});
