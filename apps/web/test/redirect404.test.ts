import { describe, expect, it } from "vitest";
import { redirectTarget } from "../lib/redirect404";

describe("404 trailing-slash recovery", () => {
  it("redirects /ailx/exam/ to /ailx/exam, preserving query and hash", () => {
    expect(redirectTarget("/ailx/exam/", "", "")).toBe("/ailx/exam");
    expect(redirectTarget("/ailx/exam/", "?code=x", "#t2")).toBe("/ailx/exam?code=x#t2");
    expect(redirectTarget("/ailx/report///", "", "")).toBe("/ailx/report");
  });
  it("leaves real 404s and roots alone", () => {
    expect(redirectTarget("/ailx/nope", "", "")).toBeNull();
    expect(redirectTarget("/ailx/", "", "")).toBeNull();
    expect(redirectTarget("/", "", "")).toBeNull();
  });
});
