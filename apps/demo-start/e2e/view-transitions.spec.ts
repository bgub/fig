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
  // Every transition must be attributable to a navigation click. An entry
  // without an action fired outside one — the first-load hydration retry
  // used to enter-fade every annotated surface this way.
  expect(snapshots.filter((snapshot) => snapshot.action === "")).toEqual([]);
  expect(errors()).toEqual([]);
});

test("morphs the title when clicking immediately after first load", async ({
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
              rect: { height: rect.height, width: rect.width },
              tag: element.tagName.toLowerCase(),
            },
          ];
        },
      );

    window.__figStartViewTransitionSnapshots = snapshots;
    Object.defineProperty(document, "startViewTransition", {
      configurable: true,
      value: (update: () => void) => {
        const before = collectSurfaces();
        update();
        snapshots.push({
          action: "immediate",
          after: collectSurfaces(),
          before,
        });
        return { finished: Promise.resolve(), ready: Promise.resolve() };
      },
    });
  });

  // Pin the "clicked right after hydration, before anything else" regime:
  // earlier clicks fall back to native MPA navigation (no SPA transition by
  // design), later ones were always fine. The first post-hydration commit
  // (the router's pending state) used to read hydrated single-text shape
  // collapse as a content mutation and burn a no-op transition here,
  // deferring and disrupting the real morph.
  await page.goto("/", { waitUntil: "commit" });
  await page.locator("[data-fig-start-hydrated]").waitFor();
  await page.waitForFunction(() => {
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_COMMENT,
    );
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if ((node.nodeValue ?? "").startsWith("fig:suspense:")) return false;
    }
    return true;
  });
  await page
    .getByRole("link", { exact: true, name: "View transitions" })
    .click();
  await expect(
    page.getByRole("heading", { level: 1, name: "View transitions" }),
  ).toBeVisible();

  const snapshots = await page.evaluate(
    () => window.__figStartViewTransitionSnapshots ?? [],
  );
  expect(snapshots).toHaveLength(1);
  expectPageTitleTransition(snapshots, "immediate");
  expect(errors()).toEqual([]);
});

test("coalesces rapid cycle clicks into the latest state (render-during-wait)", async ({
  page,
}) => {
  const errors = collectBrowserErrors(page);

  await page.addInitScript(() => {
    const scope = window as Window & {
      __vtStarts?: number;
      __vtRelease?: (() => void) | null;
    };
    scope.__vtStarts = 0;
    scope.__vtRelease = null;
    Object.defineProperty(document, "startViewTransition", {
      configurable: true,
      value: (update: () => void) => {
        update();
        scope.__vtStarts = (scope.__vtStarts ?? 0) + 1;
        let release: () => void = () => undefined;
        const finished = new Promise<void>((resolve) => {
          release = resolve;
        });
        scope.__vtRelease = release;
        return { finished, ready: Promise.resolve() };
      },
    });
  });

  await page.goto("/view-transitions", { waitUntil: "commit" });
  await page.waitForLoadState("networkidle");
  const cycle = page.getByRole("button", { name: "Cycle surface" });
  const detail = page.locator("aside h2");
  await expect(detail).toHaveText("Route shell");

  // Two rapid clicks while the first animation is held open. The first
  // commit animates; the second click's commit parks — but its RENDER
  // happens live and the parked state tracks the latest click (React's
  // suspend-commits model), so releasing the animation commits the second
  // click's state directly in one more transition.
  await cycle.click();
  await expect(detail).toHaveText("Stream slot");
  await cycle.click();

  await expect(detail).toHaveText("Stream slot");
  expect(
    await page.evaluate(() => (window as { __vtStarts?: number }).__vtStarts),
  ).toBe(1);

  await page.evaluate(() => {
    (window as { __vtRelease?: (() => void) | null }).__vtRelease?.();
  });

  await expect(detail).toHaveText("Hydrated island");
  expect(
    await page.evaluate(() => (window as { __vtStarts?: number }).__vtStarts),
  ).toBe(2);

  // Settle the second transition so nothing leaks into other tests.
  await page.evaluate(() => {
    (window as { __vtRelease?: (() => void) | null }).__vtRelease?.();
  });
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
