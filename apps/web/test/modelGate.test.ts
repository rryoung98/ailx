/**
 * THE PER-TRACK MODEL GATE (TEN-149).
 *
 * The defect this pins: the start gate was per-RUN. One `connected` boolean
 * decided whether a candidate could sit ANY of the four tracks, and two of
 * them need no model at all — so on staging, 2026-09-05, a signed-in
 * candidate with no model connected was refused the whole instrument,
 * including the two tracks that would have run unchanged.
 *
 * These are unit tests over the derivation. The page-level behaviour (Start
 * opens, the run offers exactly the model-free tracks, connecting mid-run
 * unlocks the rest) is in test/modelFreeRun.test.tsx.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TRACK_ORDER, type TrackId } from "@ailx/session";
import {
  lockedPendingTracks,
  lockedTrackCopy,
  MODEL_FREE_TRACKS,
  MODEL_TRACKS,
  needsModel,
  nextAvailableTrack,
  runGate,
  TRACK_NEEDS_MODEL,
} from "../lib/instrument/modelGate";
import { needsModel as registryNeedsModel } from "../lib/instrument/registry";

/** A projection stub: only the two fields the gate helpers read. */
function state(completed: readonly TrackId[]) {
  const tracks = {} as Record<TrackId, { status: string }>;
  for (const t of TRACK_ORDER) tracks[t] = { status: completed.includes(t) ? "completed" : "pending" };
  return { order: TRACK_ORDER, tracks };
}

describe("the declaration", () => {
  it("names T1 and T4 — and nothing else — as the tracks that need a model", () => {
    expect(TRACK_NEEDS_MODEL).toEqual({ t1: true, t2: false, t3: false, t4: true });
    expect([...MODEL_FREE_TRACKS]).toEqual(["t2", "t3"]);
    expect([...MODEL_TRACKS]).toEqual(["t1", "t4"]);
  });

  it("is the SAME declaration the registry exposes — one source, not two", () => {
    for (const t of TRACK_ORDER) expect(registryNeedsModel(t)).toBe(needsModel(t));
  });

  /**
   * The table is a claim about the runners, so it is checked against them.
   * A runner that takes `modelFetch` from the host makes model calls; one
   * that does not, cannot. If a future T3 grows a live assistant, this fails
   * here rather than stranding a candidate in a track that cannot run.
   */
  it("agrees with which runners actually read modelFetch", () => {
    const dirs: Record<TrackId, string> = {
      t1: "t1-creative-build",
      t2: "t2-discrimination",
      t3: "t3-reasoning",
      t4: "t4-generative",
    };
    for (const t of TRACK_ORDER) {
      const src = readFileSync(
        join(__dirname, "..", "..", "..", "packages", "tracks", dirs[t], "src", "Runner.tsx"),
        "utf8",
      );
      expect(src.includes("modelFetch"), `${t} Runner.tsx modelFetch`).toBe(needsModel(t));
    }
  });
});

describe("runGate", () => {
  it("with no model: the run starts, and offers exactly the model-free tracks", () => {
    const gate = runGate({ connected: false });
    expect(gate.canStart).toBe(true);
    expect([...gate.available]).toEqual(["t2", "t3"]);
    expect([...gate.locked]).toEqual(["t1", "t4"]);
    expect(gate.startLabel).toBe("Start your run");
  });

  it("with a model: all four tracks, and nothing to explain", () => {
    const gate = runGate({ connected: true });
    expect([...gate.available]).toEqual(["t1", "t2", "t3", "t4"]);
    expect(gate.locked).toHaveLength(0);
    expect(gate.startNote).toBeNull();
  });

  it("gates over the tracks IN THE RUN, not over the instrument", () => {
    const gate = runGate({ connected: false, order: ["t1", "t4"] });
    expect(gate.canStart).toBe(false);
    expect(gate.startLabel).toBe("Connect a model to start");
    expect(gate.startNote).toContain("Every track in this run needs a model");
  });

  it("says what is missing, why, and the one action — and never sells", () => {
    const gate = runGate({ connected: false });
    const copy = `${gate.startNote} ${gate.tracks.map((t) => t.reason ?? "").join(" ")}`;
    expect(copy).toContain("T1 and T4");
    expect(copy).toContain("runs on your model");
    expect(copy).toContain("Connect one above");
    expect(copy).toContain("mid-run is fine");
    // House rules: no game economy, and no pressure by counting what is held
    // back. progressPage.test.tsx pins the same absence on /progress.
    for (const banned of ["unlock", "premium", "upgrade", "missing out", "only 2 of"]) {
      expect(copy.toLowerCase()).not.toContain(banned);
    }
  });

  it("gives every locked track a reason and every available one none", () => {
    for (const t of runGate({ connected: false }).tracks) {
      expect(t.reason === undefined).toBe(t.available);
    }
    expect(lockedTrackCopy("t4")).toContain("T4");
    expect(lockedTrackCopy("t4")).toContain("image generation");
  });
});

describe("the run itself", () => {
  it("skips a locked track instead of hanging on it", () => {
    expect(nextAvailableTrack(state([]), false)).toBe("t2");
    expect(nextAvailableTrack(state(["t2"]), false)).toBe("t3");
  });

  it("ends the run when the LAST available track is finished", () => {
    // T1 and T4 are still pending and still locked. `nextTrack` from the
    // session engine would return t1 here and the run would hang on a Start
    // button that cannot open anything.
    expect(nextAvailableTrack(state(["t2", "t3"]), false)).toBeUndefined();
    expect(lockedPendingTracks(state(["t2", "t3"]), false)).toEqual(["t1", "t4"]);
  });

  it("connecting mid-run makes the locked tracks next, without restarting", () => {
    const midRun = state(["t2", "t3"]);
    expect(nextAvailableTrack(midRun, true)).toBe("t1");
    expect(lockedPendingTracks(midRun, true)).toEqual([]);
  });

  it("with a model, the run order is unchanged", () => {
    expect(nextAvailableTrack(state([]), true)).toBe("t1");
  });
});
