import { expect, test } from "@playwright/test";

test("hydrates the streamed shell and revealed Suspense content", async ({
  page,
}) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  const dataRequests: string[] = [];

  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/__fig/data") {
      dataRequests.push(request.postData() ?? "");
    }
  });

  await page.goto("/", { waitUntil: "commit" });

  // The fallback ships in the shell HTML; check it before anything that
  // waits, since the server reveal replaces it shortly after.
  await expect(page.getByText("Pending fallback for 5 seconds.")).toBeVisible();

  await expect(page.locator("body")).toHaveAttribute(
    "data-fig-hydrated",
    "true",
  );
  const isomorphicData = page.locator('[data-ssr-data-kind="isomorphic"]');
  const serverInfoValue = page.locator('[data-ssr-data-value="server-info"]');
  const serverOnlyData = page.locator('[data-ssr-data-kind="server-only"]');
  await expect(isomorphicData).toContainText("Loaded on the server (Node");
  await expect(serverInfoValue).toContainText("us-west (origin)");
  await expect(serverOnlyData).toContainText(
    "Loaded only by the server renderer (Node",
  );

  await page.getByRole("button", { name: "Refresh data resource" }).click();
  await expect.poll(() => dataRequests.length).toBe(1);
  await expect(isomorphicData).toContainText("Loaded on the server (Node");
  await expect(serverInfoValue).toContainText("us-west (origin)");
  await expect(serverOnlyData).toContainText(
    "Loaded only by the server renderer (Node",
  );

  await page.getByRole("button", { name: "Refresh anyways (errors)" }).click();
  await expect(page.locator("[data-ssr-data-error]")).toContainText(
    "Unsupported refresh: no-client-loader.",
  );
  expect(dataRequests).toHaveLength(1);

  const shellButton = page.getByRole("button", { name: "Shell clicks: 0" });
  await expect(shellButton).toBeVisible();
  await shellButton.click();
  await expect(
    page.getByRole("button", { name: "Shell clicks: 1" }),
  ).toBeVisible();

  await expect(
    page.getByText("Content resolved on the server after 5 seconds."),
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

  // Check the shell fallback first: the client resolves the aborted boundary
  // soon after the abort marker streams, replacing the fallback.
  await expect(page.getByText("Pending fallback for 5 seconds.")).toBeVisible();

  await expect(page.locator("body")).toHaveAttribute(
    "data-fig-hydrated",
    "true",
  );
  await expect(
    page.getByRole("heading", { name: "Abort after shell" }),
  ).toBeVisible();

  const suspenseButton = page.getByRole("button", {
    name: "Suspense clicks: 0",
  });
  await expect(suspenseButton).toBeVisible();
  await suspenseButton.click();
  await expect(
    page.getByRole("button", { name: "Suspense clicks: 1" }),
  ).toBeVisible();
});

test("preserves server-rendered Suspense content inside a hidden Activity on reveal", async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.goto("/", { waitUntil: "commit" });
  await expect(page.locator("body")).toHaveAttribute(
    "data-fig-hydrated",
    "true",
  );

  // Wait for the full stream so the hidden boundary's server completion has been
  // streamed into the activity's inert template (the `ac` runtime fill).
  await page.waitForLoadState("load");

  // Before reveal the content lives in the inert <template>, not the live DOM.
  await expect(page.locator("[data-hidden-content]")).toHaveCount(0);

  await page.getByRole("button", { name: "Reveal hidden activity" }).click();

  // The server-streamed content appears even though the client promise never
  // resolves, and the fallback never shows: the streamed completion was
  // preserved inside the template and hydrated on reveal rather than
  // client-rendered.
  await expect(
    page.getByText("Hidden Activity content rendered on the server."),
  ).toBeVisible();
  await expect(page.locator("[data-hidden-fallback]")).toHaveCount(0);
  expect(pageErrors).toEqual([]);
});

test("client-recovers a failed Suspense inside a hidden Activity on reveal", async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.goto("/", { waitUntil: "commit" });
  await expect(page.locator("body")).toHaveAttribute(
    "data-fig-hydrated",
    "true",
  );

  // Wait for the full stream so the failed boundary's `ax` client-render marker
  // has been applied inside the activity's inert template.
  await page.waitForLoadState("load");

  // Before reveal nothing for this boundary is in the live DOM.
  await expect(page.locator("[data-hidden-error]")).toHaveCount(0);
  await expect(page.locator("[data-hidden-error-fallback]")).toHaveCount(0);

  await page.getByRole("button", { name: "Reveal hidden activity" }).click();

  // The boundary errored on the server (marked client-render via `ax` inside the
  // template); on reveal the client recovers it and renders the recovered
  // content rather than getting stuck on the fallback.
  await expect(
    page.getByText("Recovered on the client after hidden server error."),
  ).toBeVisible();
  await expect(page.locator("[data-hidden-error-fallback]")).toHaveCount(0);
  expect(pageErrors).toEqual([]);
});
