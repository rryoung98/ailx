// @vitest-environment jsdom
/**
 * THE IDENTITY RACE, ON THE TWO END-OF-SITTING PANELS (TEN-215).
 *
 * Both panels fire their read on mount. In the pre-bridge window that read
 * carries no account token, the exam service answers 401, and the panel reads
 * the refusal as "nothing has been issued yet" — so a candidate who already
 * holds a credential is offered a fresh one and shown no Revoke, and a
 * candidate who already has a share link is shown the create form.
 *
 * The sibling read fixed this class first (`useScoresOfRecord`, TEN-152); the
 * rule is the same here: the read may not fire while the identity is PENDING,
 * and it must fire once the identity arrives.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { sharePayloadFrom } from "@ailx/report";
import { CredentialPanel } from "../features/report/CredentialPanel";
import { ShareLink } from "../features/report/ShareLink";
import { publishIdentity, resetIdentity } from "../lib/auth/identityState";
import { setAuthTokenSource } from "../lib/data/authHeaders";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const store = new Map<string, string>();
Object.defineProperty(window, "localStorage", {
  configurable: true,
  value: {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => void store.clear(),
  },
});

const ATTEMPT = "11111111-1111-4111-8111-111111111111";
const CODE = "AILX-2026.1-AB12-CD34-EF56-GH78";

const OWNER_CREDENTIAL = {
  id: "cred-1",
  code: CODE,
  status: "valid",
  issuedAt: "2026-02-04T09:30:00.000Z",
  revokedAt: null,
  revokeReason: null,
  claim: {
    v: 1,
    instrument: "ailx 2026.1",
    instrumentVersion: "2026.1",
    completedOn: "2026-02-03",
    tracksAttempted: ["T1", "T2", "T3", "T4"],
    playerType: { code: "MSVD", name: "The Full-Stack Skeptic" },
    artifact: null,
    claims: ["sitting-completed"],
  },
  verifyPath: `/verify/${CODE}`,
  linkedIn: {
    name: "AILX 2026.1 — Sitting Completed",
    organizationName: "AILX",
    issueYear: 2026,
    issueMonth: 2,
    credentialId: CODE,
    credentialUrl: `https://ailx.example/verify/${CODE}`,
  },
};

const OWNER_SHARE = {
  status: "unlisted",
  token: "a".repeat(43),
  views: 3,
  payload: sharePayloadFrom({ t1: 88.2, t2: 79.5, t3: 71.1, t4: 66.9 }, "Distinction", {
    instrument: "ailx 2026.1",
  }),
  rejectReason: null,
};

let container: HTMLDivElement;
let root: Root;
/** Every request the panels made, in order. Empty is the point of this file. */
let calls: { url: string; method: string; auth: string | undefined }[];

async function mount(el: ReturnType<typeof createElement>): Promise<void> {
  await act(async () => {
    root = createRoot(container);
    root.render(el);
  });
}

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_AILX_BACKEND", "1");
  vi.stubEnv("NEXT_PUBLIC_BASE_PATH", "");
  // A build that really mounts Clerk is the only one that can be PENDING.
  vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "pk_test_stub");
  window.localStorage.clear();
  resetIdentity();
  setAuthTokenSource(async () => "jwt-9");
  container = document.createElement("div");
  document.body.append(container);
  calls = [];
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  setAuthTokenSource(null);
  resetIdentity();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

/** A service that answers 401 to anything with no Bearer token, like Clerk. */
function stubService(held: unknown): void {
  const fetchMock = vi.fn(async (_url: string, init: { method?: string; headers?: Record<string, string> }) => {
    const auth = init.headers?.authorization;
    calls.push({ url: String(_url), method: init.method ?? "GET", auth });
    if (auth === undefined) return new Response("{}", { status: 401 });
    return new Response(JSON.stringify(held), { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
  window.fetch = fetchMock as unknown as typeof fetch;
}

describe("CredentialPanel waits for the identity before it reads (TEN-215)", () => {
  it("asks nothing while PENDING, then reads once and shows the held credential", async () => {
    stubService({ credential: OWNER_CREDENTIAL });
    await mount(createElement(CredentialPanel, { attemptId: ATTEMPT }));
    expect(calls).toHaveLength(0);
    expect(container.querySelector("[data-testid='credential-offer']")).toBeNull();

    await act(async () => {
      publishIdentity({ status: "signed-in", userId: "user_1" });
    });
    await settle();

    expect(calls).toHaveLength(1);
    expect(calls[0].auth).toBe("Bearer jwt-9");
    // The holder sees their credential and the Revoke control, not the offer.
    expect(container.querySelector("#credential-url")).not.toBeNull();
    expect(container.textContent).toContain("Revoke");
    expect(container.querySelector("[data-testid='credential-offer']")).toBeNull();
  });
});

describe("ShareLink waits for the identity before it reads (TEN-215)", () => {
  it("asks nothing while PENDING, then reads once and shows the existing link", async () => {
    stubService({ share: OWNER_SHARE });
    await mount(createElement(ShareLink, { attemptId: ATTEMPT }));
    expect(calls).toHaveLength(0);
    expect(container.querySelector("#share-url")).toBeNull();

    await act(async () => {
      publishIdentity({ status: "signed-in", userId: "user_1" });
    });
    await settle();

    /* Only the SHARE read is counted. A live link also mounts
       `CandidateThread`, which makes its own read of the moderation route —
       a different request, gated behind this one. */
    const shareReads = calls.filter((c) => c.url.endsWith("/share"));
    expect(shareReads).toHaveLength(1);
    expect(shareReads[0].auth).toBe("Bearer jwt-9");
    const input = container.querySelector<HTMLInputElement>("#share-url");
    expect(input).not.toBeNull();
    expect(input!.value).toContain("a".repeat(43));
  });
});
