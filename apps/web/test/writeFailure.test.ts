import { describe, expect, it } from "vitest";
import { mayRetry, type WriteFailure } from "../features/report/writeFailure";

/**
 * WHETHER THE BUTTON COMES BACK, WHICH IS THE ONE FACT A PANEL NEEDS THAT A
 * PAGE DOES NOT.
 *
 * `writeFailure.ts` shipped with no test of its own: `mayRetry` decided whether
 * a candidate is offered another press, and nothing pinned it. The gap was
 * found by an adversarial review of the PR that introduced it, not by a
 * failure — which is the only way an untested predicate is ever found.
 */
describe("mayRetry", () => {
  const refused = (status: number): WriteFailure => ({ kind: "refused", status });

  it("offers another press only where the answer can change", () => {
    // A refusal that EXPIRES, the service's own timeout, and the service
    // failing rather than refusing.
    expect(mayRetry(refused(429)), "429 expires").toBe(true);
    expect(mayRetry(refused(408)), "the service timed out").toBe(true);
    expect(mayRetry(refused(500)), "the service failed").toBe(true);
    expect(mayRetry(refused(503)), "the service failed").toBe(true);
  });

  it("does not offer a retry for a settled answer about this request", () => {
    for (const status of [400, 401, 403, 404, 409, 422]) {
      expect(mayRetry(refused(status)), `${status} is settled`).toBe(false);
    }
  });

  it("retries a timeout and an unreachable service, because the world may differ", () => {
    expect(mayRetry({ kind: "timeout" })).toBe(true);
    expect(mayRetry({ kind: "unreachable" })).toBe(true);
  });

  /**
   * THE ONE THAT DISAGREED WITH ITS OWN COPY.
   *
   * `unreadable` is a 2xx whose body is the wrong SHAPE — a deployment
   * disagreeing with this build. The sentence beside the button says "that is
   * our bug, not your connection", and `mayRetry` returned TRUE for it, so the
   * panel invited a candidate to re-press a request that returns the same body
   * until someone ships. A shape does not change a second later; the world
   * does, which is why `timeout` and `unreachable` above still do.
   */
  it("does not offer a retry for an unreadable body, which its copy already calls our bug", () => {
    expect(mayRetry({ kind: "unreadable" })).toBe(false);
  });
});
