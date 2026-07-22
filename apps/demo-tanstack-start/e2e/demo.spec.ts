import { expect, test } from "@playwright/test";
import { collectBrowserErrors } from "./browser-errors.ts";

test("hydrates the themed document and persists shell changes", async ({
  context,
  page,
}) => {
  const errors = collectBrowserErrors(page);
  await context.addCookies([
    {
      domain: "127.0.0.1",
      name: "fig-demo-theme",
      path: "/",
      value: "dark",
    },
  ]);

  await page.goto("/", { waitUntil: "commit" });
  await expect(page.locator("html")).toHaveClass(/(^| )dark( |$)/);
  await expect(page.locator(".fig-tanstack-shell")).toHaveAttribute(
    "data-theme",
    "dark",
  );
  await page.locator("[data-fig-tanstack-start-hydrated]").waitFor();

  await page.getByRole("button", { name: "Light" }).click();
  await expect(page.locator("html")).toHaveClass(/(^| )light( |$)/);
  await page.reload({ waitUntil: "commit" });
  await expect(page.locator("html")).toHaveClass(/(^| )light( |$)/);
  expect(errors()).toEqual([]);
});

test("includes the Fig DevTools overlay", async ({ page }) => {
  const errors = collectBrowserErrors(page);
  await page.goto("/");

  await page.getByRole("button", { name: "Open TanStack Devtools" }).click();
  const devtools = page.locator("[data-fig-devtools]");
  await expect(devtools).toBeVisible();
  await expect(
    devtools.getByText("Fig DevTools", { exact: true }),
  ).toBeVisible();
  await expect(
    devtools.getByText("Fig TanStack Start", { exact: true }),
  ).toBeVisible();
  await expect(
    devtools.locator(".fig-devtools__tree-button").first(),
  ).toBeVisible();
  expect(errors()).toEqual([]);
});

test("themes card surfaces in dark mode", async ({ context, page }) => {
  await context.addCookies([
    {
      domain: "127.0.0.1",
      name: "fig-demo-theme",
      path: "/",
      value: "dark",
    },
  ]);

  await page.goto("/asset-lab");
  await expect(page.locator("[data-asset-lab]")).toHaveCSS(
    "background-color",
    "rgb(24, 36, 45)",
  );
  await expect(
    page.getByRole("button", { name: /Client asset island/ }),
  ).toHaveCSS("background-color", "rgb(24, 36, 45)");

  await page.getByRole("link", { name: "Transitions" }).click();
  await expect(page.locator("main article")).toHaveCSS(
    "background-color",
    "rgb(24, 36, 45)",
  );
  await expect(page.locator("main aside")).toHaveCSS(
    "background-color",
    "rgb(24, 36, 45)",
  );
});

test("renders and refreshes isomorphic and remote data resources", async ({
  page,
}) => {
  const errors = collectBrowserErrors(page);
  const serverFunctionRequests: string[] = [];
  page.on("request", (request) => {
    if (request.headers()["x-tsr-serverfn"] === "true") {
      serverFunctionRequests.push(request.url());
    }
  });

  await page.goto("/data", { waitUntil: "commit" });
  const isomorphic = page.locator('[data-data-value="Isomorphic"]');
  const remote = page.locator('[data-data-value="Remote server"]');
  await expect(isomorphic).toContainText("Hello Fig · server");
  await expect(remote).toContainText("Adapter-first routing · server-remote");
  expect(serverFunctionRequests).toEqual([]);

  await page.getByRole("button", { name: "Refresh isomorphic" }).click();
  await expect(isomorphic).toContainText("Hello Fig · browser · load 1");
  expect(serverFunctionRequests).toEqual([]);

  const remoteBefore = await remote.textContent();
  await page.getByRole("button", { name: "Refresh remote" }).click();
  await expect(remote).not.toHaveText(remoteBefore ?? "");
  expect(serverFunctionRequests).toHaveLength(1);

  await page
    .getByRole("link", { name: "Open server-only post Payload" })
    .click();
  await expect(
    page.getByRole("heading", { level: 2, name: "Hello Fig" }),
  ).toBeVisible();
  await expect(page.locator("[data-server-post]")).toContainText(
    "server-only Payload resource",
  );
  expect(serverFunctionRequests).toHaveLength(2);
  expect(errors()).toEqual([]);
});

test("commits a nonblocking payload route without publishing stale UI", async ({
  page,
}) => {
  const errors = collectBrowserErrors(page);
  await page.goto("/");

  await page.getByRole("link", { name: "Assets" }).click();
  await expect(page).toHaveURL(/\/asset-lab$/);
  await expect(page.locator("[data-asset-lab-pending]")).toBeVisible();

  await page.getByRole("link", { name: "Data" }).click();
  await expect(page.getByRole("heading", { name: "Data lab" })).toBeVisible();
  await page.waitForTimeout(600);

  await expect(page.locator("[data-asset-lab]")).toHaveCount(0);
  expect(errors()).toEqual([]);
});

test("adopts two embedded Payload resources and hydrates the asset island", async ({
  page,
  request,
}) => {
  const response = await request.get("/asset-lab");
  const html = await response.text();
  const assetSegment = '<section class="asset-lab-root" data-asset-lab';
  expect(html.match(/data-fig-tanstack-payload-key/g)).toHaveLength(2);
  expect(html).toContain(assetSegment);
  expect(html.indexOf('data-precedence="payload"')).toBeLessThan(
    html.indexOf(assetSegment),
  );

  const errors = collectBrowserErrors(page);
  const serverFunctionRequests: string[] = [];
  page.on("request", (request) => {
    if (request.headers()["x-tsr-serverfn"] === "true") {
      serverFunctionRequests.push(request.url());
    }
  });
  await page.goto("/asset-lab");

  await expect(page.locator("[data-asset-lab]")).toBeVisible();
  await expect(page.locator("[data-asset-note]")).toBeVisible();
  expect(serverFunctionRequests).toEqual([]);
  const island = page.getByRole("button", { name: /Client asset island/ });
  await expect(island).toContainText("clicks: 0");
  await island.click();
  await expect(island).toContainText("clicks: 1");
  expect(errors()).toEqual([]);
});

test("navigates nested, split, and not-found routes", async ({ page }) => {
  const errors = collectBrowserErrors(page);
  await page.goto("/");

  await page.getByRole("link", { name: "About" }).click();
  await expect(page.locator("[data-split-route]")).toBeVisible();
  await expect(page).toHaveTitle("About · Fig TanStack Start");

  await page.getByRole("link", { name: "Posts" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Posts" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Streaming data" }).click();
  await expect(
    page.getByRole("heading", { level: 2, name: "Streaming data" }),
  ).toBeVisible();
  expect(errors()).toEqual([]);

  await page.goto("/missing");
  await expect(
    page.getByRole("heading", { level: 1, name: "404" }),
  ).toBeVisible();
});

test("morphs the homepage link into the view-transition title", async ({
  page,
}) => {
  await page.addInitScript(() => {
    interface Surface {
      marker: string;
      name: string;
      tag: string;
    }
    interface Snapshot {
      after: Surface[];
      before: Surface[];
    }
    const state = window as Window & {
      __viewTransitionSnapshots?: Snapshot[];
    };
    const collect = (): Surface[] =>
      Array.from(document.querySelectorAll<HTMLElement>("*")).flatMap(
        (element) => {
          const name = element.style.viewTransitionName;
          return name.length === 0 || name === "none"
            ? []
            : [
                {
                  marker: element.dataset.viewTransitionSurface ?? "",
                  name,
                  tag: element.tagName.toLowerCase(),
                },
              ];
        },
      );
    state.__viewTransitionSnapshots = [];
    Object.defineProperty(document, "startViewTransition", {
      configurable: true,
      value: (update: () => void | Promise<void>) => {
        const before = collect();
        const finished = Promise.resolve(update()).then(() => {
          state.__viewTransitionSnapshots?.push({ after: collect(), before });
        });
        return { finished, ready: Promise.resolve() };
      },
    });
  });

  const errors = collectBrowserErrors(page);
  await page.goto("/");
  await page.getByRole("link", { name: "View transitions" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "View transitions" }),
  ).toBeVisible();
  const snapshots = await page.evaluate(
    () =>
      (
        window as Window & {
          __viewTransitionSnapshots?: Array<{
            after: Array<{ marker: string; name: string; tag: string }>;
            before: Array<{ marker: string; name: string; tag: string }>;
          }>;
        }
      ).__viewTransitionSnapshots ?? [],
  );
  expect(snapshots).toContainEqual({
    after: expect.arrayContaining([
      {
        marker: "page-title",
        name: "start-vt-page-title",
        tag: "span",
      },
    ]),
    before: expect.arrayContaining([
      {
        marker: "home-link",
        name: "start-vt-page-title",
        tag: "span",
      },
    ]),
  });
  expect(errors()).toEqual([]);
});

test("does not leak a skipped homepage view transition", async ({ page }) => {
  const errors = collectBrowserErrors(page);
  await page.goto("/");
  await page.getByRole("link", { name: "View transitions" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "View transitions" }),
  ).toBeVisible();
  await page.waitForTimeout(100);
  expect(errors()).toEqual([]);
});

test("animates the shared homepage title surface in Chromium", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const original = document.startViewTransition?.bind(document);
    if (original === undefined) return;
    const state = window as Window & {
      __nativeViewTransitionPseudos?: Promise<string[]>;
      __nativeViewTransitionStarts?: number;
    };
    state.__nativeViewTransitionStarts = 0;
    document.startViewTransition = (update) => {
      state.__nativeViewTransitionStarts =
        (state.__nativeViewTransitionStarts ?? 0) + 1;
      const transition = original(update);
      state.__nativeViewTransitionPseudos = transition.ready.then(() =>
        document.getAnimations().flatMap((animation) => {
          const pseudo = (animation.effect as KeyframeEffect | null)
            ?.pseudoElement;
          return pseudo === null || pseudo === undefined ? [] : [pseudo];
        }),
      );
      return transition;
    };
  });
  await page.goto("/");
  expect(await page.evaluate(() => typeof document.startViewTransition)).toBe(
    "function",
  );
  await page.getByRole("link", { name: "View transitions" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "View transitions" }),
  ).toBeVisible();

  const pseudos = await page.evaluate(
    () =>
      (
        window as Window & {
          __nativeViewTransitionPseudos?: Promise<string[]>;
        }
      ).__nativeViewTransitionPseudos,
  );
  expect(pseudos).toContain("::view-transition-group(start-vt-page-title)");
  expect(
    await page.evaluate(
      () =>
        (
          window as Window & {
            __nativeViewTransitionStarts?: number;
          }
        ).__nativeViewTransitionStarts,
    ),
  ).toBe(1);
});
