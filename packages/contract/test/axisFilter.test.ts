/**
 * THE AXIS FILTER GRAMMAR — one test per refusal, because the rule is REJECT,
 * NEVER NORMALISE (docs/ADR-profile-and-type.md §9, TEN-107).
 *
 * A re-sorted query, a duplicated track, a lowercase letter or a letter from
 * the wrong axis are all 400s rather than repairs. Two spellings of one filter
 * is how a browser grows a private vocabulary, and it is how a link somebody
 * shared stops being the link the service reads.
 */
import { describe, expect, it } from "vitest";
import { AXES } from "@ailx/report";

import {
  AXIS_LETTERS,
  AXIS_TRACKS,
  axisFilterString,
  emptyAxisFilter,
  galleryQueryString,
  isEmptyAxisFilter,
  parseAxisFilter,
  parseGalleryQuery,
} from "../src/gallery.js";

const ok = (raw: Record<string, string | undefined>) => {
  const result = parseGalleryQuery(raw);
  if (!result.ok) throw new Error(`refused: ${result.message}`);
  return result.query;
};

const refused = (raw: Record<string, string | undefined>): string => {
  const result = parseGalleryQuery(raw);
  if (result.ok) throw new Error(`accepted, and should not have: ${JSON.stringify(raw)}`);
  return result.message;
};

describe("the axis vocabulary", () => {
  it("is the report's own poles, not a second list of letters", () => {
    expect(AXIS_TRACKS).toEqual(["t1", "t2", "t3", "t4"]);
    for (const axis of AXES) {
      expect(AXIS_LETTERS[axis.track]).toEqual([axis.hi.letter, axis.lo.letter]);
    }
    expect(AXIS_LETTERS.t1).toEqual(["M", "P"]);
    expect(AXIS_LETTERS.t2).toEqual(["S", "T"]);
    expect(AXIS_LETTERS.t3).toEqual(["V", "A"]);
    expect(AXIS_LETTERS.t4).toEqual(["D", "E"]);
  });

  it("starts empty, and says so", () => {
    expect(isEmptyAxisFilter(emptyAxisFilter())).toBe(true);
    expect(axisFilterString(emptyAxisFilter())).toBe("");
  });
});

describe("parseAxisFilter accepts", () => {
  it("one entry, and four in ascending order", () => {
    expect(parseAxisFilter("t2:S")).toEqual({
      ok: true,
      query: { ...emptyAxisFilter(), t2: "S" },
    });
    expect(parseAxisFilter("t1:M,t2:S,t3:V,t4:D")).toEqual({
      ok: true,
      query: { t1: "M", t2: "S", t3: "V", t4: "D" },
    });
  });

  it("both letters of every axis, and no letter of another one", () => {
    for (const track of AXIS_TRACKS) {
      for (const letter of AXIS_LETTERS[track]) {
        expect(parseAxisFilter(`${track}:${letter}`).ok).toBe(true);
      }
      const foreign = AXIS_TRACKS.filter((t) => t !== track).flatMap((t) => [...AXIS_LETTERS[t]]);
      for (const letter of foreign) {
        if ((AXIS_LETTERS[track] as readonly string[]).includes(letter)) continue;
        expect(parseAxisFilter(`${track}:${letter}`).ok).toBe(false);
      }
    }
  });
});

describe("parseGalleryQuery REFUSES", () => {
  /** Every row here is a 400 named in the ADR. None of them is repaired. */
  const REFUSALS: readonly { readonly why: string; readonly raw: Record<string, string> }[] = [
    { why: "descending tracks are not re-sorted", raw: { axis: "t2:S,t1:M" } },
    { why: "a duplicated track is not a union", raw: { axis: "t1:M,t1:P" } },
    { why: "a letter from the wrong axis", raw: { axis: "t1:S" } },
    { why: "a lowercase letter is not upcased", raw: { axis: "t1:m" } },
    { why: "an unknown track", raw: { axis: "t9:M" } },
    { why: "an empty value", raw: { axis: "" } },
    { why: "a trailing comma", raw: { axis: "t1:M," } },
    { why: "a leading comma", raw: { axis: ",t1:M" } },
    { why: "whitespace", raw: { axis: "t1:M, t2:S" } },
    { why: "more entries than tracks", raw: { axis: "t1:M,t2:S,t3:V,t4:D,t4:E" } },
    { why: "no colon", raw: { axis: "t1M" } },
    { why: "a bare track", raw: { axis: "t1" } },
    { why: "two letters", raw: { axis: "t1:MP" } },
    { why: "type and axis together", raw: { type: "MSVD", axis: "t1:M" } },
    { why: "decided with nothing to be decided about", raw: { decided: "1" } },
    { why: "decided=0, because a default is written by omission", raw: { axis: "t1:M", decided: "0" } },
    { why: "decided=true", raw: { axis: "t1:M", decided: "true" } },
    { why: "held=current", raw: { held: "current" } },
    { why: "held=ever", raw: { held: "ever" } },
    { why: "held at all, even empty", raw: { held: "" } },
  ];

  it.each(REFUSALS)("$why", ({ raw }) => {
    expect(refused(raw).length).toBeGreaterThan(0);
  });

  /**
   * `held` is the ONE unknown parameter that is refused rather than ignored,
   * and the exception is deliberate: a gallery link with `?utm_source=` on the
   * end must still open the gallery.
   */
  it("still ignores a parameter it does not act on", () => {
    expect(ok({ utm_source: "x", axis: "t1:M" }).axis.t1).toBe("M");
  });
});

describe("parseGalleryQuery accepts", () => {
  it("an axis filter, ANDed across tracks", () => {
    expect(ok({ axis: "t1:M,t3:A" }).axis).toEqual({ ...emptyAxisFilter(), t1: "M", t3: "A" });
  });

  it("decided=1 beside a filter, and only beside one", () => {
    expect(ok({ axis: "t2:S", decided: "1" }).decided).toBe(true);
    expect(ok({ type: "MSVD", decided: "1" }).decided).toBe(true);
    expect(ok({ axis: "t2:S" }).decided).toBe(false);
  });

  it("still accepts the code spelling that shipped first", () => {
    const query = ok({ type: "MSVD" });
    expect(query.type).toBe("MSVD");
    expect(isEmptyAxisFilter(query.axis)).toBe(true);
  });
});

describe("galleryQueryString", () => {
  const parse = (qs: string) =>
    parseGalleryQuery(Object.fromEntries(new URLSearchParams(qs.replace(/^\?/, ""))));

  it("writes the axis in ascending track order, always", () => {
    const query = ok({ axis: "t1:M,t4:E" });
    expect(galleryQueryString(query)).toBe("?axis=t1%3AM%2Ct4%3AE");
    expect(galleryQueryString({ ...query, axis: { t4: "E", t3: null, t2: null, t1: "M" } })).toBe(
      "?axis=t1%3AM%2Ct4%3AE",
    );
  });

  it("omits an empty filter and an unset decided, and round-trips the rest", () => {
    for (const raw of [
      {},
      { axis: "t2:S" },
      { axis: "t1:M,t2:T,t3:V,t4:E" },
      { axis: "t3:A", decided: "1" },
      { axis: "t2:S", sort: "oldest", site: "1", limit: "48", offset: "48" },
      { type: "PTAE", decided: "1" },
    ]) {
      const first = parseGalleryQuery(raw);
      if (!first.ok) throw new Error(`${JSON.stringify(raw)}: ${first.message}`);
      const written = galleryQueryString(first.query);
      if (raw.axis === undefined) expect(written).not.toContain("axis");
      if (raw.decided === undefined) expect(written).not.toContain("decided");
      const again = parse(written);
      expect({ raw, ok: again.ok }).toEqual({ raw, ok: true });
      if (again.ok) expect(again.query).toEqual(first.query);
    }
  });
});
