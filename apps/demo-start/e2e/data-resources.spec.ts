import { expect, test } from "@playwright/test";
import { collectBrowserErrors } from "./browser-errors.ts";

test("renders and refreshes isomorphic and remote data resources", async ({
  page,
}) => {
  const errors = collectBrowserErrors(page);
  const dataRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/__fig/data")) dataRequests.push(request.url());
  });

  await page.goto("/data", { waitUntil: "commit" });

  const isomorphic = page.locator('[data-data-value="Isomorphic"]');
  const remote = page.locator('[data-data-value="Remote server"]');
  await expect(isomorphic).toContainText("Hello Fig · server");
  await expect(remote).toContainText("File-based routing · server-remote");
  expect(dataRequests).toEqual([]);

  await page.getByRole("button", { name: "Refresh isomorphic" }).click();
  await expect(isomorphic).toContainText("Hello Fig · browser · load 1");
  expect(dataRequests).toEqual([]);

  await page.getByRole("button", { name: "Invalidate isomorphic key" }).click();
  await expect(isomorphic).toContainText("Hello Fig · browser · load 2");
  expect(dataRequests).toEqual([]);

  const remoteBefore = await remote.textContent();
  await page.getByRole("button", { name: "Refresh remote" }).click();
  await expect(remote).not.toHaveText(remoteBefore ?? "");
  await expect(remote).toContainText("File-based routing · server-remote");
  expect(dataRequests).toHaveLength(1);

  const remoteAfterRefresh = await remote.textContent();
  await page.getByRole("button", { name: "Invalidate remote key" }).click();
  await expect(remote).not.toHaveText(remoteAfterRefresh ?? "");
  await expect(remote).toContainText("File-based routing · server-remote");
  expect(dataRequests).toHaveLength(2);
  expect(errors()).toEqual([]);
});

test("streams server-only data during payload navigation", async ({ page }) => {
  const errors = collectBrowserErrors(page);
  const dataRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/__fig/data")) dataRequests.push(request.url());
  });

  await page.goto("/data", { waitUntil: "commit" });
  await page
    .getByRole("link", { name: "Open server-only post payload" })
    .click();

  await expect(
    page.getByRole("heading", { name: "Hello Fig", level: 2 }),
  ).toBeVisible();
  await expect(page.locator("[data-server-post]")).toContainText(
    "server-only resource",
  );
  expect(dataRequests).toEqual([]);
  expect(errors()).toEqual([]);
});
