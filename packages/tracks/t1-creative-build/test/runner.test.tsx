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
});
