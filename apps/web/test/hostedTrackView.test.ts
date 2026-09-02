// @vitest-environment jsdom
/**
 * The HOSTED TRACK FORM: what the browser presents for T3 and T4 when the
 * server dealt the scenario (`GET /api/attempts/:id/track/:trackId`).
 *
 * Every assertion is negative, the same way `hostedDeck.test.ts` is negative
 * about keys. A hosted T3 sitting must be presentable with NO plant list, no
 * `truth` and no trigger `topic` — and a server that sent one anyway must not
 * be able to put it in the Runner's config (CONTRACT §1, §3).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fetchHostedTrackConfig,
  hostedT3Bridge,
  t3ConfigFromView,
  t4ConfigFromView,
} from "../lib/instrument/hostedDeck";
import { syncKey } from "../lib/data/persistence";

const SITTING_T3 = {
  title: "Trilateral AI workforce readiness memorandum",
  brief: "Advise the delegation lead.",
  sourceTitle: "Staff Review Draft",
  sourceExcerpt: "Section 3.2 — the median wait reached 38 months in 2025.",
  minWords: 120,
};

const SITTING_T4 = {
  brief: "Produce a visual set the viewer reads as resilience.",
  audience: "Summit delegates seeing the gallery without a caption.",
  finalImageQuota: 3,
  finalVideoQuota: 1,
  noteMaxChars: 1200,
};

const REF = "3f2b8c1d9e4a5b6c7d8e9f0a1b2c3d4e";

const noopBridge = { assist: async () => ({ text: "", claimRefs: [] }), record: () => {}, reveal: async () => null };

describe("t3ConfigFromView", () => {
  it("presents the five sitting fields and nothing else", () => {
    const cfg = t3ConfigFromView({ ...SITTING_T3 }, noopBridge);
    expect(cfg.title).toBe(SITTING_T3.title);
    expect(cfg.minWords).toBe(120);
    expect(cfg.plantedErrors).toBeUndefined();
    expect(cfg.correctAdvice).toBeUndefined();
    expect(cfg.weights).toBeUndefined();
    expect(typeof cfg.hosted?.assist).toBe("function");
  });

  it("drops a plant list a server should never have sent, rather than forwarding it", () => {
    const cfg = t3ConfigFromView(
      {
        ...SITTING_T3,
        plantedErrors: [{ id: "pe-1", topic: "backlog", claim: "61 months", truth: "the source says otherwise" }],
        rubric: { version: "r1", criteria: [] },
      },
      noopBridge,
    );
    expect(JSON.stringify(cfg)).not.toContain("61 months");
    expect(JSON.stringify(cfg)).not.toContain("the source says otherwise");
    expect(cfg).not.toHaveProperty("rubric");
  });

  it("refuses a view with no scenario instead of mounting an empty track", () => {
    expect(() => t3ConfigFromView({ ...SITTING_T3, brief: "" }, noopBridge)).toThrow(/T3 brief/);
  });
});

describe("t4ConfigFromView", () => {
  it("takes the brief, audience and quotas the server dealt", () => {
    expect(t4ConfigFromView({ ...SITTING_T4, rubric: { version: "r1", criteria: [] } })).toEqual(SITTING_T4);
  });

  it("refuses a view with no brief", () => {
    expect(() => t4ConfigFromView({ ...SITTING_T4, brief: undefined })).toThrow(/T4 brief/);
  });
});

/** jsdom in this repo runs without a real Storage; every suite shims one. */
function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: () => null,
    get length() {
      return map.size;
    },
  } as Storage;
}

const ID = "00000000-0000-4000-8000-0000000000fa";

describe("fetchHostedTrackConfig", () => {
  let calls: { url: string; init?: RequestInit }[] = [];

  const serve = (body: unknown) => {
    vi.spyOn(window, "fetch").mockImplementation((async (url: unknown, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return { ok: true, status: 200, json: async () => body };
    }) as unknown as typeof fetch);
  };

  beforeEach(() => {
    calls = [];
    Object.defineProperty(window, "localStorage", { value: memoryStorage(), configurable: true });
    vi.stubEnv("NEXT_PUBLIC_AILX_BACKEND", "1");
    window.localStorage.setItem(
      syncKey(ID),
      JSON.stringify({ serverAttemptId: ID, syncedThrough: 0, finalized: false }),
    );
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("keeps the STATIC demo on its bundled scenario for every track", async () => {
    vi.stubEnv("NEXT_PUBLIC_AILX_BACKEND", "");
    for (const t of ["t1", "t2", "t3", "t4"] as const) {
      await expect(fetchHostedTrackConfig("att-local", t)).resolves.toBeNull();
    }
    expect(calls).toHaveLength(0);
  });

  it("never asks the server for T1 — that brief is public by design", async () => {
    serve({ phase: "sitting", released: false, view: SITTING_T3 });
    await expect(fetchHostedTrackConfig(ID, "t1")).resolves.toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("fetches the T3 form and hands the Runner no plant list", async () => {
    serve({ phase: "sitting", released: false, view: SITTING_T3 });
    const cfg = (await fetchHostedTrackConfig(ID, "t3")) as Record<string, unknown>;
    expect(calls[0].url).toContain(`/attempts/${ID}/track/t3`);
    expect(cfg.plantedErrors).toBeUndefined();
    expect(cfg.title).toBe(SITTING_T3.title);
  });

  it("fetches the T4 form", async () => {
    serve({ phase: "sitting", released: false, view: SITTING_T4 });
    await expect(fetchHostedTrackConfig(ID, "t4")).resolves.toEqual(SITTING_T4);
    expect(calls[0].url).toContain(`/attempts/${ID}/track/t4`);
  });

  it("fails loudly when the server sends no view, rather than falling back", async () => {
    serve({ phase: "sitting", released: false });
    await expect(fetchHostedTrackConfig(ID, "t3")).rejects.toThrow(/no view/);
  });
});

describe("hostedT3Bridge", () => {
  let calls: { url: string; body: Record<string, unknown> | undefined }[] = [];

  const serve = (route: (url: string) => unknown) => {
    vi.spyOn(window, "fetch").mockImplementation((async (url: unknown, init?: RequestInit) => {
      calls.push({
        url: String(url),
        body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
      });
      return { ok: true, status: 200, json: async () => route(String(url)) };
    }) as unknown as typeof fetch);
  };

  beforeEach(() => {
    calls = [];
    Object.defineProperty(window, "localStorage", { value: memoryStorage(), configurable: true });
    vi.stubEnv("NEXT_PUBLIC_AILX_BACKEND", "1");
    window.localStorage.setItem(
      syncKey(ID),
      JSON.stringify({ serverAttemptId: ID, syncedThrough: 0, finalized: false }),
    );
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("asks the server for each reply, claims named only by ref", async () => {
    serve(() => ({ text: "server reply", claimRefs: [REF], seq: 3 }));
    const reply = await hostedT3Bridge(ID).assist({ prompt: "why?", promptSeq: 1, regenNonce: 0, seq: 3 });
    expect(reply).toEqual({ text: "server reply", claimRefs: [REF] });
    expect(calls[0].url).toContain(`/attempts/${ID}/t3/assist`);
    expect(calls[0].body).toMatchObject({ prompt: "why?", promptSeq: 1, regenNonce: 0, seq: 3 });
  });

  it("mirrors a client turn as a transcript row the server will accept", async () => {
    serve(() => ({ transcript: { created: true } }));
    hostedT3Bridge(ID).record({
      seq: 4,
      verb: "challenged",
      object: `claim:${REF}`,
      claimIds: [REF],
      clientTs: "2026-01-01T00:00:00.000Z",
    });
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].url).toContain(`/attempts/${ID}/transcripts`);
    expect(calls[0].body).toMatchObject({
      trackId: "t3",
      seq: 4,
      verb: "challenged",
      body: { object: `claim:${REF}`, claimRefs: [REF] },
    });
  });

  it("reveals nothing while the attempt is a SITTING", async () => {
    serve(() => ({ phase: "sitting", released: false, view: SITTING_T3 }));
    await expect(hostedT3Bridge(ID).reveal()).resolves.toBeNull();
  });

  it("returns the plants the REVIEW view carries", async () => {
    serve(() => ({
      phase: "review",
      released: false,
      view: {
        ...SITTING_T3,
        phase: "review",
        plants: [
          { ref: REF, claim: "61 months", truth: "38 months", surfaced: true, stance: "challenged" },
          { ref: "bad-row" },
        ],
        rubric: { version: "r1", criteria: [] },
      },
    }));
    await expect(hostedT3Bridge(ID).reveal()).resolves.toEqual([
      { ref: REF, claim: "61 months", truth: "38 months", surfaced: true, stance: "challenged" },
    ]);
  });
});
