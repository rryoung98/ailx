import { expect, logInTrack, seedRun, test } from "./fixtures";
import { SITE_INDEX } from "@ailx/backend";

/**
 * T1 live site — the redirect-loop spec (FRONTEND.md §6.4.4).
 *
 * The dogfood P0 was an INFINITE 308 loop while a unit test happily asserted
 * "a 308 was emitted": a status code is one edge of the redirect graph, and
 * the user-visible outcome is the graph's fixed point. So every assertion
 * here is terminal — the URL the browser SETTLED on plus content the
 * candidate can actually see — and headers are diagnostics only.
 */

const CANONICAL_URL = /\/api\/site\/sha256:[0-9a-f]{64}\/index\.html$/;

test.describe("T1 live site", () => {
  test("the link a candidate sees lands on their rendered page", async ({ page, devUser, attemptId }) => {
    const marker = `candidate site ${attemptId}`;
    await seedRun(page, devUser, { attemptId, log: logInTrack(attemptId, "t1") });
    await page.goto("/exam");

    // Build a site the way a candidate does: through the editor, then submit.
    await page.getByRole("tab", { name: "Code" }).click();
    await page.getByLabel("HTML editor").fill(
      `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>site</title></head>` +
        `<body><h1>${marker}</h1></body></html>`,
    );
    await page.getByRole("button", { name: "Submit final artifact" }).click();

    const link = page.getByRole("link", { name: /open your site/i });
    await expect(link).toBeVisible();

    const [site] = await Promise.all([page.waitForEvent("popup"), link.click()]);
    await site.waitForLoadState("domcontentloaded");

    // Terminal state: the browser settled on the canonical file and the
    // candidate's own content is on screen. A redirect cycle dies here with
    // ERR_TOO_MANY_REDIRECTS instead of passing a per-hop status assertion.
    await expect(site).toHaveURL(CANONICAL_URL);
    await expect(site.getByRole("heading", { name: marker })).toBeVisible();
  });

  test("a bare digest settles on the canonical index with its CSS and JS live", async ({
    page,
    publishSite,
  }) => {
    const { digest, url } = await publishSite([
      {
        path: SITE_INDEX,
        data: Buffer.from(
          `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
            `<link rel="stylesheet" href="style.css"><title>site</title></head>` +
            `<body><h1 id="title">published site</h1><p id="js">js did not run</p>` +
            `<script src="app.js"></script></body></html>`,
        ),
      },
      { path: "style.css", data: Buffer.from("#title { color: rgb(1, 2, 3); }") },
      {
        path: "app.js",
        data: Buffer.from(`document.getElementById("js").textContent = "js ran";`),
      },
    ]);

    // Enter the way a shared link does: at the BARE digest, the form that
    // 308s. One hop only — the trailing-slash form 308s back here.
    const response = await page.goto(`/api/site/${digest}`);

    await expect(page).toHaveURL(CANONICAL_URL);
    expect(new URL(page.url()).pathname).toBe(url);
    await expect(page.getByRole("heading", { name: "published site" })).toBeVisible();

    // Subresources must really load: with a wrong-origin CSP the sandbox's
    // opaque origin matches neither 'self' nor the allowlist, and both of
    // these silently stay in their pre-load state.
    await expect(page.locator("#js")).toHaveText("js ran");
    await expect(page.locator("#title")).toHaveCSS("color", "rgb(1, 2, 3)");

    // Diagnostics (§6.4): never the sole proof, but a regression here is a
    // sandbox escape, so it is pinned too.
    const csp = response?.headers()["content-security-policy"] ?? "";
    expect(csp).toContain("sandbox allow-scripts");
    expect(csp).not.toContain("allow-same-origin");
  });
});
