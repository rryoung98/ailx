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
  secondsRemaining: 3600,
};

describe("T4 Runner (SSR smoke)", () => {
  it("renders brief, final quota counters, prompt box and empty states (F9)", () => {
    const html = renderToStaticMarkup(createElement(Runner, props));
    expect(html).toContain("Target brief");
    expect(html).toContain("3 of 3 image renders left");
    expect(html).toContain("1 of 1 video renders left");
    expect(html).toContain("Generate draft (unlimited)");
    expect(html).toContain("aria-label=\"Image prompt\"");
    expect(html).toContain("demo simulator");
    expect(html).toContain("No drafts yet");
    // The disclosure checkbox moved into the finish step with the note it
    // belongs to; the resting workspace shows the step's entry points.
    expect(html).not.toContain("disclosure statement");
    expect(html).toContain("Direction note");
    expect(html).toContain("60:00");
  });
});
