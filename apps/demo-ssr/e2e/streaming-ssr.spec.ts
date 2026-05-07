import { expect, test } from "@playwright/test";

test("hydrates the streamed shell and revealed Suspense content", async ({
  page,
}) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];

  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  await page.goto("/", { waitUntil: "commit" });

  await expect(page.locator("body")).toHaveAttribute(
    "data-fig-hydrated",
    "true",
  );

  const shellButton = page.getByRole("button", { name: "Shell clicks: 0" });
  await expect(shellButton).toBeVisible();
  await shellButton.click();
  await expect(
    page.getByRole("button", { name: "Shell clicks: 1" }),
  ).toBeVisible();

  await expect(page.getByText("Pending fallback for 5 seconds.")).toBeVisible();
  await expect(
    page.getByText("Content resolved after 5 seconds."),
  ).toBeVisible();

  const suspenseButton = page.getByRole("button", {
    name: "Suspense clicks: 0",
  });
  await expect(suspenseButton).toBeVisible();
  await suspenseButton.click();
  await expect(
    page.getByRole("button", { name: "Suspense clicks: 1" }),
  ).toBeVisible();

  await expect(page.locator("body")).toHaveAttribute(
    "data-recoverable-hydration-error",
    "The server could not finish this Suspense boundary. Switched to client rendering.",
  );
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test("client-renders aborted Suspense boundaries after the shell", async ({
  page,
}) => {
  await page.goto("/abort", { waitUntil: "commit" });

  await expect(page.locator("body")).toHaveAttribute(
    "data-fig-hydrated",
    "true",
  );
  await expect(page.getByText("abort route")).toBeVisible();
  await expect(page.getByText("Pending fallback for 5 seconds.")).toBeVisible();

  const suspenseButton = page.getByRole("button", {
    name: "Suspense clicks: 0",
  });
  await expect(suspenseButton).toBeVisible();
  await suspenseButton.click();
  await expect(
    page.getByRole("button", { name: "Suspense clicks: 1" }),
  ).toBeVisible();
});
