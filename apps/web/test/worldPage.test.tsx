// @vitest-environment jsdom
/**
 * /world — the public aggregates page.
 *
 * What is asserted here: the page publishes distributions and nothing
 * score-shaped, it says WHY a breakdown is missing instead of rendering an
 * empty chart, and the rendered markup contains no per-person value.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MIN_COHORT_SIZE, worldAggregates, type WorldAggregates } from "@ailx/report";
import type { TrackRawScores } from "@ailx/session";

const shapes = (n: number): TrackRawScores[] =>
  Array.from({ length: n }, (_, i) => ({
    t1: 10 + ((i * 9) % 90),
    t2: 90 - ((i * 7) % 80),
    t3: 40 + (i % 50),
    t4: 55 + (i % 30),
  }));

function aggregates(n: number): WorldAggregates {
  return worldAggregates({
    counts: { participants: n, attemptsStarted: n + 2, attemptsFinalized: n },
    shapes: shapes(n),
    exposure: {
      decksRecorded: n,
      distinctItems: 120,
      totalExposures: 480,
      meanExposuresPerItem: 4,
      maxExposuresPerItem: 9,
    },
    trend: [{ period: "2026-02-02", started: n + 2, finalized: n }],
  });
}

let payload: WorldAggregates;

vi.mock("../lib/server/api", () => ({
  withApiContext: async (fn: (ctx: unknown) => Promise<unknown>) => fn({ db: {} }),
}));
vi.mock("@ailx/backend", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("@ailx/backend");
  return {
    ...actual,
    handleWorldAggregates: async () => ({ status: 200, body: { aggregates: payload } }),
  };
});

const { default: WorldPage, metadata } = await import("../app/world/page.api");

const markup = async (): Promise<string> => renderToStaticMarkup(await WorldPage());

beforeEach(() => {
  payload = aggregates(40);
});

describe("what it publishes", () => {
  it("leads with participation counts and a completion rate", async () => {
    const html = await markup();
    expect(html).toContain("runs started");
    expect(html).toContain("completion rate");
    expect(html).toContain("95%"); // 40 finished of 42 started
  });

  it("renders a decile histogram per track, hand-rolled and labeled", async () => {
    const html = await markup();
    expect(html.match(/class="histogram"/g)).toHaveLength(4);
    expect(html).toMatch(/role="img" aria-label="[^"]*0 to 10: /);
    expect(html).not.toContain("<canvas");
  });

  it("renders the player-type distribution as a list with counts", async () => {
    const html = await markup();
    expect(html).toContain("type-bars");
    for (const t of payload.playerTypes!) expect(html).toContain(t.code);
  });

  it("summarizes item exposure without naming a single item", async () => {
    const html = await markup();
    expect(html).toContain("distinct items shown");
    expect(html).toContain("120");
    expect(html).not.toMatch(/item-[a-z0-9]/i);
  });

  it("shows the trend as a real table with a caption and row headers", async () => {
    const html = await markup();
    expect(html).toContain("<caption");
    expect(html).toContain('scope="row"');
    expect(html).toContain("2026-02-02");
  });
});

describe("what it refuses to publish", () => {
  it("never claims a percentile, composite or judged score", async () => {
    const html = (await markup()).toLowerCase();
    // The words appear once, in the disclaimer that we do NOT publish them.
    expect(html).toContain("no percentiles, no composites and no judged scores");
    expect(html.match(/percentile/g)).toHaveLength(1);
    expect(html.match(/composite/g)).toHaveLength(2); // the disclaimer + "the scored composite never reads it"
    expect(html).not.toMatch(/\d+(st|nd|rd|th) percentile/);
    expect(html).not.toMatch(/composite[^a-z]{0,3}\d/);
  });

  it("suppresses every breakdown below the cohort floor, and explains the rule", async () => {
    payload = aggregates(MIN_COHORT_SIZE - 1);
    const html = await markup();
    expect(html).toContain(`at least ${MIN_COHORT_SIZE} complete runs`);
    expect(html).not.toContain("class=\"histogram\"");
    expect(html).not.toContain("type-bars");
    // Population counts survive: they describe everyone, so they name nobody.
    expect(html).toContain("runs started");
  });

  it("renders an empty instrument without inventing numbers", async () => {
    payload = worldAggregates({
      counts: { participants: 0, attemptsStarted: 0, attemptsFinalized: 0 },
      shapes: [],
      exposure: { decksRecorded: 0, distinctItems: 0, totalExposures: 0, meanExposuresPerItem: 0, maxExposuresPerItem: 0 },
      trend: [],
    });
    const html = await markup();
    expect(html).toContain("—"); // completion rate with no runs
    expect(html).not.toContain("NaN");
  });

  it("emits no identifier in the served markup", async () => {
    const html = await markup();
    expect(html).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
    expect(html).not.toContain("dev:");
    expect(html).not.toContain("clerk:");
  });

  it("is a public, indexable page — it is the argument for the whole product", () => {
    expect(metadata.robots).toBeUndefined();
    expect(String(metadata.title)).toMatch(/world/i);
  });
});
