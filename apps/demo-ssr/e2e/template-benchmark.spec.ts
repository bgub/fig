import { expect, test } from "@playwright/test";

test.skip(
  process.env.FIG_RUN_TEMPLATE_BENCHMARK !== "1",
  "set FIG_RUN_TEMPLATE_BENCHMARK=1 to run the real-browser benchmark",
);

test("template fibers versus ordinary fibers in Chromium", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.locator("body")).toHaveAttribute(
    "data-fig-hydrated",
    "true",
  );

  const result = await page.evaluate(async () => {
    const run = window.__figRunTemplateBenchmark;
    if (run === undefined)
      throw new Error("Template benchmark is not installed.");
    return run(1_000, 15);
  });

  console.log(`FIG_TEMPLATE_BROWSER_BENCHMARK ${JSON.stringify(result)}`);
  for (const comparison of [result.mount, result.update, result.reorder]) {
    expect(comparison.fibersMs).toBeGreaterThan(0);
    expect(comparison.templatesMs).toBeGreaterThan(0);
    expect(Number.isFinite(comparison.speedup)).toBe(true);
  }
});
