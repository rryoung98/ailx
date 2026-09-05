// @vitest-environment jsdom
/**
 * The two report surfaces this feature adds: the diagnosis (warm, always
 * present) and the credential panel (serious, server mode only).
 *
 * What is asserted here is what a user is PROMISED: the diagnosis names a
 * weakness and offers the drill that fixes it, and the credential panel never
 * advertises a claim the verification page would not confirm.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { CREDENTIAL_LIMITS, diagnose, linkedInAddUrl } from "@ailx/report";
import { cohortMedians } from "@ailx/report";
import { Diagnosis } from "../features/report/Diagnosis";
import { CredentialPanel } from "../features/report/CredentialPanel";

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

const med = cohortMedians();
const T2_WEAK = { t1: med.t1 + 20, t2: med.t2 - 25, t3: med.t3 + 10, t4: med.t4 + 18 };
const PROCESS = {
  totalActiveSeconds: 1200,
  tracks: (["t1", "t2", "t3", "t4"] as const).map((track) => ({
    track,
    activeSeconds: 300,
    budgetSeconds: 600,
    timedOut: false,
    iterationRatio: 0.8,
    verificationEvents: 2,
  })),
};

function dom(html: string): HTMLElement {
  const el = document.createElement("div");
  el.innerHTML = html;
  return el;
}

describe("Diagnosis", () => {
  const html = renderToStaticMarkup(
    createElement(Diagnosis, { trackRaw: T2_WEAK, process: PROCESS }),
  );

  it("leads with the honest one-line summary from the pure derivation", () => {
    const d = diagnose({ trackRaw: T2_WEAK, process: PROCESS });
    expect(dom(html).querySelector(".diagnosis-summary")!.textContent).toBe(d.summary);
  });

  it("shows all four tracks, marking the weak one to work on", () => {
    const el = dom(html);
    expect(el.querySelectorAll(".diagnosis-findings li")).toHaveLength(4);
    const first = el.querySelector(".diagnosis-findings li")!;
    expect(first.className).toContain("diagnosis-watch");
    expect(first.textContent).toContain("T2");
    expect(first.textContent).toContain("to work on");
  });

  it("closes the loop: the weakness links to the drill that targets it", () => {
    const links = [...dom(html).querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(links).toContain("/practice");
  });

  it("prints the honesty basis, so no figure reads as a judged score", () => {
    const text = dom(html).textContent ?? "";
    expect(text).toContain("No percentile, no cohort rank and no judged result");
    expect(text).not.toContain("Distinction");
    expect(text).not.toContain("composite");
  });

  it("shows the process habits when there is process data, and copes without", () => {
    expect(html).toContain("How you worked");
    const bare = renderToStaticMarkup(createElement(Diagnosis, { trackRaw: T2_WEAK }));
    expect(bare).not.toContain("How you worked");
    expect(bare).toContain("Do this next");
  });

  it("labels its section for assistive technology", () => {
    const section = dom(html).querySelector("section")!;
    expect(section.getAttribute("aria-labelledby")).toBe("diagnosis-heading");
    expect(dom(html).querySelector("#diagnosis-heading")).not.toBeNull();
  });
});

const ATTEMPT = "11111111-1111-4111-8111-111111111111";
const CODE = "AILX-2026.1-AB12-CD34-EF56-GH78";

const OWNER = {
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

let container: HTMLDivElement;
let fetchMock: ReturnType<typeof vi.fn>;

async function render(): Promise<void> {
  await act(async () => {
    createRoot(container).render(createElement(CredentialPanel, { attemptId: ATTEMPT }));
  });
}

const button = (name: RegExp): HTMLButtonElement | undefined =>
  [...container.querySelectorAll("button")].find((b) => name.test(b.textContent ?? ""));

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_AILX_BACKEND", "1");
  vi.stubEnv("NEXT_PUBLIC_BASE_PATH", "");
  window.localStorage.clear();
  window.localStorage.setItem("foray:dev-user", "tester");
  container = document.createElement("div");
  document.body.append(container);
  fetchMock = vi.fn(async () => new Response("{}", { status: 404 }));
  vi.stubGlobal("fetch", fetchMock);
  window.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  container.remove();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("CredentialPanel in the static export", () => {
  it("renders nothing — no button that cannot issue anything", async () => {
    vi.stubEnv("NEXT_PUBLIC_AILX_BACKEND", "");
    await render();
    expect(container.textContent).toBe("");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("CredentialPanel in server mode", () => {
  it("offers issuance and issues nothing until asked", async () => {
    await render();
    expect(button(/Issue my credential/)).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1].method).toBe("GET");
  });

  it("states the limits of the claim before anything is issued", async () => {
    await render();
    const text = container.textContent ?? "";
    for (const limit of CREDENTIAL_LIMITS) expect(text).toContain(limit);
    expect(text).toContain("carries no score");
    // "passed" may appear ONLY inside the limits list, which denies it.
    const outsideLimits = [...container.querySelectorAll("p")]
      .map((p) => p.textContent ?? "")
      .join(" ");
    expect(outsideLimits).not.toContain("passed");
    expect(outsideLimits).not.toContain("certified");
  });

  it("issues, then shows the verification link and the LinkedIn fields", async () => {
    fetchMock.mockImplementation(async (_url: string, init: { method: string }) =>
      init.method === "POST"
        ? new Response(JSON.stringify({ credential: OWNER }), { status: 201 })
        : new Response("{}", { status: 404 }),
    );
    await render();
    await act(async () => {
      button(/Issue my credential/)!.click();
    });
    const input = container.querySelector<HTMLInputElement>("#credential-url")!;
    expect(input.value).toBe(`${window.location.origin}/verify/${CODE}`);
    const text = container.textContent ?? "";
    expect(text).toContain("AILX 2026.1 — Sitting Completed");
    expect(text).toContain("AILX");
    expect(text).toContain("2/2026");
    expect(text).toContain(CODE);
  });

  it("prefills LinkedIn's certification form with the server's own fields", async () => {
    fetchMock.mockImplementation(async (_url: string, init: { method: string }) =>
      init.method === "POST"
        ? new Response(JSON.stringify({ credential: OWNER }), { status: 201 })
        : new Response("{}", { status: 404 }),
    );
    await render();
    await act(async () => {
      button(/Issue my credential/)!.click();
    });
    const link = [...container.querySelectorAll("a")].find((a) =>
      (a.getAttribute("href") ?? "").includes("linkedin.com"),
    )!;
    expect(link.getAttribute("href")).toBe(linkedInAddUrl(OWNER.linkedIn));
    const url = new URL(link.getAttribute("href")!);
    expect(url.searchParams.get("startTask")).toBe("CERTIFICATION_NAME");
    expect(url.searchParams.get("certId")).toBe(CODE);
    expect(url.searchParams.get("certUrl")).toBe(OWNER.linkedIn.credentialUrl);
    expect(url.searchParams.get("issueMonth")).toBe("2");
    expect(link.getAttribute("rel")).toBe("noreferrer");
  });

  it("copies the verification link, not an image", async () => {
    const copied: string[] = [];
    Object.assign(navigator, { clipboard: { writeText: async (t: string) => void copied.push(t) } });
    fetchMock.mockImplementation(async (_u: string, init: { method: string }) =>
      init.method === "GET"
        ? new Response(JSON.stringify({ credential: OWNER }), { status: 200 })
        : new Response("{}", { status: 200 }),
    );
    await render();
    await act(async () => {
      button(/Copy link/)!.click();
    });
    expect(copied).toEqual([`${window.location.origin}/verify/${CODE}`]);
  });

  it("revokes through DELETE and drops back to the issue state", async () => {
    const methods: string[] = [];
    fetchMock.mockImplementation(async (_u: string, init: { method: string }) => {
      methods.push(init.method);
      if (init.method === "GET") {
        return new Response(JSON.stringify({ credential: OWNER }), { status: 200 });
      }
      return new Response(JSON.stringify({ revoked: true }), { status: 200 });
    });
    await render();
    await act(async () => {
      button(/Revoke/)!.click();
    });
    expect(methods).toEqual(["GET", "DELETE"]);
    expect(button(/Issue my credential/)).toBeTruthy();
  });

  it("explains that revoking keeps the link honest rather than dead", async () => {
    fetchMock.mockImplementation(async () =>
      new Response(JSON.stringify({ credential: OWNER }), { status: 200 }),
    );
    await render();
    expect(container.textContent).toContain("keeps the link working");
  });

  it("says what went wrong instead of failing silently", async () => {
    fetchMock.mockImplementation(async (_u: string, init: { method: string }) =>
      init.method === "GET"
        ? new Response("{}", { status: 404 })
        : new Response("{}", { status: 400 }),
    );
    await render();
    await act(async () => {
      button(/Issue my credential/)!.click();
    });
    expect(container.querySelector('[role="alert"]')!.textContent).toContain(
      "Finish and score every track first",
    );
  });
});
