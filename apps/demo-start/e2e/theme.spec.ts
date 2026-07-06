import { expect, test, type BrowserContext } from "@playwright/test";
import { collectBrowserErrors } from "./browser-errors.ts";

const THEME_COOKIE_NAME = "fig-demo-theme";

test("applies system theme before client hydration when no cookie exists", async ({
  page,
}) => {
  const errors = collectBrowserErrors(page);

  await page.emulateMedia({ colorScheme: "dark" });
  await page.route("**/client.js", (route) =>
    route.fulfill({
      body: "",
      contentType: "text/javascript",
    }),
  );

  await page.goto("/", { waitUntil: "domcontentloaded" });

  const shell = page.locator(".fig-start-shell");
  await expect(page.locator("html")).toHaveClass(/(^| )system( |$)/);
  await expect(shell).toHaveAttribute("data-theme", "system");
  await expect(shell).toHaveCSS("background-color", "rgb(16, 24, 32)");
  expect(await themeCookie(page.context())).toBeNull();
  expect(errors()).toEqual([]);
});

test("uses stored theme before client hydration when system theme disagrees", async ({
  context,
  page,
}) => {
  const errors = collectBrowserErrors(page);

  await page.emulateMedia({ colorScheme: "dark" });
  await setThemeCookie(context, "light");
  await page.route("**/client.js", (route) =>
    route.fulfill({
      body: "",
      contentType: "text/javascript",
    }),
  );

  await page.goto("/", { waitUntil: "domcontentloaded" });

  const shell = page.locator(".fig-start-shell");
  await expect(page.locator("html")).toHaveClass(/(^| )light( |$)/);
  await expect(shell).toHaveAttribute("data-theme", "system");
  await expect(shell).toHaveCSS("background-color", "rgb(245, 247, 248)");
  expect(errors()).toEqual([]);
});

test("hydrates, changes, and persists the shell theme", async ({
  context,
  page,
}) => {
  const errors = collectBrowserErrors(page);

  await setThemeCookie(context, "dark");

  await page.goto("/", { waitUntil: "commit" });

  const shell = page.locator(".fig-start-shell");
  await expect(page.locator("html")).toHaveClass(/(^| )dark( |$)/);
  await expect(shell).toHaveAttribute("data-theme", "dark");

  const themeGroup = page.getByRole("group", { name: "Theme" });
  await expect(
    themeGroup.getByRole("button", { name: "Dark" }),
  ).toHaveAttribute("aria-pressed", "true");

  await themeGroup.getByRole("button", { name: "Light" }).click();

  await expect(shell).toHaveAttribute("data-theme", "light");
  await expect(page.locator("html")).toHaveClass(/(^| )light( |$)/);
  await expect(
    themeGroup.getByRole("button", { name: "Light" }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => themeCookie(context)).toBe("light");

  await themeGroup.getByRole("button", { name: "System" }).click();

  await expect(shell).toHaveAttribute("data-theme", "system");
  await expect(page.locator("html")).toHaveClass(/(^| )system( |$)/);
  await expect(
    themeGroup.getByRole("button", { name: "System" }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => themeCookie(context)).toBe("system");

  await page.reload({ waitUntil: "commit" });

  await expect(shell).toHaveAttribute("data-theme", "system");
  await expect(page.locator("html")).toHaveClass(/(^| )system( |$)/);
  await expect(page.getByRole("button", { name: "System" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(errors()).toEqual([]);
});

test("changes away from system theme on the first click", async ({
  context,
  page,
}) => {
  const errors = collectBrowserErrors(page);

  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/", { waitUntil: "commit" });

  const shell = page.locator(".fig-start-shell");
  const themeGroup = page.getByRole("group", { name: "Theme" });
  await expect(page.locator("html")).toHaveClass(/(^| )system( |$)/);
  await expect(shell).toHaveAttribute("data-theme", "system");
  await expect(shell).toHaveCSS("background-color", "rgb(16, 24, 32)");
  await expect(
    themeGroup.getByRole("button", { name: "System" }),
  ).toHaveAttribute("aria-pressed", "true");

  await themeGroup.getByRole("button", { name: "Light" }).click();

  await expect(shell).toHaveAttribute("data-theme", "light");
  await expect(page.locator("html")).toHaveClass(/(^| )light( |$)/);
  await expect(shell).toHaveCSS("background-color", "rgb(245, 247, 248)");
  await expect(
    themeGroup.getByRole("button", { name: "Light" }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => themeCookie(context)).toBe("light");
  expect(errors()).toEqual([]);
});

async function setThemeCookie(
  context: BrowserContext,
  value: string,
): Promise<void> {
  await context.addCookies([
    {
      domain: "127.0.0.1",
      name: THEME_COOKIE_NAME,
      path: "/",
      value,
    },
  ]);
}

async function themeCookie(context: BrowserContext): Promise<string | null> {
  const cookies = await context.cookies();
  return (
    cookies.find((cookie) => cookie.name === THEME_COOKIE_NAME)?.value ?? null
  );
}
