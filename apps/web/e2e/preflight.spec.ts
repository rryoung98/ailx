import { expect, test } from "@playwright/test";
import { BROWSER_REQUEST_HEADERS, apiPath } from "@ailx/contract";
import { REQUIRES_SERVICE, apiRoot, hasExamService } from "./service";

/**
 * THE PREFLIGHT (FRONTEND.md §6.4.6).
 *
 * The frontend and the exam service are two origins, so every call the app
 * makes is preflighted. A header the service does not name in
 * `Access-Control-Allow-Headers` is not stripped from the request — the
 * request is never sent, and the app sees "Failed to fetch" with nothing in
 * it. A whole hosted deployment can be dead this way while both halves pass
 * their own tests.
 *
 * That is what happened on 2026-09-03: the browser started sending a W3C
 * `traceparent` on every service call, the service still allowed four
 * hard-coded names, and every seeded spec in this suite failed ten minutes
 * later at a locator, naming nothing. This spec asks the question directly,
 * in one round trip, so the next drift is reported as what it is.
 *
 * `BROWSER_REQUEST_HEADERS` is the list, and it is CONTRACT: the private repo
 * vendors this package byte for byte, so the two halves cannot disagree about
 * it without failing here.
 */

test.skip(!hasExamService(), REQUIRES_SERVICE);

test("the exam service allows every header this browser sends", async ({ request, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  const res = await request.fetch(`${apiRoot()}${apiPath("createAttempt")}`, {
    method: "OPTIONS",
    headers: {
      origin,
      "access-control-request-method": "POST",
      "access-control-request-headers": BROWSER_REQUEST_HEADERS.join(","),
    },
  });

  // A preflight answers 2xx and no body; anything else and the browser stops.
  expect(res.status(), await res.text()).toBeLessThan(300);

  const headers = res.headers();
  // The frontend under test must be an allowed origin, or every seeded spec
  // below dies in CORS for a reason no locator can express.
  expect(headers["access-control-allow-origin"]).toBe(origin);

  const allowed = (headers["access-control-allow-headers"] ?? "")
    .split(",")
    .map((name) => name.trim().toLowerCase())
    .filter((name) => name !== "");
  const refused = BROWSER_REQUEST_HEADERS.filter((name) => !allowed.includes(name));
  expect({ refused, allowed }).toEqual({ refused: [], allowed });

  // POST is what a seeded run is created with; a GET-only allowance would
  // pass the header check and still fail every fixture.
  const methods = (headers["access-control-allow-methods"] ?? "").toLowerCase();
  expect(methods).toContain("post");
});
