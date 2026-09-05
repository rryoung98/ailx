/**
 * SHARE TEXT — the words that leave with a link.
 *
 * Three promises are asserted here, because all three are public-facing:
 * the copy carries the identity hook, it never carries a number that reads
 * as certification (docs/POSITIONING.md), and it can only ever say what the
 * allowlisted payload already says (docs/SHARING.md §1).
 */
import { describe, expect, it } from "vitest";
import {
  ALL_SHARE_SECTIONS,
  CHARACTER_CAST,
  SHARE_NETWORKS,
  SHARE_NETWORK_LABEL,
  X_TEXT_MAX,
  clampShareText,
  playerCharacter,
  shareCopyParts,
  shareIntentUrl,
  sharePayloadFrom,
  shareText,
  shareTextViolations,
  shareTitle,
  withArticle,
  type SharePayload,
  type ShareChannel,
  type SharePerspective,
} from "../src/index.js";

const URL_UNDER_TEST = "https://ailx.example/s/" + "a".repeat(43);

function payload(over: Partial<SharePayload> = {}): SharePayload {
  return {
    ...sharePayloadFrom({ t1: 88.2, t2: 79.5, t3: 71.1, t4: 66.9 }, "Distinction", {
      instrument: "ailx 2026.1",
      sections: ALL_SHARE_SECTIONS,
      site: "/api/site/abc123/index.html",
      note: "I built a portfolio for a bike-repair co-op.",
      completedOn: "2026-08-30",
    }),
    ...over,
  };
}

const CHANNELS: ShareChannel[] = ["x", "linkedin", "whatsapp", "native"];
const PERSPECTIVES: SharePerspective[] = ["mine", "theirs"];

/** Every string this module can produce for one payload. */
function everyText(p: SharePayload): string[] {
  return CHANNELS.flatMap((c) => PERSPECTIVES.map((v) => shareText(p, c, v)));
}

describe("the identity hook", () => {
  it("names the type, the code and the character on every channel", () => {
    const p = payload();
    const character = playerCharacter(p.playerType.code);
    expect(character, "fixture must land on a code with a drawing").not.toBeNull();
    for (const text of everyText(p)) {
      expect(text).toContain(p.playerType.name);
      expect(text.toLowerCase()).toContain(character!.slug.replace(/-/g, " "));
    }
    // The code travels on the surfaces where it reads as a handle, not in the
    // chatty one-liner.
    expect(shareText(p, "x")).toContain(p.playerType.code);
    expect(shareText(p, "linkedin")).toContain(p.playerType.code);
  });

  it("degrades to name-only for a payload whose code has no drawing", () => {
    const p = payload();
    const orphan = { ...p, playerType: { ...p.playerType, code: "ZZZZ" } };
    expect(shareCopyParts(orphan).character).toBeNull();
    for (const text of everyText(orphan)) {
      expect(text).toContain(orphan.playerType.name);
      expect(text).not.toContain("the ,");
      expect(text).not.toContain("null");
      expect(text).not.toContain("undefined");
      expect(text.trim()).not.toBe("");
    }
  });

  it("titles the OS sheet with the type, never with a bare URL", () => {
    const p = payload();
    expect(shareTitle(p)).toBe(`${p.playerType.name} (${p.playerType.code}) — Foray player type`);
  });
});

describe("per-network voice", () => {
  const p = payload();

  it("keeps X inside the budget a t.co link leaves", () => {
    expect(shareText(p, "x").length).toBeLessThanOrEqual(X_TEXT_MAX);
    // …including for the longest cast name and the longest legal note.
    for (const c of CHANNELS) void c;
    for (const character of CHARACTER_CAST) {
      const long = {
        ...p,
        note: "n".repeat(240),
        playerType: {
          ...p.playerType,
          code: character.code,
          name: "A very long player type name for stress",
          tagline: "A tagline that keeps going and going and going and going and going and going.",
        },
      };
      const text = shareText(long, "x");
      expect(text.length, character.code).toBeLessThanOrEqual(X_TEXT_MAX);
      expect(text.endsWith("…") || text.endsWith(":")).toBe(true);
    }
  });

  it("writes LinkedIn as paragraphs about a completed run, not a result", () => {
    const text = shareText(p, "linkedin");
    expect(text.split("\n\n").length).toBeGreaterThanOrEqual(3);
    expect(text).toContain("no ranking, no number");
    expect(text.length).toBeGreaterThan(shareText(p, "whatsapp").length);
  });

  it("writes WhatsApp as one casual line", () => {
    const text = shareText(p, "whatsapp");
    expect(text).not.toContain("\n");
    expect(text.toLowerCase()).toContain("see which one you get");
  });

  it("switches person: a reader passing a link on never claims the card", () => {
    for (const c of CHANNELS) {
      expect(shareText(p, c, "mine")).not.toBe(shareText(p, c, "theirs"));
      expect(/\b(I|my)\b/i.test(shareText(p, c, "theirs"))).toBe(false);
    }
    expect(/\b(I|My)\b/.test(shareText(p, "whatsapp", "mine"))).toBe(true);
  });

  it("mentions the built site only when the site really rode along", () => {
    const withSite = shareText(p, "linkedin");
    const withoutSite = shareText({ ...p, site: null }, "linkedin");
    expect(withSite).toContain("site I built");
    expect(withoutSite.toLowerCase()).not.toContain("site");
    expect(shareText({ ...p, site: null }, "whatsapp", "theirs").toLowerCase()).not.toContain(
      "site",
    );
  });
});

describe("honesty — no number that reads as certification", () => {
  const cases: SharePayload[] = [
    payload(),
    payload({ site: null, note: null, profile: null, process: null, completedOn: null }),
    ...(["Distinction", "Merit", "Pass", "Developing"] as const).map((band) => payload({ band })),
  ];

  it("never leaks the band, a track number, a percentile or a grade", () => {
    for (const p of cases) {
      for (const text of everyText(p)) {
        expect(shareTextViolations(text), text).toEqual([]);
        expect(text).not.toContain(p.band);
        for (const v of Object.values(p.tracks)) {
          expect(text).not.toContain(v.toFixed(1));
          expect(text).not.toContain(String(Math.round(v)));
        }
      }
    }
  });

  it("never leaks a non-allowlisted field, an id or the token", () => {
    const p = payload();
    for (const text of [...everyText(p), ...SHARE_NETWORKS.map((n) => shareIntentUrl(n, p, URL_UNDER_TEST))]) {
      for (const forbidden of ["attempt", "participant", "dPrime", "brier", "itemId", "secret"]) {
        expect(text.toLowerCase()).not.toContain(forbidden.toLowerCase());
      }
    }
    // The candidate's own note is theirs to publish on the card, but it is not
    // pasted into a social composer they did not write.
    expect(everyText(payload()).join(" ")).not.toContain("bike-repair co-op");
  });
});

describe("intent URLs", () => {
  const p = payload();

  it("builds one properly encoded target per network, with the link exactly once", () => {
    for (const network of SHARE_NETWORKS) {
      const raw = shareIntentUrl(network, p, URL_UNDER_TEST);
      const url = new URL(raw);
      expect(url.protocol).toBe("https:");
      expect(raw.split(encodeURIComponent(URL_UNDER_TEST)).length - 1).toBe(1);
      // Round-trips: nothing is double-encoded and no space survives raw.
      expect(raw).not.toMatch(/[ \n]/);
      expect(decodeURIComponent(raw)).toContain(p.playerType.name);
    }
  });

  it("sends X the text and the url as separate parameters", () => {
    const url = new URL(shareIntentUrl("x", p, URL_UNDER_TEST));
    expect(url.hostname).toBe("x.com");
    expect(url.pathname).toBe("/intent/post");
    expect(url.searchParams.get("url")).toBe(URL_UNDER_TEST);
    expect(url.searchParams.get("text")).toBe(shareText(p, "x"));
  });

  it("uses the LinkedIn feed composer, the only one that still keeps our words", () => {
    const url = new URL(shareIntentUrl("linkedin", p, URL_UNDER_TEST));
    expect(url.hostname).toBe("www.linkedin.com");
    expect(url.searchParams.get("shareActive")).toBe("true");
    expect(url.searchParams.get("text")).toBe(`${shareText(p, "linkedin")}\n\n${URL_UNDER_TEST}`);
  });

  it("puts the link inside WhatsApp's single text field", () => {
    const url = new URL(shareIntentUrl("whatsapp", p, URL_UNDER_TEST));
    expect(url.hostname).toBe("wa.me");
    expect(url.searchParams.get("text")).toBe(`${shareText(p, "whatsapp")} ${URL_UNDER_TEST}`);
  });

  it("carries the perspective through to the URL", () => {
    const theirs = new URL(shareIntentUrl("x", p, URL_UNDER_TEST, "theirs"));
    expect(theirs.searchParams.get("text")).toBe(shareText(p, "x", "theirs"));
  });

  it("labels every network it can target", () => {
    for (const n of SHARE_NETWORKS) expect(SHARE_NETWORK_LABEL[n].length).toBeGreaterThan(0);
  });
});

describe("withArticle", () => {
  it("leaves a name that already carries its own article alone", () => {
    expect(withArticle("The Full-Stack Skeptic")).toBe("The Full-Stack Skeptic");
    expect(withArticle("A Careful Builder")).toBe("A Careful Builder");
  });

  it("picks a/an for a bare name", () => {
    expect(withArticle("Cartographer")).toBe("a Cartographer");
    expect(withArticle("Improviser")).toBe("an Improviser");
  });

  it("never doubles an article in a real cast name", () => {
    for (const character of CHARACTER_CAST) {
      const p = payload();
      const named = { ...p, playerType: { ...p.playerType, code: character.code } };
      expect(shareText(named, "whatsapp")).not.toMatch(/\ba (the|an?) /i);
    }
  });
});

describe("clampShareText", () => {
  it("leaves a short string alone", () => {
    expect(clampShareText("short", 20)).toBe("short");
    expect(clampShareText("exactly-ten", 11)).toBe("exactly-ten");
  });

  it("cuts on a word boundary when there is one, and hard when there is not", () => {
    expect(clampShareText("alpha beta gamma delta", 16)).toBe("alpha beta…");
    expect(clampShareText("a".repeat(40), 10)).toBe(`${"a".repeat(9)}…`);
    expect(clampShareText("alpha beta gamma", 12).length).toBeLessThanOrEqual(12);
  });
});
