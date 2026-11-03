import { expect, test } from "@playwright/test";
import { collectBrowserErrors } from "../../../tests/browser/browser-errors.ts";

test("hydrates a fast boundary while a slow boundary is still streaming", async ({
  page,
}) => {
  const errors = collectBrowserErrors(page);
  await page.goto("/streaming", { waitUntil: "commit" });

  const fast = page.locator('div[data-streamed="fast"]');
  const fastButton = page.getByRole("button", { name: /^fast clicks/ });
  await expect(fast).toContainText("fast · server");
  await fastButton.click();
  await expect(fastButton).toHaveText("fast clicks 1");
  // The click committed while the slow fallback is still on screen, so the
  // fast boundary hydrated before the document finished streaming.
  await expect(page.locator('p[data-streamed="slow"]')).toHaveText(
    "Slow pending",
  );

  const slow = page.locator('div[data-streamed="slow"]');
  const slowButton = page.getByRole("button", { name: /^slow clicks/ });
  await expect(slow).toContainText("slow · server");
  await slowButton.click();
  await expect(slowButton).toHaveText("slow clicks 1");
  // Both values hydrated from the stream instead of reloading in the browser.
  await expect(fast).toContainText("fast · server");
  expect(errors()).toEqual([]);
});
