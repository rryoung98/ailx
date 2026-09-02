// @vitest-environment jsdom
/**
 * The player-type character ON THE SURFACES that carry it.
 *
 * `packages/report/test/characters.test.ts` proves the cast is complete,
 * distinct and licensed. This file proves the two things only the web app
 * can be wrong about:
 *
 *  1. THE PICTURE IS NEVER THE ONLY CARRIER. Wherever a character is drawn,
 *     the code, the name and the tagline are still there as text, and the
 *     image has its own alt describing the drawing. Turn images off and the
 *     card still says everything.
 *  2. THE OG PATH DEGRADES. The rasterizer needs BYTES, so the route fetches
 *     the asset; a bad response has to produce a portrait-less card, never an
 *     exception on somebody's share link.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ALL_SHARE_SECTIONS, playerCharacter, sharePayloadFrom, type SharePayload } from "@ailx/report";
import { CharacterPortrait, CharacterVoice } from "../lib/CharacterPortrait";
import { GalleryCard } from "../lib/GalleryCard";
import { characterDataUrl } from "../lib/server/portrait";

const CODE = "MSVD";
const character = playerCharacter(CODE)!;

const payload: SharePayload = sharePayloadFrom(
  { t1: 88.2, t2: 79.5, t3: 71.1, t4: 66.9 },
  "Distinction",
  { instrument: "ailx 2026.1", sections: ALL_SHARE_SECTIONS, completedOn: "2026-03-01" },
);

describe("CharacterPortrait", () => {
  it("draws the character's own asset and alt text, at the size asked for", () => {
    const html = renderToStaticMarkup(<CharacterPortrait code={CODE} size={64} />);
    expect(html).toContain(character.src);
    expect(html).toContain(character.alt);
    expect(html).toContain('width="64"');
    expect(html).toContain('loading="lazy"');
  });

  it("resolves the asset under the build's basePath — one rule, not two", () => {
    // The static export lives at /ailx; a bare /characters/... 404s there.
    const html = renderToStaticMarkup(<CharacterPortrait code={CODE} />);
    const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "/ailx";
    expect(html).toContain(`src="${base}/${character.src}"`);
  });

  it("renders nothing for a code the cast does not know", () => {
    expect(renderToStaticMarkup(<CharacterPortrait code="XXXX" />)).toBe("");
    expect(renderToStaticMarkup(<CharacterVoice code="XXXX" />)).toBe("");
  });

  it("says the character's line, verbatim", () => {
    expect(renderToStaticMarkup(<CharacterVoice code={CODE} />)).toContain(character.voice);
  });
});

describe("the gallery tile keeps the text when it gains a face", () => {
  const html = renderToStaticMarkup(
    <GalleryCard
      entry={{
        id: "11111111-2222-3333-4444-555555555555",
        token: "g".repeat(43),
        at: "2026-03-01T12:00:00.000Z",
        payload,
      }}
    />,
  );
  const tile = playerCharacter(payload.playerType.code)!;

  it("draws the character", () => {
    expect(html).toContain(tile.src);
    expect(html).toContain(tile.alt);
  });

  it("still prints the code, the name and the tagline as text", () => {
    expect(html).toContain(payload.playerType.name);
    expect(html).toContain(payload.playerType.tagline);
    for (const pole of payload.playerType.poles) expect(html).toContain(`>${pole.letter}<`);
  });
});

describe("characterDataUrl — bytes for the OG rasterizer", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => vi.unstubAllGlobals());

  const ok = (type = "image/jpeg") =>
    ({ ok: true, headers: new Headers({ "content-type": type }),
       arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer }) as unknown as Response;

  it("inlines the asset as a data URL, fetched from the public origin", async () => {
    fetchMock.mockResolvedValue(ok());
    const url = await characterDataUrl("MSVE", "https://ailx.example");
    expect(url).toMatch(/^data:image\/jpeg;base64,/);
    expect(fetchMock.mock.calls[0][0]).toContain("https://ailx.example");
    expect(fetchMock.mock.calls[0][0]).toContain(playerCharacter("MSVE")!.src);
  });

  it("memoises a success, so a warm instance fetches each face once", async () => {
    fetchMock.mockResolvedValue(ok());
    await characterDataUrl("MSAD", "https://ailx.example");
    await characterDataUrl("MSAD", "https://ailx.example");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns null — never throws — on an unknown code, a 404, a non-image or a dead network", async () => {
    expect(await characterDataUrl("XXXX", "https://ailx.example")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();

    fetchMock.mockResolvedValue({ ok: false, headers: new Headers(), arrayBuffer: async () => new ArrayBuffer(0) } as unknown as Response);
    expect(await characterDataUrl("MTVD", "https://ailx.example")).toBeNull();

    fetchMock.mockResolvedValue(ok("text/html"));
    expect(await characterDataUrl("MTVE", "https://ailx.example")).toBeNull();

    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));
    expect(await characterDataUrl("MTAD", "https://ailx.example")).toBeNull();
  });

  it("does not memoise a failure, so one bad minute is not permanent", async () => {
    fetchMock.mockRejectedValueOnce(new Error("flap")).mockResolvedValue(ok());
    expect(await characterDataUrl("PTAE", "https://ailx.example")).toBeNull();
    expect(await characterDataUrl("PTAE", "https://ailx.example")).toMatch(/^data:image\//);
  });
});
