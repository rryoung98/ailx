/**
 * The social preview is load-bearing: a paste with no preview does not
 * spread. So this suite proves three things — the card really rasterizes to
 * a PNG, it contains the values from the frozen payload, and its colours are
 * the shipped design tokens rather than a second palette that will drift.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { isValidElement } from "react";
import { ALL_SHARE_SECTIONS, playerCharacter, sharePayloadFrom } from "@ailx/report";
import {
  SHARE_CARD_COLORS,
  SHARE_CARD_HEIGHT,
  SHARE_CARD_WIDTH,
  clampLine,
  shareCardElement,
} from "../features/share/shareCardArt";

const payload = sharePayloadFrom(
  { t1: 88.2, t2: 79.5, t3: 71.1, t4: 66.9 },
  "Distinction",
  { instrument: "ailx 2026.1", sections: { profile: false, process: false, completed: false, site: false, note: false } },
);

/** Flatten the element tree to the strings it will draw. */
function texts(node: unknown, out: string[] = []): string[] {
  if (typeof node === "string" || typeof node === "number") out.push(String(node));
  else if (Array.isArray(node)) for (const n of node) texts(n, out);
  else if (isValidElement(node)) texts((node.props as { children?: unknown }).children, out);
  return out;
}

/** Every `<img>` in the tree, with the props that matter to satori. */
function imgs(node: unknown, out: { src: string; width: number }[] = []) {
  if (Array.isArray(node)) for (const n of node) imgs(n, out);
  else if (isValidElement(node)) {
    const props = node.props as { src?: string; width?: number; children?: unknown };
    if (node.type === "img" && typeof props.src === "string") {
      out.push({ src: props.src, width: props.width ?? 0 });
    }
    imgs(props.children, out);
  }
  return out;
}

/** Every `flexWrap` in the tree — a wrapping row is a second line of height. */
function flexWraps(node: unknown, out: string[] = []): string[] {
  if (Array.isArray(node)) for (const n of node) flexWraps(n, out);
  else if (isValidElement(node)) {
    const props = node.props as { style?: { flexWrap?: string }; children?: unknown };
    if (typeof props.style?.flexWrap === "string") out.push(props.style.flexWrap);
    flexWraps(props.children, out);
  }
  return out;
}

/** Every `lineClamp` set anywhere in the tree, in draw order. */
function lineClamps(node: unknown, out: number[] = []): number[] {
  if (Array.isArray(node)) for (const n of node) lineClamps(n, out);
  else if (isValidElement(node)) {
    const props = node.props as { style?: { lineClamp?: number }; children?: unknown };
    if (typeof props.style?.lineClamp === "number") out.push(props.style.lineClamp);
    lineClamps(props.children, out);
  }
  return out;
}

/** The width of every accent-filled meter in the tree, in draw order. */
function barFillWidths(node: unknown, out: string[] = []): string[] {
  if (Array.isArray(node)) for (const n of node) barFillWidths(n, out);
  else if (isValidElement(node)) {
    const props = node.props as {
      style?: { width?: unknown; height?: unknown; background?: unknown };
      children?: unknown;
    };
    const s = props.style;
    if (
      typeof s?.width === "string" && s.width.endsWith("%") &&
      s.height === "100%" && s.background === SHARE_CARD_COLORS.accent
    ) {
      out.push(s.width);
    }
    barFillWidths(props.children, out);
  }
  return out;
}

describe("share card art", () => {
  it("draws the code, name, tagline, band and track shape", () => {
    const drawn = texts(shareCardElement(payload)).join(" ");
    expect(drawn).toContain(payload.playerType.code);
    expect(drawn).toContain(payload.playerType.name);
    expect(drawn).toContain(payload.playerType.tagline);
    expect(drawn).toContain("Distinction");
    for (const t of ["T1", "T2", "T3", "T4", "88.2", "79.5", "71.1", "66.9"]) {
      expect(drawn, t).toContain(t);
    }
  });

  it("draws nothing item-level, and invites the reader in", () => {
    const drawn = texts(shareCardElement(payload)).join(" ");
    expect(drawn).toContain("Find your type");
    expect(drawn).not.toMatch(/item|answer|question/i);
  });

  it("draws the opted-in extras: a highlight line and footnotes", () => {
    const full = sharePayloadFrom({ t1: 88.2, t2: 79.5, t3: 5, t4: 4 }, "Merit", {
      instrument: "ailx 2026.1",
      sections: ALL_SHARE_SECTIONS,
      site: "/api/site/sha256:abc/index.html",
      completedOn: "2026-02-03",
      note: "I built a co-op site.",
      process: { totalActiveSeconds: 1800, tracks: [] },
    });
    const drawn = texts(shareCardElement(full)).join(" ");
    expect(drawn).toContain("I built a co-op site.");
    expect(drawn).toContain("30 min on task");
    expect(drawn).toContain("2026-02-03");
    expect(drawn).toContain("built a site");
    // The site PATH is never drawn — only the fact that there is one.
    expect(drawn).not.toContain("sha256:abc");
  });

  it("falls back to a derived strength, and draws nothing when nothing opted in", () => {
    const noNote = sharePayloadFrom({ t1: 88.2, t2: 79.5, t3: 5, t4: 4 }, "Merit", {
      instrument: "ailx 2026.1",
      sections: { ...ALL_SHARE_SECTIONS, note: false, process: false, completed: false, site: false },
    });
    expect(texts(shareCardElement(noNote)).join(" ")).toContain(noNote.profile!.strengths[0]);
    const bare = texts(shareCardElement(payload)).join(" ");
    expect(bare).not.toContain("min on task");
  });


  it("draws the four-track shape as bars, not only as numbers", () => {
    const widths = barFillWidths(shareCardElement(payload));
    // One fill per track, each proportional to that track's 0-100 value.
    expect(widths).toEqual(["88.2%", "79.5%", "71.1%", "66.9%"]);
  });

  it("keeps a bar visible at zero and never past full", () => {
    const edge = sharePayloadFrom({ t1: 0, t2: 100, t3: 0.4, t4: 50 }, "Pass", {
      instrument: "ailx 2026.1",
      sections: { profile: false, process: false, completed: false, site: false, note: false },
    });
    expect(barFillWidths(shareCardElement(edge))).toEqual(["2%", "100%", "2%", "50%"]);
  });

  describe("the card is a fixed 630px box, so long text must not push the footer off it", () => {
    it("clampLine keeps short text untouched", () => {
      expect(clampLine("I built a co-op site.", 150)).toBe("I built a co-op site.");
      expect(clampLine("exactly-ten", 11)).toBe("exactly-ten");
    });

    it("clampLine cuts on a word boundary and marks the cut", () => {
      const out = clampLine("alpha bravo charlie delta echo foxtrot", 20);
      expect(out).toBe("alpha bravo charlie\u2026");
      expect(out.length).toBeLessThanOrEqual(20);
    });

    it("clampLine falls back to a hard cut when one word fills the budget", () => {
      const out = clampLine("a".repeat(60), 20);
      expect(out).toBe(`${"a".repeat(19)}\u2026`);
      expect(out.length).toBe(20);
    });

    it("clamps a maximum-length note before it can overflow the card", () => {
      const long = sharePayloadFrom({ t1: 88.2, t2: 79.5, t3: 5, t4: 4 }, "Merit", {
        instrument: "ailx 2026.1",
        sections: ALL_SHARE_SECTIONS,
        completedOn: "2026-02-03",
        // The server accepts SHARE_NOTE_MAX (240) characters; the card cannot
        // draw that many, so it must shorten rather than clip mid-glyph.
        note: "word ".repeat(48).trim(),
        process: { totalActiveSeconds: 1800, tracks: [] },
      });
      const drawn = texts(shareCardElement(long));
      const highlight = drawn.find((t) => t.startsWith("word word"))!;
      expect(highlight.length).toBeLessThanOrEqual(150);
      expect(highlight.endsWith("\u2026")).toBe(true);
    });

    it("bounds the box as well as the string, for text that is wide but short", () => {
      // A CJK note is far wider per character than Latin, so the character
      // budget alone cannot save it: satori must clamp the rendered lines too.
      const withNote = sharePayloadFrom({ t1: 1, t2: 2, t3: 3, t4: 4 }, "Pass", {
        instrument: "ailx 2026.1",
        sections: ALL_SHARE_SECTIONS,
        note: "\u5b9f\u969b\u306b\u81ea\u5206\u3067\u4f5c\u3063\u305f\u30b5\u30a4\u30c8\u3067\u3059\u3002",
      });
      // tagline + highlight: the only two slots that carry variable-length text.
      expect(lineClamps(shareCardElement(withNote))).toEqual([2, 2]);
      // With nothing opted in there is no highlight, so only the tagline.
      expect(lineClamps(shareCardElement(payload))).toEqual([2]);
    });
    it("never lets the footnote row wrap — a second line falls off the 630px box", () => {
      // Rasterized at 1200x630, three footnotes with a THREE-digit minute
      // count are wider than the content box: with `flexWrap: "wrap"` the row
      // became two lines and "· built a site" was cut in half at the bottom
      // edge. Structural, because the pixel is only reachable by rendering.
      const wide = sharePayloadFrom({ t1: 88.2, t2: 79.5, t3: 5, t4: 4 }, "Merit", {
        instrument: "ailx 2026.1",
        sections: ALL_SHARE_SECTIONS,
        site: "/api/site/sha256:abc/index.html",
        completedOn: "2026-02-03",
        note: "word ".repeat(48).trim(),
        process: { totalActiveSeconds: 6000, tracks: [] },
      });
      const drawn = texts(shareCardElement(wide)).join(" ");
      expect(drawn).toContain("100 min on task");
      expect(drawn).toContain("built a site");
      expect(flexWraps(shareCardElement(wide))).not.toContain("wrap");
    });
  });

  it("is deterministic for a given payload", () => {
    expect(texts(shareCardElement(payload))).toEqual(texts(shareCardElement(payload)));
  });

  it("uses the shipped :root tokens — no second palette", () => {
    const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
    const token = (name: string) =>
      css.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{3,8});`))?.[1]?.toLowerCase();
    for (const [key, value] of Object.entries(SHARE_CARD_COLORS)) {
      expect(token(key), `--${key}`).toBe(value.toLowerCase());
    }
  });

  it("is sized for the OG/Twitter 1.91:1 slot", () => {
    expect(SHARE_CARD_WIDTH).toBe(1200);
    expect(SHARE_CARD_HEIGHT).toBe(630);
  });

  it("rasterizes to a real PNG through next/og — no network, no new dependency", async () => {
    const { ImageResponse } = await import("next/og");
    const res = new ImageResponse(shareCardElement(payload), {
      width: SHARE_CARD_WIDTH,
      height: SHARE_CARD_HEIGHT,
    });
    const bytes = new Uint8Array(await res.arrayBuffer());
    // PNG magic: 89 'P' 'N' 'G'.
    expect([...bytes.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    expect(bytes.byteLength).toBeGreaterThan(2000);
  }, 30_000);

  it("draws the player-type character when one was loaded, and nothing when not", () => {
    const face = imgs(shareCardElement(payload, "data:image/jpeg;base64,AAAA"));
    expect(face).toHaveLength(1);
    expect(face[0].src).toBe("data:image/jpeg;base64,AAAA");
    expect(face[0].width).toBe(200);
    // Without a portrait the card is still a whole card — the code, the name
    // and the tagline are text on it, so a CDN hiccup costs charm, not sense.
    expect(imgs(shareCardElement(payload, null))).toEqual([]);
    expect(texts(shareCardElement(payload, null))).toContain(payload.playerType.name);
  });

  it("rasterizes a REAL character asset — proof the shipped format is one satori can draw", async () => {
    const { ImageResponse } = await import("next/og");
    const character = playerCharacter(payload.playerType.code)!;
    const bytes = readFileSync(new URL(`../public/${character.src}`, import.meta.url));
    const res = new ImageResponse(
      shareCardElement(payload, `data:image/jpeg;base64,${bytes.toString("base64")}`),
      { width: SHARE_CARD_WIDTH, height: SHARE_CARD_HEIGHT },
    );
    const out = new Uint8Array(await res.arrayBuffer());
    expect([...out.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    // A card WITH a portrait is meaningfully bigger than one without: proof
    // the picture landed rather than being silently dropped.
    const plain = new Uint8Array(
      await new ImageResponse(shareCardElement(payload), {
        width: SHARE_CARD_WIDTH, height: SHARE_CARD_HEIGHT,
      }).arrayBuffer(),
    );
    expect(out.byteLength).toBeGreaterThan(plain.byteLength + 5000);
  }, 60_000);
});
