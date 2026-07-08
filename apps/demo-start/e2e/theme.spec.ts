import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { collectBrowserErrors } from "./browser-errors.ts";

const THEME_COOKIE_NAME = "fig-demo-theme";
type ThemePreference = "dark" | "light" | "system";

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

  await expectTheme(page, "system", {
    backgroundColor: "rgb(16, 24, 32)",
  });
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

  await expectTheme(page, "light", {
    backgroundColor: "rgb(245, 247, 248)",
  });
  expect(errors()).toEqual([]);
});

test("keeps stored theme while data route Suspense resolves", async ({
  context,
  page,
}) => {
  const errors = collectBrowserErrors(page);

  await setThemeCookie(context, "dark");
  await page.goto("/data", { waitUntil: "commit" });

  await expectTheme(page, "dark");
  await expect(page.locator('[data-data-value="Isomorphic"]')).toContainText(
    "Hello Fig · server",
  );
  await expectTheme(page, "dark");
  expect(errors()).toEqual([]);
});

test("hydrates, changes, and persists the shell theme", async ({
  context,
  page,
}) => {
  const errors = collectBrowserErrors(page);

  await setThemeCookie(context, "dark");

  await page.goto("/", { waitUntil: "commit" });

  await expectTheme(page, "dark");
  const themeGroup = page.getByRole("group", { name: "Theme" });

  await awaitInteractive(page);
  await themeGroup.getByRole("button", { name: "Light" }).click();

  await expectTheme(page, "light");
  await expect.poll(() => themeCookie(context)).toBe("light");

  await themeGroup.getByRole("button", { name: "System" }).click();

  await expectTheme(page, "system");
  await expect.poll(() => themeCookie(context)).toBe("system");

  await page.reload({ waitUntil: "commit" });

  await expectTheme(page, "system");
  expect(errors()).toEqual([]);
});

test("honors a click that landed before the client bundle executed", async ({
  context,
  page,
}) => {
  const errors = collectBrowserErrors(page);

  await page.emulateMedia({ colorScheme: "dark" });
  // Hold the client bundle at the network layer: the click below happens
  // while only the document's inline early-event-capture script exists.
  let releaseBundle: () => void = () => undefined;
  const bundleGate = new Promise<void>((resolve) => {
    releaseBundle = resolve;
  });
  await page.route("**/client.js*", async (route) => {
    await bundleGate;
    await route.continue();
  });

  // The held module bundle also holds DOMContentLoaded, so wait for the
  // streamed markup itself rather than a document lifecycle event.
  await page.goto("/", { waitUntil: "commit" });
  const themeGroup = page.getByRole("group", { name: "Theme" });
  await themeGroup.getByRole("button", { name: "Light" }).waitFor();

  await themeGroup.getByRole("button", { name: "Light" }).click();

  // No framework code has run: the page still shows the server state.
  await expectTheme(page, "system", {
    backgroundColor: "rgb(16, 24, 32)",
  });

  releaseBundle();

  // Hydration adopts the captured click and replays it.
  await expectTheme(page, "light", {
    backgroundColor: "rgb(245, 247, 248)",
  });
  await expect.poll(() => themeCookie(context)).toBe("light");
  expect(errors()).toEqual([]);
});

test("changes away from system theme on the first click", async ({
  context,
  page,
}) => {
  const errors = collectBrowserErrors(page);

  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/", { waitUntil: "commit" });

  const themeGroup = page.getByRole("group", { name: "Theme" });
  await expectTheme(page, "system", {
    backgroundColor: "rgb(16, 24, 32)",
  });

  await awaitInteractive(page);
  await themeGroup.getByRole("button", { name: "Light" }).click();

  await expectTheme(page, "light", {
    backgroundColor: "rgb(245, 247, 248)",
  });
  await expect.poll(() => themeCookie(context)).toBe("light");
  expect(errors()).toEqual([]);
});

// Every expectTheme assertion passes on server-rendered HTML alone, so a
// click can otherwise race client-bundle execution: events fired before any
// script ran are unrecoverable (fig-dom's replay only exists once hydration
// starts). The marker is set the moment replay listeners are installed.
async function awaitInteractive(page: Page): Promise<void> {
  await page.locator("[data-fig-start-hydrated]").waitFor();
}

async function expectTheme(
  page: Page,
  theme: ThemePreference,
  options: { backgroundColor?: string } = {},
): Promise<void> {
  const shell = page.locator(".fig-start-shell");
  await expect(page.locator("html")).toHaveClass(
    new RegExp(`(^| )${theme}( |$)`),
  );
  await expect(shell).toHaveAttribute("data-theme", theme);
  await expect(
    page.getByRole("button", { name: themeLabel(theme) }),
  ).toHaveAttribute("aria-pressed", "true");

  if (options.backgroundColor !== undefined) {
    await expect(shell).toHaveCSS("background-color", options.backgroundColor);
  }
}

function themeLabel(theme: ThemePreference): string {
  return theme[0]?.toUpperCase() + theme.slice(1);
}

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
