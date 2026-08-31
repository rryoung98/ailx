// @vitest-environment jsdom
/**
 * The verification view is what a STRANGER acts on, so these tests assert the
 * three answers it owes them: is this real, is it still good, and what does
 * it actually say. Plus the one anti-forgery rule — nothing on the page may
 * imply a claim the credential does not carry.
 *
 * The page reads the PUBLIC Open Badges document over HTTP now, so the
 * fixtures are that document (built by @ailx/report, the same bytes a machine
 * verifier gets) rather than a database row. Two new obligations come with
 * the transport: no identity may be sent — a public claim must not depend on
 * who is checking — and an unreachable service must NOT be reported as
 * "cannot be confirmed", which would be its own kind of forgery.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import {
  CREDENTIAL_LIMITS,
  buildCredentialClaim,
  credentialDocument,
  type CredentialClaim,
} from "@ailx/report";
import { initialState, TRACK_IDS, type SessionState } from "@ailx/session";
import {
  renderClient,
  renderClientPending,
  stubFailingFetch,
  stubHangingFetch,
} from "./helpers/clientPage";

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
const ORIGIN = "https://ailx.example";

const VALID_STATE = {
  code: CODE,
  status: "valid" as const,
  issuedAt: "2026-02-04T09:30:00.000Z",
  revokedAt: null,
  revokeReason: null,
};

const REVOKED_STATE = {
  ...VALID_STATE,
  status: "revoked" as const,
  revokedAt: "2026-03-01T08:00:00.000Z",
  revokeReason: "issued against a withdrawn sitting",
};

const VALID = credentialDocument(claim, VALID_STATE, ORIGIN);
const REVOKED = credentialDocument(claim, REVOKED_STATE, ORIGIN);

/** null = the code is unknown, so the service answers 404. */
let document_: unknown = VALID;
let status = 200;
const urls: string[] = [];
const identity: Array<Record<string, string>> = [];

vi.mock("next/navigation", () => ({ useParams: () => ({ code: CODE }) }));
// `generateMetadata` still runs on the SERVER: a social/HR scraper never
// runs the client, so the tab title has to be honest about a revocation
// before any of it. It needs a host to make the seam's relative base
// absolute — see lib/server/page.ts.
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ host: "ailx.example" }),
}));

const { VerifyView } = await import("../lib/VerifyView");
const { generateMetadata } = await import("../app/verify/[code]/page.api");

const params = { params: Promise.resolve({ code: CODE }) };

function stubCredentialService(): void {
  vi.stubGlobal("fetch", async (url: unknown, init?: RequestInit) => {
    urls.push(String(url));
    identity.push((init?.headers ?? {}) as Record<string, string>);
    const body =
      status === 200 && document_ !== null
        ? document_
        : { error: { code: "not_found", message: "no AILX credential with that id" } };
    return new Response(JSON.stringify(body), {
      status: document_ === null ? 404 : status,
    });
  });
}

beforeEach(() => {
  // These pages exist only in the hosted build, whose basePath is "" — the
  // unit-test fallback would otherwise prefix "/ailx" onto every served path
  // through lib/mode.ts (see siteHref).
  vi.stubEnv("NEXT_PUBLIC_BASE_PATH", "");
  vi.stubEnv("AILX_PUBLIC_ORIGIN", ORIGIN);
  document_ = VALID;
  status = 200;
  urls.length = 0;
  identity.length = 0;
  stubCredentialService();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function markup(): Promise<string> {
  return renderClient(createElement(VerifyView));
}

function dom(html: string): HTMLElement {
  const el = window.document.createElement("div");
  el.innerHTML = html;
  return el;
}

describe("how it reads the credential", () => {
  it("asks the seam for the public document, by the code in the URL", async () => {
    await markup();
    expect(urls[0]).toMatch(new RegExp(`/api/credentials/${CODE}$`));
  });

  it("sends NO identity — a public claim cannot depend on who is checking", async () => {
    await markup();
    expect(identity[0]["x-ailx-dev-user"]).toBeUndefined();
    expect(identity[0].authorization).toBeUndefined();
  });

  it("says it is checking before the answer lands", async () => {
    stubHangingFetch();
    const html = await renderClientPending(createElement(VerifyView));
    expect(html).toContain("Loading");
    expect(html).not.toContain("Cannot be confirmed");
    expect(html).not.toContain("Verified");
  });

  it("does NOT say 'cannot be confirmed' when the service is unreachable", async () => {
    stubFailingFetch();
    const html = await markup();
    expect(html).toContain("could not reach the AILX service");
    // Refusing to vouch for a real credential because a request failed would
    // be a forgery in the other direction.
    expect(html).not.toContain("Cannot be confirmed");
    expect(html).not.toContain("Verified");
  });

  it("treats a 500 as an outage, not as a verdict", async () => {
    status = 500;
    const html = await markup();
    expect(html).toContain("could not reach the AILX service");
    expect(html).not.toContain("Cannot be confirmed");
  });

  it("refuses a document that is not shaped like ours", async () => {
    document_ = { hello: "world" };
    expect(dom(await markup()).querySelector(".verify-status")!.textContent).toBe(
      "Cannot be confirmed",
    );
  });
});

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
    // Rendered into a live DOM, so apostrophes are apostrophes.
    for (const limit of CREDENTIAL_LIMITS) {
      expect(html).toContain(limit);
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
    // The document names its own absolute URL — that is where the JSON
    // really lives, on whichever host answered.
    expect(hrefs).toContain(`${ORIGIN}/api/credentials/${CODE}`);
  });

  it("is never indexed: verification is by link, not by search", async () => {
    expect((await generateMetadata(params)).robots).toMatchObject({ index: false, follow: false });
  });
});

describe("a revoked credential", () => {
  beforeEach(() => {
    document_ = REVOKED;
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
    document_ = null;
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
