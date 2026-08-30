// @vitest-environment jsdom
/**
 * The verification view is what a STRANGER acts on, so these tests assert the
 * three answers it owes them: is this real, is it still good, and what does
 * it actually say. Plus the one anti-forgery rule — nothing on the page may
 * imply a claim the credential does not carry.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  CREDENTIAL_LIMITS,
  buildCredentialClaim,
  type CredentialClaim,
} from "@ailx/report";
import { initialState, TRACK_IDS, type SessionState } from "@ailx/session";

function completedState(): SessionState {
  const s = initialState();
  s.phase = "completed";
  s.config = {
    instrument: "ailx", version: "2026.1", locale: "en",
    budgets: { t1: 600, t2: 300, t3: 600, t4: 480 },
  };
  s.lastTs = Date.parse("2026-02-03T11:00:00.000Z");
  for (const t of TRACK_IDS) {
    s.tracks[t] = { trackId: t, status: "completed", activeMs: 60_000, events: [], score: { raw: {}, scaled: 50 } };
  }
  return s;
}

const claim: CredentialClaim = buildCredentialClaim(
  completedState(),
  { t1: 88.2, t2: 30.5, t3: 71.1, t4: 66.9 },
  { artifact: "/api/site/sha256:abc/index.html" },
)!;

const CODE = "AILX-2026.1-AB12-CD34-EF56-GH78";

let record: unknown = null;

vi.mock("../lib/server/api", () => ({
  withApiContext: async (fn: (ctx: unknown) => Promise<unknown>) => fn({ db: {} }),
  pageOrigin: async () => "https://ailx.example",
}));
vi.mock("@ailx/backend", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("@ailx/backend");
  return { ...actual, resolveCredential: async () => record };
});

const { default: VerifyPage, generateMetadata } = await import("../app/verify/[code]/page.api");

const params = { params: Promise.resolve({ code: CODE }) };

const VALID = {
  id: "cred-1",
  code: CODE,
  status: "valid" as const,
  issuedAt: "2026-02-04T09:30:00.000Z",
  revokedAt: null,
  revokeReason: null,
  claim,
};

const REVOKED = {
  ...VALID,
  status: "revoked" as const,
  revokedAt: "2026-03-01T08:00:00.000Z",
  revokeReason: "issued against a withdrawn sitting",
};

beforeEach(() => {
  record = VALID;
  vi.stubEnv("AILX_PUBLIC_ORIGIN", "https://ailx.example");
});
afterEach(() => vi.unstubAllEnvs());

async function markup(): Promise<string> {
  return renderToStaticMarkup(await VerifyPage({ params: Promise.resolve({ code: CODE }) }));
}

function dom(html: string): HTMLElement {
  const el = document.createElement("div");
  el.innerHTML = html;
  return el;
}

describe("a genuine credential", () => {
  it("says Verified, and names the issuer", async () => {
    const html = await markup();
    expect(dom(html).querySelector(".verify-status")!.textContent).toBe("Verified");
    expect(html).toContain("issued by AILX");
    expect(dom(html).querySelector(".verify-valid")).not.toBeNull();
  });

  it("states the facts a verifier needs, and nothing more", async () => {
    const html = await markup();
    for (const fact of [
      "2026-02-03",                 // sitting completed on
      "2026-02-04",                 // issued on
      CODE,                          // credential id
      "ailx 2026.1",                // instrument
      "T1 · T2 · T3 · T4",          // tracks attempted
      claim.playerType.name,
    ]) {
      expect(html, fact).toContain(fact);
    }
  });

  it("gives the long facts a full row so the id is copyable, not hyphenated", async () => {
    const d = dom(await markup());
    const facts = [...d.querySelectorAll(".verify-facts > div")];
    const cell = (label: string) =>
      facts.find((f) => f.querySelector("dt")?.textContent === label)!;
    // The 29-character id used to break across four lines in a 140px column.
    expect(cell("Credential id").getAttribute("style")).toContain("1 / -1");
    expect(cell("Player type").getAttribute("style")).toContain("1 / -1");
    // The short ones stay in the compact auto-fit grid.
    for (const short of ["Issued by", "Issued on", "Instrument", "Tracks attempted"]) {
      expect(cell(short).getAttribute("style"), short).toBeNull();
    }
  });

  it("prints what it does NOT assert with equal weight", async () => {
    const html = await markup();
    for (const limit of CREDENTIAL_LIMITS) {
      expect(html).toContain(limit.replace(/'/g, "&#x27;"));
    }
  });

  it("never implies a score, a band, a grade or a pass", async () => {
    const el = dom(await markup());
    // The limits list SAYS these words; everything else must not.
    for (const node of el.querySelectorAll(".verify-limits, .verify-limits *")) node.remove();
    const text = el.textContent ?? "";
    for (const forbidden of ["Distinction", "Merit", "percentile", "composite", "passed", "out of 100"]) {
      expect(text, forbidden).not.toContain(forbidden);
    }
  });

  it("links the artifact and the machine-readable document", async () => {
    const el = dom(await markup());
    const hrefs = [...el.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(hrefs).toContain("/api/site/sha256:abc/index.html");
    expect(hrefs).toContain(`/api/credentials/${CODE}`);
  });

  it("is never indexed: verification is by link, not by search", async () => {
    expect((await generateMetadata(params)).robots).toMatchObject({ index: false, follow: false });
  });
});

describe("a revoked credential", () => {
  beforeEach(() => {
    record = REVOKED;
  });

  it("resolves, and says Revoked with its date and reason", async () => {
    const html = await markup();
    expect(dom(html).querySelector(".verify-status")!.textContent).toBe("Revoked");
    expect(html).toContain("2026-03-01");
    expect(html).toContain("issued against a withdrawn sitting");
    expect(dom(html).querySelector(".verify-revoked")).not.toBeNull();
  });

  it("never tells a reader it is current", async () => {
    const text = dom(await markup()).textContent ?? "";
    expect(text).not.toContain("is current");
    expect(text).toContain("should not be relied on");
  });

  it("still describes the credential in its metadata, honestly", async () => {
    expect((await generateMetadata(params)).description).toContain("revoked");
  });
});

describe("an unknown or forged code", () => {
  beforeEach(() => {
    record = null;
  });

  it("refuses to confirm anything, in words", async () => {
    const html = await markup();
    expect(dom(html).querySelector(".verify-status")!.textContent).toBe("Cannot be confirmed");
    expect(html).toContain("Nothing on this page vouches for it");
    expect(dom(html).querySelector(".verify-unknown")).not.toBeNull();
  });

  it("says an image is not evidence — the page is the source of truth", async () => {
    expect(dom(await markup()).textContent).toContain("screenshot");
  });

  it("titles the tab as not found", async () => {
    expect((await generateMetadata(params)).title).toContain("not found");
  });
});
