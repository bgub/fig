import { expect, type Page, test } from "@playwright/test";

// The resource-model path (docs/plans/serialized-components.md phase 3): a
// serialized post delivered through payloadDataLoader + readData, refreshed
// with the ordinary freshness verbs — no PayloadBoundary, no refresh header.

test("streams a serialized post as a data resource with progressive holes and islands", async ({
  page,
}) => {
  const errors = collectBrowserErrors(page);
  const payloadRequests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/resource-payload") {
      payloadRequests.push(request.url());
    }
  });

  await page.goto("/", { waitUntil: "commit" });
  await expect(page.locator("body")).toHaveAttribute(
    "data-fig-resource-demo",
    "ready",
  );

  // Root row reveals the post while the comments hole is still streaming.
  const post = page.locator("[data-resource-seed]");
  await expect(post).toHaveAttribute("data-resource-seed", "1");
  await expect(
    page.locator('[data-resource-comments="pending"]'),
  ).toBeVisible();
  await expect(page.locator("[data-resource-audit]")).toContainText(
    "read on the server",
  );

  // The hole fills in the background after the root value published.
  await expect(page.locator('[data-resource-comments="ready"]')).toContainText(
    "First comment 1",
  );

  // The island decoded from the stream is interactive client state.
  const island = page.locator('[data-like-island="post-1"]');
  await expect(island).toHaveText("Like (0)");
  await island.click();
  await island.click();
  await expect(island).toHaveText("Like (2)");

  // Data rows from the same response hydrated the isomorphic summary entry:
  // one request served the post, its server data, and the shared summary.
  await expect(page.locator("[data-resource-summary]")).toContainText(
    "hydrated into the",
  );
  expect(payloadRequests).toHaveLength(1);
  expect(errors()).toEqual([]);
});

test("refreshes the post resource in a transition, keeping previous content visible", async ({
  page,
}) => {
  const errors = collectBrowserErrors(page);

  await page.goto("/", { waitUntil: "commit" });
  const post = page.locator("[data-resource-seed]");
  await expect(post).toHaveAttribute("data-resource-seed", "1");
  await expect(page.locator('[data-resource-comments="ready"]')).toBeVisible();
  const summaryBefore = await page
    .locator("[data-resource-summary]")
    .textContent();

  const refresh = page.locator("[data-resource-refresh]");
  await refresh.click();

  // While the refresh is pending the previous tree stays visible — the
  // island keeps its identity and the post never falls back to "Loading".
  await expect(refresh).toHaveAttribute("data-refresh-state", "pending");
  await expect(post).toBeVisible();
  await expect(page.locator('[data-resource-state="loading"]')).toHaveCount(0);

  await expect(refresh).toHaveAttribute("data-refresh-state", "idle");
  await expect(post).toHaveAttribute("data-resource-seed", "1");
  await expect(page.locator('[data-resource-comments="ready"]')).toContainText(
    "First comment 1",
  );
  // Cross-key freshening: the refreshed response's data rows re-hydrated the
  // summary entry (the server-side load counter moved), with no extra
  // request beyond the payload stream itself.
  await expect(page.locator("[data-resource-summary]")).not.toHaveText(
    summaryBefore ?? "",
  );
  expect(errors()).toEqual([]);
});

test("refreshing while comments are still streaming shows no error", async ({
  page,
}) => {
  const errors = collectBrowserErrors(page);

  await page.goto("/", { waitUntil: "commit" });
  await expect(page.locator('[data-resource-comments="ready"]')).toBeVisible();

  // Navigate, then refresh while the new post's comments hole is streaming —
  // the previously reported repro for "Payload decode aborted" in the
  // error boundary.
  await page.locator('[data-resource-nav="next"]').click();
  const post = page.locator("[data-resource-seed]");
  await expect(post).toHaveAttribute("data-resource-seed", "2");
  await expect(
    page.locator('[data-resource-comments="pending"]'),
  ).toBeVisible();
  await page.locator("[data-resource-refresh]").click();

  // The visible tree stays alive through the refresh; no error boundary.
  await expect(page.locator("[data-resource-error]")).toHaveCount(0);
  await expect(post).toBeVisible();

  await expect(page.locator("[data-resource-refresh]")).toHaveAttribute(
    "data-refresh-state",
    "idle",
  );
  await expect(page.locator('[data-resource-comments="ready"]')).toContainText(
    "First comment 2",
  );
  await expect(page.locator("[data-resource-error]")).toHaveCount(0);
  expect(errors()).toEqual([]);
});

test("navigates between posts by key and recovers from a failed post", async ({
  page,
}) => {
  const errors = collectBrowserErrors(page);

  await page.goto("/", { waitUntil: "commit" });
  const post = page.locator("[data-resource-seed]");
  await expect(post).toHaveAttribute("data-resource-seed", "1");

  // A new key is a new resource entry: ordinary suspend-then-reveal.
  await page.locator('[data-resource-nav="next"]').click();
  await expect(post).toHaveAttribute("data-resource-seed", "2");
  await expect(page.locator('[data-resource-comments="ready"]')).toContainText(
    "First comment 2",
  );
  await expect(page.locator('[data-like-island="post-2"]')).toBeVisible();

  // Pre-root failure: the loader rejects, the boundary shows the failure.
  await page.locator('[data-resource-nav="broken"]').click();
  await expect(page.locator("[data-resource-error]")).toContainText(
    "Post failed to load",
  );

  // Recovery: navigating back to a good key remounts and re-reads.
  await page.locator('[data-resource-nav="first"]').click();
  await expect(post).toHaveAttribute("data-resource-seed", "1");
  await expect(page.locator('[data-resource-comments="ready"]')).toBeVisible();
  // The deliberate 500 logs the browser's own network error; nothing else may.
  expect(
    errors().filter((message) => !message.includes("status of 500")),
  ).toEqual([]);
});

function collectBrowserErrors(page: Page): () => string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => {
    errors.push(String(error));
  });
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  return () => errors;
}
