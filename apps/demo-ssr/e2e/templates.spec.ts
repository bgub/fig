import { expect, test } from "@playwright/test";

// Drives the compiled-template showcase end to end: the figTemplates()
// build plugin compiled this section's JSX into descriptors, the server
// streamed their segments, and the client hydrated by adopting the server
// DOM and binding event slots.

test("compiled templates hydrate, dispatch events, and update slots", async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.goto("/", { waitUntil: "commit" });

  // Server-rendered template rows are present before any client work.
  const rows = page.locator("[data-template-row]");
  await expect(rows).toHaveCount(3);
  await expect(
    page.locator('[data-template-row="beta"] .template-label'),
  ).toHaveText("Row beta");

  await expect(page.locator("body")).toHaveAttribute(
    "data-fig-hydrated",
    "true",
  );

  // The template rows were adopted, not re-created: event slots bound to
  // the server DOM dispatch through delegation.
  await page.locator('[data-template-action="beta"]').click();
  await expect(page.locator("[data-template-status]")).toHaveAttribute(
    "data-template-status",
    "beta",
  );

  // Re-render swapped the handler slots by position; a second pick still
  // routes to the right row's handler.
  await page.locator('[data-template-action="gamma"]').click();
  await expect(page.locator("[data-template-status]")).toHaveAttribute(
    "data-template-status",
    "gamma",
  );

  // A template inside a streamed Suspense boundary reveals and hydrates.
  await expect(page.locator('[data-template-stream="ready"]')).toContainText(
    "Streamed template content",
  );

  expect(pageErrors).toEqual([]);
});

test("the served client bundle contains compiled template descriptors", async ({
  page,
}) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const scriptSrc = await page
    .locator('script[type="module"][src]')
    .first()
    .getAttribute("src");
  expect(scriptSrc).not.toBeNull();

  const bundle = await page.request.get(scriptSrc as string);
  const source = await bundle.text();
  // The transform ran in the real build: a descriptor's html string —
  // markup inside a JS string — can only come from compilation. This
  // guards against the whole suite silently passing via the fiber path if
  // the plugin were dropped from the config.
  expect(source).toContain("<li class=");
});
