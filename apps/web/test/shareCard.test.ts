/**
 * The social preview is load-bearing: a paste with no preview does not
 * spread. So this suite proves three things — the card really rasterizes to
 * a PNG, it contains the values from the frozen payload, and its colours are
 * the shipped design tokens rather than a second palette that will drift.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { isValidElement } from "react";
import { sharePayloadFrom } from "@ailx/report";
import {
  SHARE_CARD_COLORS,
  SHARE_CARD_HEIGHT,
  SHARE_CARD_WIDTH,
  shareCardElement,
} from "../lib/shareCardArt";

const payload = sharePayloadFrom(
  { t1: 88.2, t2: 79.5, t3: 71.1, t4: 66.9 },
  "Distinction",
  { instrument: "ailx 2026.1" },
);

/** Flatten the element tree to the strings it will draw. */
function texts(node: unknown, out: string[] = []): string[] {
  if (typeof node === "string" || typeof node === "number") out.push(String(node));
  else if (Array.isArray(node)) node.forEach((n) => texts(n, out));
  else if (isValidElement(node)) texts((node.props as { children?: unknown }).children, out);
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
});
