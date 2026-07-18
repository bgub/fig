import { expect, test } from "@playwright/test";
import { collectBrowserErrors } from "./browser-errors.ts";

test("hydrates the document and updates metadata during navigation", async ({
  page,
}) => {
  const errors = collectBrowserErrors(page);

  await page.goto("/users/ada", { waitUntil: "commit" });

  await expect(page.locator("html")).toHaveCount(1);
  await expect(page).toHaveTitle("ada · Fig Start");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Ada Lovelace",
  );
  const loadMetadata = page.locator("[data-loaded-by]");
  await expect(loadMetadata).toHaveAttribute("data-loaded-by", "server");
  await expect(loadMetadata).toHaveAttribute("data-generation", "1");
  await expect(loadMetadata).toHaveAttribute(
    "data-function-middleware",
    "true",
  );
  await expect(loadMetadata).not.toHaveAttribute("data-request-id", "");
  expect(await page.evaluate(() => document.doctype?.name)).toBe("html");

  await page.getByRole("button", { name: "Change role on server" }).click();

  await expect(page.locator("[data-user-role]")).toContainText("server edit 1");
  await expect(loadMetadata).toHaveAttribute("data-generation", "2");

  await page.getByRole("button", { name: "View Grace Hopper" }).click();
  await expect(page).toHaveURL(/\/users\/grace$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Grace Hopper",
  );
  await expect(page.locator("[data-route-id]")).toHaveAttribute(
    "data-route-id",
    "/users/$userId",
  );
  await expect(page.locator("[data-loader-source]")).toHaveAttribute(
    "data-loader-source",
    "fig-data",
  );
  await expect(page.locator("footer")).toHaveAttribute("data-match-count", "3");
  await expect(page.locator("[data-users-route-active]")).toBeVisible();

  await page.getByRole("link", { exact: true, name: "Users" }).click();

  await expect(page).toHaveURL(/\/users$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Users");
  await expect(page).toHaveTitle("Fig × TanStack Start");
  expect(errors()).toEqual([]);
});

test("loads a generated lazy route during client navigation", async ({
  page,
}) => {
  const errors = collectBrowserErrors(page);

  await page.goto("/");
  await page.getByRole("link", { name: "Architecture" }).click();

  await expect(page).toHaveURL(/\/about$/);
  await expect(page).toHaveTitle("Architecture · Fig Start");
  await expect(page.locator("[data-lazy-route]")).toHaveAttribute(
    "data-lazy-route",
    "loaded",
  );
  expect(errors()).toEqual([]);
});

test("handles redirects on the server and client", async ({
  page,
  request,
}) => {
  const response = await request.get("/legacy-users", { maxRedirects: 0 });

  expect([301, 302, 307, 308]).toContain(response.status());
  expect(response.headers().location).toBe("/users");

  const errors = collectBrowserErrors(page);
  await page.goto("/");
  await page.getByRole("link", { name: "Exercise a redirect" }).click();

  await expect(page).toHaveURL(/\/users$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Users");
  expect(errors()).toEqual([]);

  await page.goto("/");
  await page
    .getByRole("link", { name: "Exercise component navigation" })
    .click();
  await expect(page).toHaveURL(/\/users$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Users");
  expect(errors()).toEqual([]);
});

test("renders generated error and not-found routes", async ({ page }) => {
  await page.goto("/users");
  await page.getByRole("link", { name: "Exercise a loader error" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Profile unavailable",
  );

  await page.goto("/missing");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Route not found",
  );
});

test("isolates middleware context across concurrent SSR requests", async ({
  request,
}) => {
  const [first, second] = await Promise.all([
    request.get("/users/grace", {
      headers: { "x-fig-request-id": "isolation-first" },
    }),
    request.get("/users/grace", {
      headers: { "x-fig-request-id": "isolation-second" },
    }),
  ]);

  expect(first.headers()["x-fig-request-id"]).toBe("isolation-first");
  expect(second.headers()["x-fig-request-id"]).toBe("isolation-second");

  const [firstHtml, secondHtml] = await Promise.all([
    first.text(),
    second.text(),
  ]);
  expect(firstHtml).toContain('data-request-id="isolation-first"');
  expect(firstHtml).not.toContain("isolation-second");
  expect(secondHtml).toContain('data-request-id="isolation-second"');
  expect(secondHtml).not.toContain("isolation-first");
  expect(firstHtml).toContain('data-function-middleware="true"');
  expect(secondHtml).toContain('data-function-middleware="true"');
});
