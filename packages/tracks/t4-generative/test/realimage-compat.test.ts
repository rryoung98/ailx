import { describe, expect, it } from "vitest";
import { decodeT4Checkpoint, encodeT4Checkpoint } from "../src/checkpoint.js";
import { t4Plugin } from "../src/plugin.js";
import {
  draftImageSrc,
  finalImageSrc,
  simulateVideoFromImage,
} from "../src/imageModel.js";
import type { TrackCtx, Upload } from "@ailx/core";

const PNG_URI = "data:image/png;base64,aGVsbG8=";
const ctx = { attemptId: "a1", nowIso: () => "t" } as unknown as TrackCtx;

/** Checkpoint shape written by the pre-realimage runner (svg-only). */
const legacyCheckpoint = {
  drafts: [{ index: 0, prompt: "p0", svg: "<svg/>", clientTs: "t0" }],
  finals: {
    images: [
      { kind: "image", fromDraftIndex: 0, prompt: "p0", asset: "<svg/>", clientTs: "t1" },
    ],
  },
  chosenSet: [0],
  note: "n",
  disclosed: true,
};

describe("t4 real-image backward compatibility — checkpoints", () => {
  it("decodes legacy svg-only checkpoints unchanged", () => {
    const out = decodeT4Checkpoint(legacyCheckpoint);
    expect(out).not.toBeNull();
    expect(out!.drafts[0].svg).toBe("<svg/>");
    expect(out!.drafts[0].dataUri).toBeUndefined();
    expect(out!.finals.images[0].asset).toBe("<svg/>");
  });

  it("round-trips real-model drafts/finals (dataUri + modelId)", () => {
    const state = {
      drafts: [
        { index: 0, prompt: "p0", svg: "<svg/>", modelId: "demo-image@1", clientTs: "t0" },
        { index: 1, prompt: "p1", dataUri: PNG_URI, modelId: "google/gemini-3-pro-image", clientTs: "t1" },
      ],
      finals: {
        images: [
          {
            kind: "image" as const,
            fromDraftIndex: 1,
            prompt: "p1",
            dataUri: PNG_URI,
            modelId: "google/gemini-3-pro-image",
            clientTs: "t2",
          },
        ],
      },
      chosenSet: [0],
      note: "n",
      disclosed: true,
      submitted: false,
    };
    const out = decodeT4Checkpoint(JSON.parse(JSON.stringify(encodeT4Checkpoint(state))));
    expect(out).not.toBeNull();
    expect(out!.drafts[1].dataUri).toBe(PNG_URI);
    expect(out!.drafts[1].modelId).toBe("google/gemini-3-pro-image");
    expect(out!.finals.images[0].dataUri).toBe(PNG_URI);
    expect(out!.finals.images[0].asset).toBeUndefined();
  });

  it("rejects a draft that carries NEITHER svg nor dataUri", () => {
    const bad = {
      ...legacyCheckpoint,
      drafts: [{ index: 0, prompt: "p0", clientTs: "t0" }],
    };
    expect(decodeT4Checkpoint(bad)).toBeNull();
  });
});

describe("t4 real-image backward compatibility — plugin ingest", () => {
  const session = { attemptId: "a1", trackId: "t4-generative" };

  it("still accepts the legacy svg-only artifact shape", async () => {
    const payload = { json: legacyCheckpoint } as unknown as Upload;
    const art = await t4Plugin.ingest(ctx, session, payload);
    expect(art.drafts[0].svg).toBe("<svg/>");
    expect(art.finals.images[0].asset).toBe("<svg/>");
  });

  it("accepts real-model drafts and finals and preserves the model id", async () => {
    const payload = {
      json: {
        drafts: [
          { index: 0, prompt: "p0", dataUri: PNG_URI, modelId: "openai/gpt-5-image-mini", clientTs: "t0" },
        ],
        finals: {
          images: [
            {
              kind: "image",
              fromDraftIndex: 0,
              prompt: "p0",
              dataUri: PNG_URI,
              modelId: "openai/gpt-5-image-mini",
              clientTs: "t1",
            },
          ],
        },
        chosenSet: [0],
        note: "n",
        disclosed: true,
      },
    } as unknown as Upload;
    const art = await t4Plugin.ingest(ctx, session, payload);
    expect(art.drafts[0].dataUri).toBe(PNG_URI);
    expect(art.drafts[0].modelId).toBe("openai/gpt-5-image-mini");
    expect(art.finals.images[0].dataUri).toBe(PNG_URI);
    expect(art.finals.images[0].modelId).toBe("openai/gpt-5-image-mini");
  });

  it("rejects a draft with neither render field", async () => {
    const payload = {
      json: { ...legacyCheckpoint, drafts: [{ index: 0, prompt: "p", clientTs: "t" }] },
    } as unknown as Upload;
    await expect(t4Plugin.ingest(ctx, session, payload)).rejects.toThrow(/draft 0 malformed/);
  });
});

describe("t4 real-image display + simulated video helpers", () => {
  it("prefers the real dataUri over the svg render", () => {
    expect(draftImageSrc({ dataUri: PNG_URI, svg: "<svg/>" })).toBe(PNG_URI);
    expect(draftImageSrc({ svg: "<svg/>" })).toContain("data:image/svg+xml");
    expect(finalImageSrc({ dataUri: PNG_URI })).toBe(PNG_URI);
    expect(finalImageSrc({ asset: "<svg/>" })).toContain("data:image/svg+xml");
  });

  it("wraps a real image into a labeled simulated-video SVG", () => {
    const v = simulateVideoFromImage(PNG_URI);
    expect(v).toContain(`<image href="${PNG_URI}"`);
    expect(v).toContain("VIDEO · simulated");
    expect(v.endsWith("</svg>")).toBe(true);
  });
});
