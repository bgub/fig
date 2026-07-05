import { expect, type Page, test } from "@playwright/test";

test("streams data resources through initial payload and boundary refresh", async ({
  page,
}) => {
  const errors = collectBrowserErrors(page);
  const payloadRequests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/payload") {
      payloadRequests.push(request.url());
    }
  });

  await page.goto("/", { waitUntil: "commit" });
  await expect(page.locator("body")).toHaveAttribute(
    "data-fig-payload-demo",
    "ready",
  );

  const dashboard = page.locator(".dashboard-panel");
  const shared = page.locator('[data-payload-data-kind="isomorphic"]');
  const serverOnly = page.locator('[data-payload-data-kind="server-only"]');
  await expect(
    page.getByRole("heading", { name: "Regional order pulse" }),
  ).toBeVisible();
  await expect(shared).toContainText("shared · bucket-");
  await expect(serverOnly).toContainText("server-only · request ");
  expect(payloadRequests).toHaveLength(1);

  const seedBefore = await dashboard.getAttribute("data-seed");
  const serverOnlyBefore = await serverOnly.textContent();
  await page.getByRole("button", { name: "Refresh feed (0)" }).click();

  await expect(dashboard).not.toHaveAttribute("data-seed", seedBefore ?? "");
  await expect(shared).toContainText("shared · bucket-");
  await expect(serverOnly).not.toHaveText(serverOnlyBefore ?? "");
  expect(payloadRequests).toHaveLength(2);
  expect(errors()).toEqual([]);
});

function collectBrowserErrors(page: Page): () => string[] {
  const errors: string[] = [];

  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });

  return () => errors;
}
