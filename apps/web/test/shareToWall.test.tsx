// @vitest-environment jsdom
/**
 * THE SHARE-TO-WALL BUTTON (TEN-235).
 *
 * It posts up to 1.3 MB to a third-party demo host. It had no deadline, so a
 * host that accepted the socket and never answered left the button on
 * "Sharing…" for the life of the page; no unmount guard, so a candidate who
 * navigated away set state on a dead tree; and one sentence for every
 * failure, including a per-DAY rate limit reported as "try again later",
 * which is wrong by roughly a day.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { CALL_TIMEOUT_MS } from "../lib/data/deadline";
import { DEMO_GALLERY_API } from "../lib/data/demoProxy";
import { ShareToGallery } from "../features/report/ShareToGallery";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

/* The component imports the T4 recompressor lazily. Loading that package
   here would pull a whole track runner into a unit test about one button,
   and its module load does not settle under fake timers. */
vi.mock("@ailx/track-t4", () => ({
  recompressDataUri: async (uri: string) => uri,
}));

const ARTIFACT = {
  chosenSet: [0],
  note: "a bike-repair co-op, in three frames",
  finals: { images: [{ dataUri: "data:image/png;base64,AAAA", modelId: "m-1" }] },
};

let host: HTMLDivElement;
let root: Root;
let urls: string[];

async function render(): Promise<void> {
  await act(async () => {
    root.render(createElement(ShareToGallery, { artifact: ARTIFACT }));
  });
}

const button = (): HTMLButtonElement | null => host.querySelector("button");

async function click(): Promise<void> {
  const btn = button()!;
  await act(async () => {
    btn.click();
  });
  // `share()` awaits a dynamic import before it fetches; a couple of
  // microtask turns is not enough to get past a module load.
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
    await vi.advanceTimersByTimeAsync(0);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  urls = [];
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function stub(answer: (signal: AbortSignal | undefined) => Promise<Response>): void {
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    urls.push(String(url));
    return await answer(init?.signal ?? undefined);
  });
}

describe("the share-to-wall button", () => {
  it("posts to the one demo-gallery constant, not a literal of its own", async () => {
    stub(async () => new Response("{}", { status: 200 }));
    await render();
    await click();
    expect(urls).toEqual([DEMO_GALLERY_API]);
  });

  it("stops waiting instead of saying Sharing… for ever", async () => {
    /* A host that accepts the socket and never answers. The button must come
       back with a sentence rather than stay on "Sharing…". */
    stub(
      (signal) =>
        new Promise<Response>((_resolve, reject) => {
          signal?.addEventListener("abort", () => reject(signal.reason));
        }),
    );
    await render();
    const btn = button()!;
    await act(async () => {
      btn.click();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CALL_TIMEOUT_MS.upload + 1);
      for (let i = 0; i < 20; i += 1) await Promise.resolve();
    });
    expect(host.querySelector("[data-testid='wall-share-error']")?.textContent).toContain(
      "did not answer in time",
    );
    expect(button()!.textContent).not.toContain("Sharing…");
  });

  it("says the daily limit in days, not in moments, on a 429", async () => {
    stub(async () => new Response(JSON.stringify({ error: "daily share limit reached" }), { status: 429 }));
    await render();
    await click();
    const said = host.querySelector("[data-testid='wall-share-error']")!.textContent ?? "";
    expect(said).toContain("one share per browser per day");
    expect(said).not.toContain("try again later");
    expect(said).not.toContain("Try again in a moment");
  });

  it("says a 413 is about size, and does not offer a pointless retry", async () => {
    stub(async () => new Response(JSON.stringify({ error: "image 1 over 440KB" }), { status: 413 }));
    await render();
    await click();
    const said = host.querySelector("[data-testid='wall-share-error']")!.textContent ?? "";
    expect(said).toContain("too large");
    expect(said).not.toContain("try again later");
  });

  it("sets no state on a tree that is gone", async () => {
    /* The upload outlives the component when the candidate navigates away.
       React logs an error for a setState on an unmounted root, so a failure
       here is loud rather than theoretical. */
    const errors: unknown[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...args) => void errors.push(args));
    let answer: (() => void) | null = null;
    stub(
      () =>
        new Promise<Response>((resolve) => {
          answer = () => resolve(new Response("{}", { status: 500 }));
        }),
    );
    await render();
    const btn = button()!;
    await act(async () => {
      btn.click();
    });
    await act(async () => root.unmount());
    answer!();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(errors).toEqual([]);
    spy.mockRestore();
    // The afterEach unmount is a no-op on an already-unmounted root.
    root = createRoot(document.createElement("div"));
  });
});
