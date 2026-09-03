import { describe, expect, it } from "vitest";
import {
  AUTHORIZATION_HEADER,
  BROWSER_REQUEST_HEADERS,
  CLIENT_TS_HEADER,
  CONTENT_TYPE_HEADER,
  DEV_USER_HEADER,
  TRACEPARENT_HEADER,
  isAllowedRequestHeader,
} from "../src/index.js";

/**
 * The preflight list, from the side that SENDS.
 *
 * A cross-origin request carrying a header the service does not allow is
 * never sent: the browser fails the preflight and the app sees "Failed to
 * fetch" with nothing in it. On 2026-09-03 the browser began sending
 * `traceparent` while the service's allow-list was typed out separately, and
 * every hosted call died. This list is the single spelling both halves read.
 */
describe("BROWSER_REQUEST_HEADERS", () => {
  it("holds every header the browser puts on a service call", () => {
    expect([...BROWSER_REQUEST_HEADERS].sort()).toEqual(
      [
        CONTENT_TYPE_HEADER,
        AUTHORIZATION_HEADER,
        DEV_USER_HEADER,
        CLIENT_TS_HEADER,
        TRACEPARENT_HEADER,
      ].sort(),
    );
  });

  it("names the identity header from the identity contract, not a copy", () => {
    expect(BROWSER_REQUEST_HEADERS).toContain(DEV_USER_HEADER);
    expect(DEV_USER_HEADER).toBe("x-ailx-dev-user");
  });

  it("is lower case and duplicate-free — a preflight compares case-insensitively", () => {
    for (const name of BROWSER_REQUEST_HEADERS) expect(name).toBe(name.toLowerCase());
    expect(new Set(BROWSER_REQUEST_HEADERS).size).toBe(BROWSER_REQUEST_HEADERS.length);
  });

  it("cannot be extended by a caller — a service reading it gets the whole truth", () => {
    expect(Object.isFrozen(BROWSER_REQUEST_HEADERS)).toBe(true);
    expect(() => (BROWSER_REQUEST_HEADERS as string[]).push("x-ailx-sneaked")).toThrow();
    expect(BROWSER_REQUEST_HEADERS).not.toContain("x-ailx-sneaked");
  });

  it("accepts a header whatever case and padding it arrives in", () => {
    expect(isAllowedRequestHeader("Traceparent")).toBe(true);
    expect(isAllowedRequestHeader(" X-Ailx-Dev-User ")).toBe(true);
    expect(isAllowedRequestHeader("content-type")).toBe(true);
  });

  it("refuses one nobody agreed to", () => {
    expect(isAllowedRequestHeader("x-ailx-new-idea")).toBe(false);
    expect(isAllowedRequestHeader("cookie")).toBe(false);
    expect(isAllowedRequestHeader("")).toBe(false);
  });
});
