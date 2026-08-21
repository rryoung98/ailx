import { describe, it, expect } from "vitest";
import { runPure } from "@ailx/core";
import { itemId } from "@ailx/session";
import { validateT2Config } from "@ailx/track-t2";
import { validateT3Config } from "@ailx/track-t3";
import {
  SNAPSHOT, T3_SCENARIO, T3_SCENARIO_SHA256, snapshotRubricVersion,
  snapshotTrack, t2ExposureSeconds, t2Items, trackConfig,
} from "../lib/instrument";
import { canonicalJson, sha256Hex } from "@ailx/session";
import { judgeT1, judgeT3, judgeT4 } from "../lib/judging";
import {
  checkpointToArtifact, isValidArtifact, scoreTrack, scoreTrackArtifact,
} from "../lib/registry";

describe("instrument wiring (snapshot-derived, F3/F16)", () => {
  it("t2 bank adapts into a valid T2Config", () => {
    const cfg = validateT2Config(trackConfig("t2"));
    expect(cfg.items.length).toBeGreaterThanOrEqual(10);
    for (const i of cfg.items) {
      expect(i.id).toMatch(/^[0-9a-f]{64}$/);
      expect(i.key).toBeGreaterThanOrEqual(0);
    }
  });

  it("t2 deck mixes binary and provenance items", () => {
    const items = t2Items("en");
    expect(items.some((i) => i.type === "provenance")).toBe(true);
    expect(items.some((i) => i.type !== "provenance")).toBe(true);
  });

  it("image item material is a data: image URI, not JSON text (F3)", () => {
    const images = t2Items("en").filter((i) => i.type === "media-image");
    expect(images.length).toBeGreaterThan(0);
    for (const i of images) {
      expect(i.material.startsWith("data:image")).toBe(true);
    }
  });

  it("maps per-item exposure seconds from the snapshot config blocks (F3)", () => {
    const exposure = t2ExposureSeconds();
    expect(exposure["media-image"]).toBe(6);
    expect(exposure["media-video"]).toBe(12);
    expect(exposure["media-audio"]).toBe(10);
    expect(exposure["message-email"]).toBe(25);
    expect(exposure["message-page"]).toBe(25);
    expect(exposure["provenance"]).toBeUndefined(); // untimed
    for (const i of t2Items("en")) {
      if (i.type === "provenance") {
        expect(i.exposureSeconds).toBeUndefined();
      } else {
        expect(i.exposureSeconds).toBe(exposure[i.type]);
      }
    }
  });

  it("marks the SIGNAL option (synthetic/hostile/ai) for binary items", () => {
    for (const i of t2Items("en")) {
      if (i.type === "provenance") continue;
      expect(i.signal).toBeGreaterThanOrEqual(0);
      expect(["AI-generated text", "Synthetic (AI-generated)", "Hostile / manipulative", i.options[i.signal!]].length).toBeGreaterThan(0);
      // the signal option is never the same slot semantics as arbitrary
      expect(i.signal).toBeLessThan(i.options.length);
    }
  });

  it("bank item ids are content addresses: id = sha256(canonical_json(item-sans-id))", () => {
    const bank = snapshotTrack("t2").bank!;
    for (const item of bank.items) {
      const { id, ...rest } = item as Record<string, unknown> & { id: string };
      expect(itemId(rest)).toBe(id);
    }
  });

  it("t3 scenario validates and matches its pinned content hash (F16)", () => {
    const cfg = validateT3Config(trackConfig("t3"));
    expect(cfg.plantedErrors.length).toBe(3);
    expect(sha256Hex(canonicalJson(T3_SCENARIO))).toBe(T3_SCENARIO_SHA256);
  });

  it("per-track rubricVersion comes from the committed snapshot (F12)", () => {
    for (const t of ["t1", "t2", "t3", "t4"] as const) {
      expect(snapshotRubricVersion(t)).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(SNAPSHOT.format).toBe("ailx-instrument-snapshot@1");
  });
});

describe("real plugin scoring (F1: no fallback, fail closed)", () => {
  const t1Artifact = {
    html: "<html><style>h1{color:red}</style><header><h1>Hi</h1></header><main><section>x</section></main></html>",
    promptLog: [{ kind: "prompted" }, { kind: "revised" }],
    selfReport: "I aimed for a clean landing structure with semantic landmarks and contrast.",
  };
  const artifacts: Record<string, unknown> = {
    t1: t1Artifact,
    t2: { responses: t2Items("en").map((i, idx) => ({ itemId: i.id, choice: idx % 2 === 0 ? i.key : (i.key + 1) % i.options.length, confidence: 70, latencyMs: 1200 })) },
    t3: { transcript: [{ seq: 0, clientTs: "t", verb: "prompted", object: "prompt:1", text: "x" }], finalAnswer: "word ".repeat(140) },
    t4: { generations: [{ prompt: "red fox" }, { prompt: "a red fox at dawn, watercolor, wide composition" }], chosenIndex: 1, note: "The dawn palette communicates warmth for the brief audience." },
  };

  it("judgments are deterministic and normalized to [0,1]", () => {
    expect(judgeT1(t1Artifact)).toEqual(judgeT1(t1Artifact));
    const t3a = { transcript: [], finalAnswer: "word ".repeat(150) };
    expect(judgeT3(t3a)).toEqual(judgeT3(t3a));
    const t4a = { generations: [{ prompt: "a red fox at dawn, watercolor, wide" }], chosenIndex: 0, note: "note" };
    expect(judgeT4(t4a)).toEqual(judgeT4(t4a));
    for (const j of [...judgeT1(t1Artifact), ...judgeT3(t3a), ...judgeT4(t4a)]) {
      expect(j.value).toBeGreaterThanOrEqual(0);
      expect(j.value).toBeLessThanOrEqual(1);
    }
  });

  it("scoreTrack is pure and reproducible for every track", () => {
    for (const t of ["t1", "t2", "t3", "t4"] as const) {
      const a = runPure(() => scoreTrack(t, artifacts[t]));
      const b = runPure(() => scoreTrack(t, artifacts[t]));
      expect(a).toEqual(b);
      expect(a.score.scaled).toBeGreaterThan(0);
      expect(a.score.scaled).toBeLessThanOrEqual(100);
      expect(a.rubricVersion).toBe(snapshotRubricVersion(t));
      expect(a.scoringDigest).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("malformed artifacts FAIL CLOSED: scaled 0 with raw {invalid: 1} (F1)", () => {
    const malformed: unknown[] = [
      { timedOut: true },                      // the old timeout sentinel
      { demo: true, trackId: "t1" },           // the old demo shape
      null, undefined, 42, "html", [],
    ];
    for (const t of ["t1", "t2", "t3", "t4"] as const) {
      for (const m of malformed) {
        expect(isValidArtifact(t, m)).toBe(false);
        const s = scoreTrackArtifact(t, m);
        expect(s.scaled).toBe(0);
        expect(s.raw).toEqual({ invalid: 1 });
      }
    }
  });

  it("empty checkpoints score through the plugins' own missing-response paths", () => {
    for (const t of ["t1", "t2", "t3", "t4"] as const) {
      const artifact = checkpointToArtifact(t, undefined);
      expect(isValidArtifact(t, artifact)).toBe(true);
      const s = scoreTrack(t, artifact);
      // NEVER the invalid sentinel and NEVER seeded pseudo-points: the
      // score is exactly what the plugin assigns its empty artifact.
      expect(s.score.raw.invalid).toBeUndefined();
      expect(s.score).toEqual(scoreTrack(t, artifact).score); // deterministic
    }
    // Judged tracks: zeroed demo judgments → a legitimate zero.
    for (const t of ["t1", "t3", "t4"] as const) {
      expect(scoreTrack(t, checkpointToArtifact(t, undefined)).score.scaled).toBe(0);
    }
    // T2: the all-lapsed deck follows the track's declared missing-response
    // rule (identical to submitting an empty response set explicitly).
    const lapsedAll = scoreTrack("t2", checkpointToArtifact("t2", undefined));
    expect(lapsedAll.score).toEqual(scoreTrack("t2", { responses: [] }).score);
  });

  it("a partial T2 checkpoint scores the answered items and lapses the rest", () => {
    const items = t2Items("en");
    const answered = items.slice(0, 3).map((i) => ({
      itemId: i.id, choice: i.key, confidence: 60, latencyMs: 900,
    }));
    const partial = checkpointToArtifact("t2", { responses: answered });
    const s = scoreTrack("t2", partial);
    expect(s.score.raw.invalid).toBeUndefined();
    const full = scoreTrack("t2", {
      responses: items.map((i) => ({ itemId: i.id, choice: i.key, confidence: 60, latencyMs: 900 })),
    });
    // Answering everything correctly must beat the 3-item partial.
    expect(full.score.scaled).toBeGreaterThan(s.score.scaled);
  });

  it("checkpointToArtifact tolerates old and new checkpoint field shapes", () => {
    // nested-artifact shape
    const nested = checkpointToArtifact("t3", { artifact: { transcript: [], finalAnswer: "done." } });
    expect((nested as { finalAnswer: string }).finalAnswer).toBe("done.");
    // draft-only shape (older runner naming)
    const draft = checkpointToArtifact("t3", { transcript: [], draft: "wip" });
    expect((draft as { finalAnswer: string }).finalAnswer).toBe("wip");
    // extra unknown fields survive (new T4 shapes)
    const t4 = checkpointToArtifact("t4", { generations: [], note: "n", chosenIndex: 0, finals: [1, 2, 3] });
    expect((t4 as { finals: number[] }).finals).toEqual([1, 2, 3]);
  });
});
