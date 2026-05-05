import { expect, type Page, test } from "@playwright/test";

test("replays a blocked click after pending Suspense hydrates", async ({
  page,
}) => {
  const errors = collectBrowserErrors(page);

  await openReplayPage(page);
  await page
    .getByRole("button", { exact: true, name: "Pending target" })
    .click();
  await expect(page.locator(".log")).toHaveText("No Fig handlers yet.");

  await page.getByRole("button", { name: "Complete, keep target" }).click();

  await expect(
    page.getByRole("button", { name: "Hydrated target" }),
  ).toBeVisible();
  await expect(page.locator(".log")).toContainText("child handler ran");
  await expect(page.locator(".log")).not.toContainText("parent handler ran");
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

  const log = page.locator(".log");
  await expect(
    page.getByRole("button", { name: "Hydrated target" }),
  ).toBeVisible();
  await expect(log).toHaveText("No Fig handlers yet.");

  await page.getByRole("button", { name: "Hydrated target" }).click();

  await expect(log).toContainText("child handler ran");
  await expect(log).not.toContainText("parent handler ran");
  expect(errors()).toEqual([]);
});

async function openReplayPage(page: Page): Promise<void> {
  await page.goto("/#event-replay", { waitUntil: "commit" });
  await expect(
    page.getByRole("heading", { name: "Hydration event replay" }),
  ).toBeVisible();
  await expect(page.getByText("Pending boundary mounted.")).toBeVisible();
}

function collectBrowserErrors(page: Page): () => string[] {
  const errors: string[] = [];

  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });

  return () => errors;
}
