import { expect, type Page, test } from "@playwright/test";

test("replays a blocked click after pending Suspense hydrates", async ({
  page,
}) => {
  const errors = collectBrowserErrors(page);

  await openReplayPage(page);
  await page
    .getByRole("button", { exact: true, name: "Pending target" })
    .click();
  const log = replayLog(page);
  await expect(log).toHaveText("No Fig handlers yet.");

  await page.getByRole("button", { name: "Complete, keep target" }).click();

  await expect(
    page.getByRole("button", { name: "Hydrated target" }),
  ).toBeVisible();
  await expect(log).toContainText("child handler ran");
  await expect(log).not.toContainText("parent handler ran");
  expect(errors()).toEqual([]);
});

test("drops a blocked click when the original target is replaced", async ({
  page,
}) => {
  const errors = collectBrowserErrors(page);

  await openReplayPage(page);
  await page
    .getByRole("button", { exact: true, name: "Pending target" })
    .click();
  await page.getByRole("button", { name: "Complete, replace target" }).click();

  const log = replayLog(page);
  await expect(
    page.getByRole("button", { name: "Hydrated target" }),
  ).toBeVisible();
  await expect(log).toHaveText("No Fig handlers yet.");

  await page.getByRole("button", { name: "Hydrated target" }).click();

  await expect(log).toContainText("child handler ran");
  await expect(log).not.toContainText("parent handler ran");
  expect(errors()).toEqual([]);
});

test("hydrates hidden Activity template content before bind and events attach", async ({
  page,
}) => {
  const errors = collectBrowserErrors(page);

  await openReplayPage(page);

  await expect(
    page.getByRole("button", { name: "Secret Activity Button" }),
  ).toHaveCount(0);
  await expect(page.getByText("Hidden Activity is dehydrated.")).toBeVisible();

  await page.getByRole("button", { name: "Reveal Activity" }).click();

  const child = page.getByRole("button", { name: "Secret Activity Button" });
  await expect(child).toBeVisible();
  await expect(child).toHaveAttribute("data-activity-bound", "true");

  await child.click();
  await expect(page.getByText("activity child event")).toBeVisible();
  expect(errors()).toEqual([]);
});

test("runs benchmark page and renders summarized results", async ({ page }) => {
  const errors = collectBrowserErrors(page);

  await page.goto("/#benchmarks", { waitUntil: "commit" });
  await expect(page.getByRole("heading", { name: "Benchmarks" })).toBeVisible();

  const rows = page.getByLabel("Rows");
  await rows.fill("50");
  await page.getByRole("button", { name: "Run benchmarks" }).click();

  await expect(page.getByText("Completed 10 scenarios")).toBeVisible();
  await expect(page.getByText("Median wins")).toBeVisible();
  await expect(page.getByRole("cell", { name: "Initial mount" })).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "Same-order update" }),
  ).toBeVisible();
  expect(errors()).toEqual([]);
});

async function openReplayPage(page: Page): Promise<void> {
  await page.goto("/#event-replay", { waitUntil: "commit" });
  await expect(
    page.getByRole("heading", { name: "Hydration event replay" }),
  ).toBeVisible();
  await expect(page.getByText("Pending boundary mounted.")).toBeVisible();
}

function replayLog(page: Page) {
  return page
    .locator(".hydration-output")
    .filter({ hasText: "Event log" })
    .locator(".log");
}

function collectBrowserErrors(page: Page): () => string[] {
  const errors: string[] = [];

  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });

  return () => errors;
}
