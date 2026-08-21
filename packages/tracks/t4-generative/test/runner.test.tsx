import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { Runner } from "../src/Runner.js";

const props = {
  attemptId: "a-1",
  locale: "en" as const,
  config: { maxGenerations: 4 },
  onEvent: () => {},
  onComplete: () => {},
  secondsRemaining: 3600,
};

describe("T4 Runner (SSR smoke)", () => {
  it("renders brief, quota counter, prompt box and empty gallery state", () => {
    const html = renderToStaticMarkup(createElement(Runner, props));
    expect(html).toContain("Target brief");
    expect(html).toContain("4 of 4 renders left");
    expect(html).toContain("aria-label=\"Image prompt\"");
    expect(html).toContain("demo simulator");
    expect(html).toContain("No renders yet");
    expect(html).toContain("60:00");
  });
});
