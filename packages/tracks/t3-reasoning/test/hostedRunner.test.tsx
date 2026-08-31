// @vitest-environment jsdom
/**
 * HOSTED T3: the sitting the SERVER owns.
 *
 * Every assertion here is negative in the same way the hosted T2 deck tests
 * are. A hosted sitting must be playable with NO plant list in the tab: no
 * `truth`, no trigger `topic`, no way to tell a planted error from a piece of
 * correct advice. If this file can be made to pass by handing the browser the
 * scenario, the custody split failed (CONTRACT §1, docs/ARCHITECTURE.md §4).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { TrackEvent } from "@ailx/core";
import { Runner } from "../src/Runner.js";
import { validateT3PresentationConfig } from "../src/plugin.js";
import { assistantReply } from "../src/assistant.js";
import type { T3CheckpointState } from "../src/checkpoint.js";
import type { T3Hosted, T3RevealedPlant, T3Turn } from "../src/types.js";
import { config as keyedConfig } from "./fixtures.js";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

/** Exactly what `GET /v1/attempts/:id/track/t3` serves during a sitting. */
const SITTING_VIEW = {
  phase: "sitting",
  title: "Trilateral AI workforce readiness memorandum",
  brief: "Advise the delegation lead: adopt the shared certification track in 2027?",
  sourceTitle: "Staff Review Draft",
  sourceExcerpt: "Section 3.2 — the median wait reached 38 months in 2025.",
  minWords: 120,
} as const;

const REF_A = "3f2b8c1d9e4a5b6c7d8e9f0a1b2c3d4e";
const REF_B = "aa11bb22cc33dd44ee55ff6600778899";

interface Bridge extends T3Hosted {
  calls: { prompt: string; promptSeq: number; regenNonce: number; seq: number }[];
  recorded: T3Turn[];
}

function bridge(
  over: {
    reply?: () => Promise<{ text: string; claimRefs: string[] }>;
    plants?: readonly T3RevealedPlant[] | null;
    revealError?: Error;
  } = {},
): Bridge {
  const calls: Bridge["calls"] = [];
  const recorded: T3Turn[] = [];
  return {
    calls,
    recorded,
    assist: async (req) => {
      calls.push({ ...req });
      return over.reply
        ? await over.reply()
        : { text: "The document supports two readings.", claimRefs: [REF_A, REF_B] };
    },
    record: (turn) => {
      recorded.push(turn);
    },
    reveal: async () => {
      if (over.revealError) throw over.revealError;
      return over.plants ?? null;
    },
  };
}

const hostedConfig = (h: T3Hosted) => ({ ...SITTING_VIEW, phase: undefined, hosted: h });

const workCheckpoint = (over: Partial<T3CheckpointState> = {}): T3CheckpointState => ({
  phase: "work",
  transcript: [],
  messages: [],
  draft: "",
  savedDraft: "",
  stances: {},
  seq: 0,
  promptSeq: 0,
  draftRev: 0,
  ...over,
});

let root: Root | null = null;
afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
});

async function mount(
  config: unknown,
  checkpoint: T3CheckpointState,
  onEvent: (e: TrackEvent) => void = () => {},
  onComplete: (a: unknown) => void = () => {},
): Promise<HTMLElement> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      createElement(Runner, {
        attemptId: "a-hosted",
        locale: "en" as const,
        config,
        onEvent,
        onComplete,
        secondsRemaining: 900,
        checkpoint,
        onCheckpoint: () => {},
      }),
    );
  });
  await settle();
  return container;
}

async function settle(): Promise<void> {
  for (let i = 0; i < 4; i++) await act(async () => { await Promise.resolve(); });
}

function byLabel(c: HTMLElement, label: string): HTMLElement {
  const el = [...c.querySelectorAll("button")].find((b) => b.textContent?.trim() === label);
  if (!el) throw new Error(`no control labelled ${label}`);
  return el;
}

async function prompt(c: HTMLElement, text: string): Promise<void> {
  const input = c.querySelector<HTMLInputElement>('input[aria-label="Prompt the assistant"]')!;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => {
    setter.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    byLabel(c, "Send").dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await settle();
}

describe("the hosted T3 config carries no answer key", () => {
  it("refuses a config that carries BOTH a hosted seam and a plant list", () => {
    expect(() =>
      validateT3PresentationConfig({ ...SITTING_VIEW, hosted: bridge(), plantedErrors: keyedConfig.plantedErrors }),
    ).toThrow(/may not carry plantedErrors/);
  });

  it("validates a sitting view that has no plants, no truths and no weights", () => {
    const cfg = validateT3PresentationConfig(hostedConfig(bridge()));
    expect(cfg.plantedErrors).toBeUndefined();
    expect(cfg.correctAdvice).toBeUndefined();
    expect(cfg.weights).toBeUndefined();
  });

  it("still demands the whole marking scheme through the SCORING door", async () => {
    const { validateT3Config } = await import("../src/plugin.js");
    expect(() => validateT3Config(hostedConfig(bridge()))).toThrow(/plantedErrors must be non-empty/);
  });
});

describe("a hosted T3 sitting", () => {
  it("takes every assistant reply from the server and never runs the local simulator", async () => {
    const b = bridge();
    const local = assistantReply(keyedConfig, "what about the backlog?", 1, new Set(), 0);
    const c = await mount(hostedConfig(b), workCheckpoint());
    await prompt(c, "what about the backlog?");

    expect(b.calls).toEqual([{ prompt: "what about the backlog?", promptSeq: 1, regenNonce: 0, seq: 1 }]);
    expect(c.textContent).toContain("The document supports two readings.");
    // The local simulator's wording never appears — it was never called.
    expect(c.textContent).not.toContain(local.text);
    // And nothing in the DOM names a plant, its truth or its trigger topic.
    for (const e of keyedConfig.plantedErrors) {
      expect(c.textContent).not.toContain(e.truth);
      expect(c.textContent).not.toContain(e.claim);
      expect(c.textContent).not.toContain(e.topic);
    }
  });

  it("attaches a stance to the opaque ref the server returned, and mirrors it", async () => {
    const b = bridge();
    const c = await mount(hostedConfig(b), workCheckpoint());
    await prompt(c, "summarise the backlog");
    const challenge = c.querySelector<HTMLButtonElement>(`[data-testid="stance-challenged-${REF_A}"]`);
    expect(challenge).not.toBeNull();
    await act(async () => { challenge!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });

    const mirrored = b.recorded.map((t) => `${t.verb} ${t.object}`);
    expect(mirrored).toContain(`challenged claim:${REF_A}`);
    expect(mirrored).toContain("prompted prompt:1");
    // The server writes its own `assisted` row and refuses a client that
    // claims one; this client never sends it.
    expect(b.recorded.some((t) => t.verb === "assisted")).toBe(false);
    // Every mirrored turn has its own transcript seq — the reply's seq was
    // reserved before the request left, so nothing collides with it.
    const seqs = b.recorded.map((t) => t.seq);
    expect(new Set(seqs).size).toBe(seqs.length);
    expect(seqs).not.toContain(b.calls[0].seq);
  });

  it("surfaces an assist failure and does NOT fall back to the local simulator", async () => {
    const b = bridge({ reply: () => Promise.reject(new Error("503 upstream")) });
    const c = await mount(hostedConfig(b), workCheckpoint());
    await prompt(c, "what about the backlog?");

    const err = c.querySelector('[data-testid="assist-error"]');
    expect(err?.textContent).toContain("503 upstream");
    expect(err?.getAttribute("role")).toBe("alert");
    // No assistant turn was invented locally: the chat holds the prompt only.
    expect(c.querySelectorAll('[id^="claim-"]').length).toBe(0);
    for (const e of keyedConfig.plantedErrors) expect(c.textContent).not.toContain(e.claim);
  });

  it("replays a failed request verbatim on retry, so a plant cannot be skipped", async () => {
    let fail = true;
    const b = bridge({
      reply: () =>
        fail
          ? Promise.reject(new Error("network down"))
          : Promise.resolve({ text: "replayed reply", claimRefs: [REF_A] }),
    });
    const c = await mount(hostedConfig(b), workCheckpoint());
    await prompt(c, "what about the backlog?");
    fail = false;
    await act(async () => {
      byLabel(c, "Retry").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await settle();
    expect(b.calls).toHaveLength(2);
    expect(b.calls[0]).toEqual(b.calls[1]);
    expect(c.textContent).toContain("replayed reply");
  });
});

describe("the hosted T3 reveal", () => {
  const submitted = workCheckpoint({
    phase: "reveal",
    draft: "a".repeat(10),
    savedDraft: "a".repeat(10),
    messages: [{ role: "assistant", text: "reply", claimIds: [REF_A], object: "assist:1" }],
  });

  it("reveals nothing while the attempt is still open", async () => {
    const c = await mount(hostedConfig(bridge({ plants: null })), submitted);
    expect(c.querySelector('[data-testid="t3-reveal-withheld"]')).not.toBeNull();
    expect(c.textContent).toContain("Your analysis is recorded");
    expect(c.textContent).not.toContain("planted errors");
    for (const e of keyedConfig.plantedErrors) expect(c.textContent).not.toContain(e.truth);
  });

  it("renders the plants the REVIEW view returned, once the server reveals them", async () => {
    const plants: T3RevealedPlant[] = [
      { ref: REF_A, claim: "the wait was 61 months", truth: "Section 3.2 says 38 months", surfaced: true, stance: "challenged" },
      { ref: REF_B, claim: "the bond had no effect", truth: "Section 4.1 credits the bond", surfaced: true, stance: "accepted" },
    ];
    const c = await mount(hostedConfig(bridge({ plants })), submitted);
    expect(c.textContent).toContain("You caught 1 of 2 planted errors");
    expect(c.textContent).toContain("Section 3.2 says 38 months");
    expect(c.querySelector('[data-testid="t3-reveal-withheld"]')).toBeNull();
  });

  it("says so when the reveal cannot be loaded, instead of inventing one", async () => {
    const c = await mount(hostedConfig(bridge({ revealError: new Error("offline") })), submitted);
    expect(c.textContent).toContain("offline");
    expect(c.textContent).not.toContain("You caught");
  });

  it("still finishes the track from the withheld screen", async () => {
    const done = vi.fn();
    const c = await mount(hostedConfig(bridge({ plants: null })), submitted, () => {}, done);
    await act(async () => {
      byLabel(c, "Continue →").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(done).toHaveBeenCalledTimes(1);
  });
});
