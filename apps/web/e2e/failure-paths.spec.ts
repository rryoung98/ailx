import { expect, logInTrack, seedRun, test } from "./fixtures";

/**
 * Error and offline paths (FRONTEND.md §6.4.6).
 *
 * Both failures below are OURS or the network's, never the candidate's, and
 * a timed exam may not answer either with a dead end: every terminal state
 * asserted here is one the candidate can act on.
 */

const OPENROUTER = "https://openrouter.ai/**";

test.describe("T1 failure paths", () => {
  test("a failed model call offers retry and an offline assist", async ({ page, devUser, attemptId }) => {
    await page.route(OPENROUTER, (route) => route.abort("failed"));
    await seedRun(page, devUser, {
      attemptId,
      log: logInTrack(attemptId, "t1"),
      modelKey: "sk-e2e-not-a-real-key",
    });
    await page.goto("/exam");

    await page.getByLabel("Assist prompt").fill("add a project grid");
    await page.keyboard.press("Enter");

    // The dead end would be a spinner that never resolves, or a thrown
    // promise the candidate cannot see. Instead: a stated failure and two
    // ways forward.
    const failure = page.getByRole("alert").filter({ hasText: "model endpoint" });
    await expect(failure).toBeVisible();
    await expect(failure.getByRole("button", { name: "Retry" })).toBeVisible();
    const offline = failure.getByRole("button", { name: "Use the offline demo assist" });
    await expect(offline).toBeVisible();

    // The prompt is not lost: the fallback answers the SAME prompt, and the
    // candidate's build continues.
    await offline.click();
    const conversation = page.getByRole("log", { name: "AI assist conversation" });
    await expect(conversation.getByText("add a project grid").first()).toBeVisible();
    await expect(conversation.getByText("demo assist")).toBeVisible();
  });

  test("an offline site upload says so, keeps the run, and retries clean", async ({
    page,
    devUser,
    attemptId,
  }) => {
    await seedRun(page, devUser, { attemptId, log: logInTrack(attemptId, "t1") });
    await page.goto("/exam");
    await page.getByRole("tab", { name: "Code" }).click();
    await page.getByLabel("HTML editor").fill(
      `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>site</title></head>` +
        `<body><h1>offline retry</h1></body></html>`,
    );

    await page.context().setOffline(true);
    // Submitting is a two-step act: the first press ARMS the finish step
    // (one stray click used to end the track and forfeit the clock), the
    // second confirms inside it.
    await page.getByRole("button", { name: "Submit final artifact" }).click();
    await page.getByRole("button", { name: "Yes, submit final artifact" }).click();

    // Stated, not swallowed — and the track itself is still complete and
    // scored, so no response was dropped on the floor.
    const notice = page.getByRole("status").filter({ hasText: "Could not publish" });
    await expect(notice).toBeVisible();
    await expect(page.getByRole("heading", { name: "1 of 4 tracks complete" })).toBeVisible();

    await page.context().setOffline(false);
    await notice.getByRole("button", { name: "Retry upload" }).click();

    // Terminal state: the same run, now published, with a link the candidate
    // can actually open.
    await expect(page.getByRole("link", { name: /open your site/i })).toBeVisible();
  });
});
