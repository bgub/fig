import { expect, test } from "@playwright/test";
import { collectBrowserErrors } from "./browser-errors.ts";

test("hydrates the document and updates metadata during navigation", async ({
  page,
}) => {
  const errors = collectBrowserErrors(page);

  await page.goto("/users/ada", { waitUntil: "commit" });

  await expect(page.locator("body")).toHaveAttribute(
    "data-fig-hydrated",
    "true",
  );
  await expect(page.locator("html")).toHaveCount(1);
  await expect(page).toHaveTitle("ada · Fig Start");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Ada Lovelace",
  );
  await expect(page.locator("[data-loaded-by]")).toHaveAttribute(
    "data-loaded-by",
    "server",
  );
  expect(await page.evaluate(() => document.doctype?.name)).toBe("html");

  await page.getByRole("link", { exact: true, name: "Users" }).click();

  await expect(page).toHaveURL(/\/users$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Users");
  await expect(page).toHaveTitle("Fig × TanStack Start");
  expect(errors()).toEqual([]);
});
