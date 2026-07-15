import { expect, type Page, test } from "@playwright/test";

// The resource-model path (docs/concepts/data.md): a
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
  const devtools = page.locator(".fig-demo-devtools-pane .fig-devtools");
  await expect(devtools).toBeVisible();

  // Root row reveals the post while the comments hole is still streaming.
  // waitFor is event-driven where expect polls on fixed intervals; the
  // pending phase is a ~400ms window that interval polling can straddle.
  await page.locator('[data-resource-comments="pending"]').waitFor();
  const post = page.locator("[data-resource-seed]");
  await expect(post).toHaveAttribute("data-resource-seed", "1");
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
  const advancedTab = devtools.getByRole("tab", { name: "Advanced" });
  await expect(advancedTab).toHaveCSS("border-radius", "0px");
  await advancedTab.hover();
  await expect(advancedTab).toHaveCSS(
    "border-bottom-color",
    "rgba(0, 0, 0, 0)",
  );
  // The default (root) selection lists every store entry, then selecting a
  // component narrows the Data section to its own reads.
  const selectedData = devtools.locator(".fig-devtools__data");
  await expect(
    selectedData.filter({ hasText: '["resource-post",1]' }),
  ).toHaveCount(1);
  await expect(
    selectedData.filter({ hasText: '["resource-dashboard"]' }),
  ).toHaveCount(1);
  await expect(
    selectedData.filter({ hasText: '["resource-weather"]' }),
  ).toHaveCount(1);
  // Every client fiber that reads data keeps its green badge once its layer
  // has streamed in: PostView, DashboardView, and WeatherView (ResourcePost
  // reads on the server, so it has no client fiber). Bailed-out clones used
  // to drop committed reads from the snapshot, flickering badges away as
  // later layers committed.
  await expect(devtools.locator(".fig-devtools__data-count")).toHaveCount(3);
  // The badge count joins the accessible name, so "WeatherView" alone no
  // longer matches exactly.
  const weatherRow = devtools.getByRole("button", { name: /^WeatherView\b/ });
  await expect(weatherRow.locator(".fig-devtools__data-count")).toHaveText("1");
  await expect(weatherRow.locator(".fig-devtools__data-count")).toHaveCSS(
    "background-color",
    "rgb(236, 253, 245)",
  );
  await weatherRow.click();
  await expect(selectedData).toHaveCount(1);
  await expect(selectedData).toContainText('["resource-weather"]');
  await expect(selectedData).not.toContainText('["resource-dashboard"]');
  await expect(selectedData).not.toContainText('["resource-post",1]');
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

  const refresh = page.locator('[data-resource-refresh="post"]');
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
  await page.locator('[data-resource-comments="pending"]').waitFor();
  const post = page.locator("[data-resource-seed]");
  await expect(post).toHaveAttribute("data-resource-seed", "2");
  await page.locator('[data-resource-refresh="post"]').click();

  // The visible tree stays alive through the refresh; no error boundary.
  await expect(page.locator("[data-resource-error]")).toHaveCount(0);
  await expect(post).toBeVisible();

  await expect(page.locator('[data-resource-refresh="post"]')).toHaveAttribute(
    "data-refresh-state",
    "idle",
  );
  await expect(page.locator('[data-resource-comments="ready"]')).toContainText(
    "First comment 2",
  );
  await expect(page.locator("[data-resource-error]")).toHaveCount(0);
  expect(errors()).toEqual([]);
});

test("refreshes each payload slot independently", async ({ page }) => {
  const errors = collectBrowserErrors(page);

  await page.goto("/", { waitUntil: "commit" });
  await expect(page.locator('[data-resource-comments="ready"]')).toBeVisible();
  const weather = page.locator("[data-weather-reading]");
  await expect(weather).toBeVisible();

  const summary = page.locator("[data-resource-summary]");
  const summaryBefore = await summary.textContent();
  const readingBefore = await weather.getAttribute("data-weather-reading");

  // Refreshing the weather resource re-requests only its stream: the
  // reading counter moves while the post's summary stays untouched.
  const refreshWeather = page.locator('[data-resource-refresh="weather"]');
  await refreshWeather.click();
  await expect(refreshWeather).toHaveAttribute("data-refresh-state", "idle");
  await expect(weather).not.toHaveAttribute(
    "data-weather-reading",
    readingBefore ?? "",
  );
  await expect(summary).toHaveText(summaryBefore ?? "");

  // And the other way around: refreshing the post leaves weather alone.
  const readingAfter = await weather.getAttribute("data-weather-reading");
  const refreshPost = page.locator('[data-resource-refresh="post"]');
  await refreshPost.click();
  await expect(refreshPost).toHaveAttribute("data-refresh-state", "idle");
  await expect(summary).not.toHaveText(summaryBefore ?? "");
  await expect(weather).toHaveAttribute(
    "data-weather-reading",
    readingAfter ?? "",
  );
  expect(errors()).toEqual([]);
});

test("refreshes the surrounding server component without touching the slots inside", async ({
  page,
}) => {
  const errors = collectBrowserErrors(page);

  await page.goto("/", { waitUntil: "commit" });
  await expect(page.locator('[data-resource-comments="ready"]')).toBeVisible();
  const dashboard = page.locator("[data-dashboard-render]");
  const weather = page.locator("[data-weather-reading]");
  await expect(weather).toBeVisible();

  const renderBefore = await dashboard.getAttribute("data-dashboard-render");
  const summaryBefore = await page
    .locator("[data-resource-summary]")
    .textContent();
  const readingBefore = await weather.getAttribute("data-weather-reading");

  // The island's state marks whether the slots inside survived the wrapper's
  // refresh as live client components.
  const island = page.locator('[data-like-island="post-1"]');
  await island.click();
  await expect(island).toHaveText("Like (1)");

  // Refreshing the dashboard re-streams only the wrapper: its server render
  // counter moves while both inner resources keep their entries.
  const refresh = page.locator('[data-resource-refresh="dashboard"]');
  await refresh.click();
  await expect(refresh).toHaveAttribute("data-refresh-state", "idle");
  await expect(dashboard).not.toHaveAttribute(
    "data-dashboard-render",
    renderBefore ?? "",
  );
  await expect(page.locator("[data-resource-summary]")).toHaveText(
    summaryBefore ?? "",
  );
  await expect(weather).toHaveAttribute(
    "data-weather-reading",
    readingBefore ?? "",
  );
  await expect(island).toHaveText("Like (1)");

  // The inner refresh verbs still work inside the refreshed wrapper.
  const refreshPost = page.locator('[data-resource-refresh="post"]');
  await refreshPost.click();
  await expect(refreshPost).toHaveAttribute("data-refresh-state", "idle");
  await expect(page.locator("[data-resource-summary]")).not.toHaveText(
    summaryBefore ?? "",
  );
  expect(errors()).toEqual([]);
});

test("keeps the shell height constant while every layer streams in", async ({
  page,
}) => {
  const shellHeight = () =>
    page
      .locator("main.app")
      .evaluate((element) => element.getBoundingClientRect().height);

  await page.goto("/", { waitUntil: "commit" });
  await page.locator('[data-dashboard-state="loading"]').waitFor();
  const height = await shellHeight();

  // Dashboard frame fills its slot.
  await page.locator("[data-dashboard-render]").waitFor();
  expect(await shellHeight()).toBe(height);

  // Post and weather fill their side-by-side slots, comments fill their hole.
  await page.locator("[data-weather-reading]").waitFor();
  await page.locator('[data-resource-comments="ready"]').waitFor();
  expect(await shellHeight()).toBe(height);

  // Navigating swaps the post slot back to its pending wireframe and fills
  // it again; the row is pinned by the slot, not its content.
  await page.locator('[data-resource-nav="next"]').click();
  await page.locator('[data-resource-state="loading"]').waitFor();
  expect(await shellHeight()).toBe(height);
  await page.locator('[data-resource-comments="ready"]').waitFor();
  expect(await shellHeight()).toBe(height);
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
