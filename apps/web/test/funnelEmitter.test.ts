// @vitest-environment jsdom
/**
 * The funnel emitter (lib/funnel.ts), driven through injected deps so the
 * clock, the stores, the id source and the sink are all fixtures.
 *
 * The properties under test are the four the module promises: silence with no
 * backend, batching, one count per step, and never throwing into a caller.
 * The awkward cases the KPI issue named are here by name — a reload mid-play,
 * two plays in one day, and a share link opened by a browser with no history.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseFunnelBatch, type FunnelEvent } from "@ailx/contract";
import {
  createFunnel,
  FUNNEL_CLIENT_KEY,
  FUNNEL_CLIENT_ROTATION_DAYS,
  FUNNEL_FLUSH_MS,
  FUNNEL_PLAY_RESUME_MS,
  FUNNEL_SESSION_KEY,
  type Funnel,
  type FunnelDeps,
} from "../lib/funnel";

/** A store that can be told to fail, because real ones do. */
function store(broken = false) {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k: string) => {
      if (broken) throw new Error("storage is disabled");
      return map.get(k) ?? null;
    },
    setItem: (k: string, v: string) => {
      if (broken) throw new Error("storage is disabled");
      map.set(k, v);
    },
    removeItem: (k: string) => void map.delete(k),
  };
}

const NOON = Date.parse("2026-03-17T12:00:00.000Z");

/**
 * Ids, counted across every harness in a test: a "reload" builds a second
 * emitter over the same stores, and a per-harness counter would hand it the
 * same ids and hide a real id collision.
 */
let minted = 0;
const uuid = (): string => {
  minted += 1;
  return `00000000-0000-4000-8000-${String(minted).padStart(12, "0")}`;
};

interface Harness {
  funnel: Funnel;
  sent: { url: string; body: string }[];
  local: ReturnType<typeof store>;
  session: ReturnType<typeof store>;
  now: { value: number };
  events: () => FunnelEvent[];
}

function harness(over: Partial<FunnelDeps> = {}, shared?: Partial<Harness>): Harness {
  const local = (shared?.local ?? store()) as ReturnType<typeof store>;
  const session = (shared?.session ?? store()) as ReturnType<typeof store>;
  const now = shared?.now ?? { value: NOON };
  const sent: { url: string; body: string }[] = shared?.sent ?? [];
  const funnel = createFunnel({
    local,
    session,
    now: () => now.value,
    monotonic: () => 42,
    tzOffsetMinutes: () => 0,
    uuid,
    send: (url, body) => void sent.push({ url, body }),
    endpoint: () => "https://api.example/v1/events",
    ...over,
  });
  return {
    funnel,
    sent,
    local,
    session,
    now,
    events: () => sent.flatMap((s) => parseFunnelBatch(JSON.parse(s.body)) ?? []),
  };
}

beforeEach(() => {
  minted = 0;
  vi.useFakeTimers();
});

describe("silence with no backend", () => {
  it("sends nothing, mints no id and writes no storage", () => {
    const h = harness({ endpoint: () => null });
    h.funnel.step("landing_viewed");
    h.funnel.playStarted("practice");
    h.funnel.playCompleted("practice", 8);
    vi.advanceTimersByTime(FUNNEL_FLUSH_MS * 2);
    expect(h.sent).toEqual([]);
    expect(h.local.map.size).toBe(0);
    expect(h.session.map.size).toBe(0);
  });
});

describe("batching", () => {
  it("holds events and sends them in ONE post after the flush delay", () => {
    const h = harness();
    h.funnel.step("landing_viewed");
    h.funnel.step("signed_in");
    expect(h.sent).toEqual([]);
    expect(h.funnel.pending()).toBe(3); // visit_started, landing_viewed, signed_in
    vi.advanceTimersByTime(FUNNEL_FLUSH_MS);
    expect(h.sent).toHaveLength(1);
    expect(h.events().map((e) => e.step)).toEqual([
      "visit_started",
      "landing_viewed",
      "signed_in",
    ]);
  });

  it("posts to the frozen path and sends a body the schema accepts", () => {
    const h = harness();
    h.funnel.step("landing_viewed");
    h.funnel.flush();
    expect(h.sent[0]!.url).toBe("https://api.example/v1/events");
    expect(parseFunnelBatch(JSON.parse(h.sent[0]!.body))).not.toBeNull();
  });

  it("opens every session with visit_started, so retention is computable", () => {
    const h = harness();
    h.funnel.step("share_opened");
    h.funnel.flush();
    const first = h.events()[0]!;
    expect(first.step).toBe("visit_started");
    expect(first).toMatchObject({ newClient: true, firstSeenDay: "2026-03-17", dayIndex: 0 });
  });

  it("carries no name, no account id and no token", () => {
    const h = harness();
    h.funnel.step("share_created");
    h.funnel.playCompleted("practice", 8);
    h.funnel.flush();
    for (const event of h.events()) {
      expect(Object.keys(event)).not.toContain("userId");
      expect(Object.keys(event)).not.toContain("token");
      expect(Object.keys(event)).not.toContain("attemptId");
    }
  });
});

describe("a step is counted once", () => {
  it("ignores a repeated bare step in the same session", () => {
    const h = harness();
    h.funnel.step("landing_viewed");
    h.funnel.step("landing_viewed");
    h.funnel.step("landing_viewed");
    h.funnel.flush();
    expect(h.events().filter((e) => e.step === "landing_viewed")).toHaveLength(1);
  });

  it("counts the step again in a NEW session, which is a new visit", () => {
    const h = harness();
    h.funnel.step("landing_viewed");
    h.funnel.flush();
    // Same browser, new tab: localStorage survives, sessionStorage does not.
    const second = harness({}, { local: h.local, sent: h.sent, now: h.now });
    second.funnel.step("landing_viewed");
    second.funnel.flush();
    const events = h.events();
    expect(events.filter((e) => e.step === "landing_viewed")).toHaveLength(2);
    expect(events.filter((e) => e.step === "visit_started")).toHaveLength(2);
    expect(new Set(events.map((e) => e.clientId)).size).toBe(1);
    expect(new Set(events.map((e) => e.sessionId)).size).toBe(2);
    // The second visit is not a new client: that is what makes it a RETURN.
    expect(events.filter((e) => e.step === "visit_started").map((e) => (e as { newClient: boolean }).newClient))
      .toEqual([true, false]);
  });
});

describe("a tab left open across midnight", () => {
  it("opens a new session on the new day, so the return is countable", () => {
    const h = harness();
    h.funnel.step("landing_viewed");
    h.funnel.flush();
    // Same tab, same sessionStorage, tomorrow. Nothing was closed.
    h.now.value += 24 * 60 * 60 * 1000;
    h.funnel.step("landing_viewed");
    h.funnel.flush();
    const events = h.events();
    expect(events.filter((e) => e.step === "visit_started")).toHaveLength(2);
    // Day 1 for this client, which is exactly what D1 counts.
    expect(events.filter((e) => e.day === "2026-03-18").every((e) => e.dayIndex === 1)).toBe(true);
    expect(new Set(events.map((e) => e.sessionId)).size).toBe(2);
    expect(new Set(events.map((e) => e.clientId)).size).toBe(1);
  });
});

describe("a browser that refuses to remember", () => {
  it("keeps one client and one session for the life of the page", () => {
    const h = harness({ local: store(true), session: store(true) });
    h.funnel.step("landing_viewed");
    h.funnel.step("landing_viewed");
    h.funnel.playStarted("practice");
    h.funnel.playCompleted("practice", 8);
    h.funnel.flush();
    const events = h.events();
    expect(new Set(events.map((e) => e.clientId)).size).toBe(1);
    expect(new Set(events.map((e) => e.sessionId)).size).toBe(1);
    // Deduped, and the play still pairs, both of which need a stable memory.
    expect(events.filter((e) => e.step === "landing_viewed")).toHaveLength(1);
    const started = events.find((e) => e.step === "play_started")!;
    const done = events.find((e) => e.step === "play_completed")!;
    expect((done as { playId: string }).playId).toBe((started as { playId: string }).playId);
  });
});

describe("the awkward cases", () => {
  it("a reload mid-play counts ONE play started", () => {
    const h = harness();
    h.funnel.playStarted("practice");
    // The reload: same tab, same sessionStorage, a fresh emitter and a fresh
    // deck. The play is resumed, not restarted.
    const reloaded = harness({}, { local: h.local, session: h.session, sent: h.sent, now: h.now });
    reloaded.funnel.playStarted("practice");
    reloaded.funnel.flush();
    h.funnel.flush();
    const started = h.events().filter((e) => e.step === "play_started");
    expect(started).toHaveLength(1);
  });

  it("a play left open overnight is a new play, not a resumed one", () => {
    const h = harness();
    h.funnel.playStarted("daily");
    h.now.value += FUNNEL_PLAY_RESUME_MS + 1;
    h.funnel.playStarted("daily");
    h.funnel.flush();
    const started = h.events().filter((e) => e.step === "play_started");
    expect(started).toHaveLength(2);
    expect(new Set(started.map((e) => (e as { playId: string }).playId)).size).toBe(2);
  });

  it("does not resume a practice play when the DAILY is what started", () => {
    // Somebody abandons the hero drill and opens the daily a minute later.
    // Resuming across loops would swallow the daily start and label its
    // completion `mode: "practice"`.
    const h = harness();
    h.funnel.playStarted("practice");
    h.now.value += 60_000;
    h.funnel.playStarted("daily");
    h.funnel.playCompleted("daily", 5);
    h.funnel.flush();
    const started = h.events().filter((e) => e.step === "play_started");
    expect(started.map((e) => (e as { mode: string }).mode)).toEqual(["practice", "daily"]);
    const done = h.events().filter((e) => e.step === "play_completed");
    expect(done).toHaveLength(1);
    expect(done[0]).toMatchObject({ mode: "daily" });
    expect((done[0] as { playId: string }).playId).toBe((started[1] as { playId: string }).playId);
  });

  it("does not pair a completion with a play abandoned hours earlier", () => {
    const h = harness();
    h.funnel.playStarted("practice");
    h.now.value += FUNNEL_PLAY_RESUME_MS + 1;
    h.funnel.playCompleted("practice", 8);
    h.funnel.flush();
    const started = h.events().find((e) => e.step === "play_started")!;
    const done = h.events().find((e) => e.step === "play_completed")!;
    expect((done as { playId: string }).playId).not.toBe((started as { playId: string }).playId);
  });

  it("two plays in one day are counted twice, start and finish", () => {
    const h = harness();
    h.funnel.playStarted("practice");
    h.funnel.playCompleted("practice", 8);
    h.funnel.playStarted("practice");
    h.funnel.playCompleted("practice", 6);
    h.funnel.flush();
    const steps = h.events().map((e) => e.step);
    expect(steps.filter((s) => s === "play_started")).toHaveLength(2);
    expect(steps.filter((s) => s === "play_completed")).toHaveLength(2);
    const ids = h.events().filter((e) => e.step === "play_completed").map((e) => (e as { playId: string }).playId);
    expect(new Set(ids).size).toBe(2);
    expect(h.events().filter((e) => e.step === "play_completed").map((e) => (e as { answered: number }).answered))
      .toEqual([8, 6]);
  });

  it("pairs a completed play with the start it belongs to", () => {
    const h = harness();
    h.funnel.playStarted("daily");
    h.funnel.playCompleted("daily", 5);
    h.funnel.flush();
    const [started, completed] = h.events().filter((e) => e.step !== "visit_started");
    expect((started as { playId: string }).playId).toBe((completed as { playId: string }).playId);
  });

  it("counts a completion whose start it never saw, and leaves the gap visible", () => {
    // A reload on the results screen: the play began in a session this
    // browser no longer has.
    const h = harness();
    h.funnel.playCompleted("practice", 8);
    h.funnel.flush();
    const steps = h.events().map((e) => e.step);
    expect(steps.filter((s) => s === "play_completed")).toHaveLength(1);
    expect(steps).not.toContain("play_started");
  });

  it("a share link opened by a browser with no history is a first visit", () => {
    const h = harness();
    h.funnel.step("share_opened");
    h.funnel.flush();
    const events = h.events();
    expect(events.map((e) => e.step)).toEqual(["visit_started", "share_opened"]);
    expect(events.every((e) => e.dayIndex === 0)).toBe(true);
    expect((events[0] as { newClient: boolean }).newClient).toBe(true);
  });
});

describe("what makes D1/D7 computable", () => {
  it("stamps every event with the first day seen and the days since", () => {
    const h = harness();
    h.funnel.step("landing_viewed");
    h.funnel.flush();
    // Seven days later, same browser, new session.
    h.now.value += 7 * 24 * 60 * 60 * 1000;
    const later = harness({}, { local: h.local, sent: h.sent, now: h.now });
    later.funnel.step("landing_viewed");
    later.funnel.flush();
    const day7 = h.events().filter((e) => e.day === "2026-03-24");
    expect(day7.length).toBeGreaterThan(0);
    for (const event of day7) {
      expect(event.firstSeenDay).toBe("2026-03-17");
      expect(event.dayIndex).toBe(7);
    }
  });

  it("rotates the client id past the horizon, and starts a new first-seen day", () => {
    const h = harness();
    h.funnel.step("landing_viewed");
    h.funnel.flush();
    h.now.value += (FUNNEL_CLIENT_ROTATION_DAYS + 1) * 24 * 60 * 60 * 1000;
    const later = harness({}, { local: h.local, sent: h.sent, now: h.now });
    later.funnel.step("landing_viewed");
    later.funnel.flush();
    const ids = new Set(h.events().map((e) => e.clientId));
    expect(ids.size).toBe(2);
    const last = h.events().at(-1)!;
    expect(last.dayIndex).toBe(0);
    expect(last.firstSeenDay).toBe(last.day);
  });

  it("never reports a negative age when the device clock goes backwards", () => {
    const h = harness();
    h.funnel.step("landing_viewed");
    h.funnel.flush();
    h.now.value -= 3 * 24 * 60 * 60 * 1000;
    const back = harness({}, { local: h.local, sent: h.sent, now: h.now });
    back.funnel.step("signed_in");
    back.funnel.flush();
    expect(h.events().every((e) => e.dayIndex >= 0)).toBe(true);
    // And the batch still parses, which is what the service will do with it.
    for (const post of h.sent) expect(parseFunnelBatch(JSON.parse(post.body))).not.toBeNull();
  });
});

describe("it never throws into a caller", () => {
  it("survives a browser whose storage is disabled", () => {
    const h = harness({ local: store(true), session: store(true) });
    expect(() => {
      h.funnel.step("landing_viewed");
      h.funnel.playStarted("practice");
      h.funnel.playCompleted("practice", 8);
      h.funnel.flush();
    }).not.toThrow();
    // It still emits: an unrememberable browser is still a visitor.
    expect(h.events().map((e) => e.step)).toContain("play_completed");
  });

  it("survives a sink that throws, and does not re-send the batch", () => {
    const h = harness({
      send: () => {
        throw new Error("blocked");
      },
    });
    expect(() => {
      h.funnel.step("landing_viewed");
      h.funnel.flush();
      h.funnel.flush();
    }).not.toThrow();
    expect(h.funnel.pending()).toBe(0);
  });

  it("keeps its records under the two keys it documents", () => {
    const h = harness();
    h.funnel.step("landing_viewed");
    expect([...h.local.map.keys()]).toEqual([FUNNEL_CLIENT_KEY]);
    expect([...h.session.map.keys()]).toEqual([FUNNEL_SESSION_KEY]);
  });

  it("ignores a session record another tab scribbled over", () => {
    const h = harness();
    h.session.map.set(FUNNEL_SESSION_KEY, "{not json");
    expect(() => h.funnel.step("landing_viewed")).not.toThrow();
    h.funnel.flush();
    expect(h.events().map((e) => e.step)).toEqual(["visit_started", "landing_viewed"]);
  });
});
