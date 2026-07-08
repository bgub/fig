import { expect, type Page, test } from "@playwright/test";
import { collectBrowserErrors } from "./browser-errors.ts";

interface ViewTransitionSurface {
  name: string;
  rect: {
    height: number;
    width: number;
  };
  tag: string;
}

interface ViewTransitionSnapshot {
  action: string;
  after: ViewTransitionSurface[];
  before: ViewTransitionSurface[];
}

declare global {
  interface Window {
    __figStartViewTransitionAction?: string;
    __figStartViewTransitionSnapshots?: ViewTransitionSnapshot[];
  }
}

test("turns the home link into the view transitions page title", async ({
  page,
}) => {
  const errors = collectBrowserErrors(page);

  await page.addInitScript(() => {
    const snapshots: ViewTransitionSnapshot[] = [];
    const collectSurfaces = (): ViewTransitionSurface[] =>
      Array.from(document.querySelectorAll<HTMLElement>("*")).flatMap(
        (element) => {
          const name = element.style.viewTransitionName;
          if (name.length === 0 || name === "none") return [];
          const rect = element.getBoundingClientRect();
          return [
            {
              name,
              rect: {
                height: rect.height,
                width: rect.width,
              },
              tag: element.tagName.toLowerCase(),
            },
          ];
        },
      );

    window.__figStartViewTransitionSnapshots = snapshots;
    Object.defineProperty(document, "startViewTransition", {
      configurable: true,
      value: (update: () => void) => {
        const action = window.__figStartViewTransitionAction ?? "";
        const before = collectSurfaces();
        update();
        const after = collectSurfaces();
        snapshots.push({ action, after, before });
        return {
          finished: Promise.resolve(),
          ready: Promise.resolve(),
        };
      },
    });
  });

  await page.goto("/", { waitUntil: "commit" });
  await page.waitForLoadState("networkidle");

  await clickRoute(page, "home-to-transitions-1", "View transitions");
  await expect(
    page.getByRole("heading", { level: 1, name: "View transitions" }),
  ).toBeVisible();

  await clickRoute(page, "transitions-to-home-1", "Home");
  await expect(
    page.getByRole("heading", { level: 1, name: "Welcome to Fig Start" }),
  ).toBeVisible();

  await clickRoute(page, "home-to-transitions-2", "View transitions");
  await expect(
    page.getByRole("heading", { level: 1, name: "View transitions" }),
  ).toBeVisible();

  await clickRoute(page, "transitions-to-home-2", "Home");
  await expect(
    page.getByRole("heading", { level: 1, name: "Welcome to Fig Start" }),
  ).toBeVisible();

  await clickRoute(page, "home-to-about", "About");
  await expect(
    page.getByRole("heading", { level: 1, name: "About" }),
  ).toBeVisible();

  await clickRoute(page, "about-to-home", "Home");
  await expect(
    page.getByRole("heading", { level: 1, name: "Welcome to Fig Start" }),
  ).toBeVisible();

  await clickRoute(
    page,
    "home-to-transitions-after-detour",
    "View transitions",
  );
  await expect(
    page.getByRole("heading", { level: 1, name: "View transitions" }),
  ).toBeVisible();

  const snapshots = await page.evaluate(
    () => window.__figStartViewTransitionSnapshots ?? [],
  );
  expectPageTitleTransition(snapshots, "home-to-transitions-1");
  expectPageTitleTransition(snapshots, "home-to-transitions-2");
  expectPageTitleTransition(snapshots, "home-to-transitions-after-detour");
  expect(errors()).toEqual([]);
});

async function clickRoute(
  page: Page,
  action: string,
  linkName: string,
): Promise<void> {
  await page.evaluate((value) => {
    window.__figStartViewTransitionAction = value;
  }, action);
  await page.getByRole("link", { exact: true, name: linkName }).click();
}

function expectPageTitleTransition(
  snapshots: ViewTransitionSnapshot[],
  action: string,
): void {
  const snapshot = snapshots.find(
    (entry) =>
      entry.action === action &&
      entry.before.some(
        (surface) =>
          surface.name === "start-vt-page-title" && surface.tag === "a",
      ) &&
      entry.after.some(
        (surface) =>
          surface.name === "start-vt-page-title" && surface.tag === "span",
      ),
  );
  expect(snapshot).toBeDefined();
  const before = snapshot?.before.find(
    (surface) => surface.name === "start-vt-page-title",
  );
  const after = snapshot?.after.find(
    (surface) => surface.name === "start-vt-page-title",
  );

  expect(before).toMatchObject({ tag: "a" });
  expect(after).toMatchObject({ tag: "span" });
  expect(after?.rect.width).toBeLessThan(260);
  expect(after?.rect.height).toBeGreaterThan(before?.rect.height ?? 0);
}
