// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "./router.tsx";
import {
  registerNavigationBlocker,
  runNavigationAttempt,
} from "./navigation-lifecycle.ts";

describe("navigation broker", () => {
  it("settles an attributed attempt when a blocker rejects", async () => {
    const router = makeRouter();
    const blockHistory = vi.spyOn(router.history, "block");
    const failure = new Error("blocker failed");
    const unregister = registerNavigationBlocker(router, {
      blockerFn: async () => {
        throw failure;
      },
      enableBeforeUnload: () => true,
    });
    const historyBlocker = blockHistory.mock.calls[0]?.[0];
    if (historyBlocker === undefined) throw new Error("Missing blocker.");
    const cancel = vi.fn();
    let blockerResult: Promise<boolean> | undefined;

    const attempt = runNavigationAttempt(router, cancel, () => {
      blockerResult = historyBlocker.blockerFn({
        action: "PUSH",
        currentLocation: router.history.location,
        nextLocation: {
          ...router.history.location,
          href: "/next",
          pathname: "/next",
        },
      });
    });
    if (blockerResult === undefined) throw new Error("Blocker did not run.");
    await expect(blockerResult).rejects.toBe(failure);

    expect(attempt.isBlockerPending()).toBe(false);
    expect(cancel).toHaveBeenCalledOnce();
    unregister();
  });

  it("reports blocked attempts through one history blocker", async () => {
    const router = makeRouter();
    const blockHistory = vi.spyOn(router.history, "block");
    let enableSecondBeforeUnload = true;
    const unregisterFirst = registerNavigationBlocker(router, {
      blockerFn: () => false,
      enableBeforeUnload: () => false,
    });
    const unregister = registerNavigationBlocker(router, {
      blockerFn: () => true,
      enableBeforeUnload: () => enableSecondBeforeUnload,
    });

    let finish!: () => void;
    const finished = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const cancel = vi.fn(finish);
    runNavigationAttempt(router, cancel, () => router.history.push("/next"));
    await finished;

    expect(blockHistory).toHaveBeenCalledOnce();
    const historyBlocker = blockHistory.mock.calls[0]?.[0];
    if (typeof historyBlocker?.enableBeforeUnload !== "function") {
      throw new Error("Missing aggregated before-unload callback.");
    }
    expect(historyBlocker.enableBeforeUnload()).toBe(true);
    enableSecondBeforeUnload = false;
    expect(historyBlocker.enableBeforeUnload()).toBe(false);
    expect(cancel).toHaveBeenCalledOnce();
    expect(router.history.location.pathname).toBe("/");
    unregisterFirst();
    unregister();
  });

  it("does not attribute a blocked programmatic navigation to an active link", async () => {
    const router = makeRouter();
    let reportBlocked!: () => void;
    const blocked = new Promise<void>((resolve) => {
      reportBlocked = resolve;
    });
    const unregister = registerNavigationBlocker(router, {
      blockerFn: ({ nextLocation }) => {
        const shouldBlock = nextLocation.pathname === "/blocked";
        if (shouldBlock) reportBlocked();
        return shouldBlock;
      },
      enableBeforeUnload: () => true,
    });
    const cancelLink = vi.fn();

    runNavigationAttempt(router, cancelLink, () =>
      router.history.push("/next"),
    );
    await waitForPath(router, "/next");
    router.history.push("/blocked");
    await blocked;

    expect(cancelLink).not.toHaveBeenCalled();
    expect(router.history.location.pathname).toBe("/next");
    unregister();
  });

  it("keeps attempts associated across concurrent async blockers", async () => {
    const router = makeRouter();
    let releaseFirst!: () => void;
    const firstCanContinue = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const unregisterFirst = registerNavigationBlocker(router, {
      blockerFn: async ({ nextLocation }) => {
        if (nextLocation.pathname === "/first") await firstCanContinue;
        return false;
      },
      enableBeforeUnload: () => true,
    });
    const unregisterSecond = registerNavigationBlocker(router, {
      blockerFn: ({ nextLocation }) => nextLocation.pathname === "/first",
      enableBeforeUnload: () => true,
    });
    let reportFirstCanceled!: () => void;
    const firstCanceled = new Promise<void>((resolve) => {
      reportFirstCanceled = resolve;
    });
    const cancelFirst = vi.fn(reportFirstCanceled);
    const cancelSecond = vi.fn();

    runNavigationAttempt(router, cancelFirst, () =>
      router.history.push("/first"),
    );
    runNavigationAttempt(router, cancelSecond, () =>
      router.history.push("/next"),
    );
    await waitForPath(router, "/next");
    releaseFirst();
    await firstCanceled;

    expect(cancelFirst).toHaveBeenCalledOnce();
    expect(cancelSecond).not.toHaveBeenCalled();
    expect(router.history.location.pathname).toBe("/next");
    unregisterFirst();
    unregisterSecond();
  });
});

function makeRouter() {
  const rootRoute = createRootRoute();
  const nextRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "next",
  });
  return createRouter({
    history: createMemoryHistory({ initialEntries: ["/"] }),
    routeTree: rootRoute.addChildren([nextRoute]),
  });
}

async function waitForPath(
  router: ReturnType<typeof makeRouter>,
  pathname: string,
): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (router.history.location.pathname === pathname) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error(`History did not navigate to ${pathname}.`);
}
