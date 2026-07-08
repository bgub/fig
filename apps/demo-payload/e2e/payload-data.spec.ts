import { expect, type Page, test } from "@playwright/test";

const feedBoundaryId = "demo-payload-feed";
const noteBoundaryId = "demo-payload-note";

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

test("refreshes active server boundaries after a manual boundary refresh", async ({
  page,
}) => {
  const errors = collectBrowserErrors(page);
  await installViewTransitionProbe(page);
  const payloadRequests: Array<{ boundary: string | null; url: string }> = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/payload") {
      payloadRequests.push({
        boundary: request.headers()["x-fig-payload-boundary"] ?? null,
        url: request.url(),
      });
    }
  });
  const navigations: string[] = [];
  let hydrated = false;
  page.on("framenavigated", (frame) => {
    if (hydrated && frame === page.mainFrame()) navigations.push(frame.url());
  });

  await page.goto("/", { waitUntil: "commit" });
  await expect(page.locator("body")).toHaveAttribute(
    "data-fig-payload-demo",
    "ready",
  );
  hydrated = true;

  const dashboard = page.locator(".dashboard-panel");
  const note = page.locator("[data-note-seed]");
  await expect(dashboard).toHaveAttribute("data-seed", "0");
  await expect(note).toHaveAttribute("data-note-seed", "0");
  await expect(note).not.toHaveClass(/tone-warn/);
  expect(payloadRequests).toEqual([
    { boundary: null, url: expect.any(String) },
  ]);

  const beforeFeedRefresh = await viewTransitionSnapshotCount(page);
  await page.getByRole("button", { name: "Refresh feed (0)" }).click();
  await expect(dashboard).toHaveAttribute("data-seed", "1");
  await expect(note).toHaveAttribute("data-note-seed", "0");
  const feedRefreshTransitions = await viewTransitionSnapshotsSince(
    page,
    beforeFeedRefresh,
  );
  expect(
    feedRefreshTransitions.some((names) => names.includes("payload-dashboard")),
  ).toBe(true);
  expect(
    feedRefreshTransitions.every((names) => !names.includes("payload-note")),
  ).toBe(true);
  expect(payloadRequests.at(-1)?.boundary).toBe(feedBoundaryId);

  const beforeAppRefresh = await viewTransitionSnapshotCount(page);
  const beforeAppRefreshRequestCount = payloadRequests.length;
  await page.getByRole("button", { name: "Refresh app (0)" }).click();
  await expect(dashboard).toHaveAttribute("data-seed", "2");
  await expect(note).toHaveAttribute("data-note-seed", "2");
  const appRefreshTransitions = await viewTransitionSnapshotsSince(
    page,
    beforeAppRefresh,
  );
  expect(
    appRefreshTransitions.some((names) => names.includes("payload-dashboard")),
  ).toBe(true);
  expect(
    appRefreshTransitions.some((names) => names.includes("payload-note")),
  ).toBe(true);
  expect(payloadRequests.slice(beforeAppRefreshRequestCount)).toEqual([
    { boundary: feedBoundaryId, url: expect.stringContaining("seed=2") },
    { boundary: noteBoundaryId, url: expect.stringContaining("seed=2") },
  ]);

  expect(navigations).toEqual([]);
  expect(errors()).toEqual([]);
});

async function installViewTransitionProbe(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const snapshots: string[][] = [];
    Object.defineProperty(window, "__figViewTransitionSnapshots", {
      configurable: true,
      value: snapshots,
    });

    Object.defineProperty(Document.prototype, "startViewTransition", {
      configurable: true,
      value(update: () => unknown) {
        const updateResult = update();
        const names = Array.from(
          document.querySelectorAll<HTMLElement>("[style]"),
        )
          .map((element) => element.style.viewTransitionName)
          .filter((name) => name !== "" && name !== "none");
        snapshots.push(names);

        return {
          finished: Promise.resolve(),
          ready: Promise.resolve(),
          updateCallbackDone: Promise.resolve(updateResult),
        };
      },
    });
  });
}

async function viewTransitionSnapshotCount(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      (
        window as Window & {
          __figViewTransitionSnapshots?: string[][];
        }
      ).__figViewTransitionSnapshots?.length ?? 0,
  );
}

async function viewTransitionSnapshotsSince(
  page: Page,
  index: number,
): Promise<string[][]> {
  return page.evaluate(
    (start) =>
      (
        window as Window & {
          __figViewTransitionSnapshots?: string[][];
        }
      ).__figViewTransitionSnapshots?.slice(start) ?? [],
    index,
  );
}

function collectBrowserErrors(page: Page): () => string[] {
  const errors: string[] = [];

  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });

  return () => errors;
}
