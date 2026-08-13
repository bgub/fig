// @vitest-environment happy-dom
import { createElement, type FigNode, useState } from "@bgub/fig";
import { createRoot } from "@bgub/fig-dom";
import { act } from "@bgub/fig-dom/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type AnyRouter,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Link,
  type LinkRenderState,
  Outlet,
  RouterProvider,
  useBlocker,
} from "./router.tsx";

const mountedRoots: Array<ReturnType<typeof createRoot>> = [];
const dangerousUrl: string = "javascript:alert(1)";
const externalUrl: string = "https://example.com/";

afterEach(() => {
  for (const root of mountedRoots.splice(0)) root.unmount();
  vi.restoreAllMocks();
});

describe("Link", () => {
  it("uses a native anchor and only hijacks unmodified primary clicks", async () => {
    const router = makeLinkRouter();
    const container = document.createElement("div");
    const root = createRoot(container);
    mountedRoots.push(root);

    await router.load();
    await act(() => root.render(createElement(RouterProvider, { router })));

    const link = container.querySelector<HTMLAnchorElement>("#user-link");
    expect(link?.getAttribute("href")).toBe("/users/42?tab=profile");
    expect(link?.getAttribute("data-status")).toBeNull();
    expect(link?.getAttribute("data-link-state")).toBe("inactive");
    expect(link?.className).toBe("base inactive");
    expect(link?.textContent).toBe("inactive:idle");
    expect(link?.style.color).toBe("gray");
    expect(link?.hasAttribute("viewtransition")).toBe(false);

    const externalLink =
      container.querySelector<HTMLAnchorElement>("#external-link");
    expect(externalLink?.getAttribute("href")).toBe(externalUrl);
    const externalClick = new MouseEvent("click", {
      bubbles: true,
      button: 0,
      cancelable: true,
    });
    externalLink?.dispatchEvent(externalClick);
    expect(externalClick.defaultPrevented).toBe(false);
    expect(router.stores.location.get().pathname).toBe("/");

    const modifiedClick = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
    });
    link?.dispatchEvent(modifiedClick);
    expect(modifiedClick.defaultPrevented).toBe(false);
    expect(router.stores.location.get().pathname).toBe("/");

    const click = new MouseEvent("click", {
      bubbles: true,
      button: 0,
      cancelable: true,
    });
    await act(async () => {
      link?.dispatchEvent(click);
      await waitForPath(router, "/users/42");
    });

    expect(click.defaultPrevented).toBe(true);
    expect(container.querySelector("h1")?.textContent).toBe("User 42");
    expect(link?.getAttribute("data-status")).toBe("active");
    expect(link?.getAttribute("data-link-state")).toBe("active");
    expect(link?.className).toBe("base active");
    expect(link?.textContent).toBe("active:idle");
    expect(link?.style.color).toBe("green");
    expect(router.stores.status.get()).toBe("idle");

    const preload = vi.spyOn(router, "preloadRoute");
    container
      .querySelector<HTMLAnchorElement>("#preload-link")
      ?.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
    expect(preload).toHaveBeenCalledOnce();
  });

  it("remounts client behavior when the router mode changes", async () => {
    const router = makeLinkRouter();
    const container = document.createElement("div");
    const root = createRoot(container);
    mountedRoots.push(root);

    await router.load();
    await act(() =>
      root.render(createElement(RouterProvider, { isServer: false, router })),
    );
    await act(() =>
      root.render(createElement(RouterProvider, { isServer: true, router })),
    );

    const serverClick = new MouseEvent("click", {
      bubbles: true,
      button: 0,
      cancelable: true,
    });
    container
      .querySelector<HTMLAnchorElement>("#user-link")
      ?.dispatchEvent(serverClick);
    expect(serverClick.defaultPrevented).toBe(false);
    expect(router.stores.location.get().pathname).toBe("/");

    await act(() =>
      root.render(createElement(RouterProvider, { isServer: false, router })),
    );
    const clientClick = new MouseEvent("click", {
      bubbles: true,
      button: 0,
      cancelable: true,
    });
    await act(async () => {
      container
        .querySelector<HTMLAnchorElement>("#user-link")
        ?.dispatchEvent(clientClick);
      await waitForPath(router, "/users/42");
    });

    expect(clientClick.defaultPrevented).toBe(true);
  });

  it("blocks dangerous explicit and external protocols", async () => {
    const rootRoute = createRootRoute({
      component: () => (
        <main>
          <Link href={dangerousUrl} id="explicit-dangerous" to="/">
            Explicit
          </Link>
          <Link id="safe-external" to={externalUrl}>
            Safe external
          </Link>
          <Link id="dangerous-external" to={dangerousUrl}>
            Dangerous external
          </Link>
        </main>
      ),
    });
    const router = createRouter({
      history: createMemoryHistory({ initialEntries: ["/"] }),
      routeTree: rootRoute,
    });
    const container = document.createElement("div");
    const root = createRoot(container);
    mountedRoots.push(root);

    await router.load();
    await act(() => root.render(createElement(RouterProvider, { router })));

    expect(
      container.querySelector("#explicit-dangerous")?.hasAttribute("href"),
    ).toBe(false);
    expect(
      container.querySelector("#safe-external")?.getAttribute("href"),
    ).toBe(externalUrl);
    expect(
      container.querySelector("#dangerous-external")?.hasAttribute("href"),
    ).toBe(false);
  });

  it("keeps activity on the resolved route while navigation is pending", async () => {
    const router = makeLinkRouter();
    const container = document.createElement("div");
    const root = createRoot(container);
    mountedRoots.push(root);

    await router.load();
    await act(() => root.render(createElement(RouterProvider, { router })));
    const link = container.querySelector<HTMLAnchorElement>("#user-link");
    const pending = router.buildLocation({
      params: { id: "42" },
      search: { tab: "profile" },
      to: "/users/$id",
    });

    await act(() => router.stores.location.set(pending));
    expect(link?.getAttribute("data-status")).toBeNull();

    await act(() => router.stores.resolvedLocation.set(pending));
    expect(link?.getAttribute("data-status")).toBe("active");
  });

  it("omits href and exposes native accessibility state when disabled", async () => {
    const rootRoute = createRootRoute({
      component: () => (
        <Link disabled id="disabled-link" to="/">
          Next
        </Link>
      ),
    });
    const router = createRouter({
      history: createMemoryHistory({ initialEntries: ["/"] }),
      routeTree: rootRoute,
    });
    const container = document.createElement("div");
    const root = createRoot(container);
    mountedRoots.push(root);

    await router.load();
    await act(() => root.render(createElement(RouterProvider, { router })));

    const link = container.querySelector<HTMLAnchorElement>("#disabled-link");
    expect(link?.hasAttribute("href")).toBe(false);
    expect(link?.getAttribute("aria-disabled")).toBe("true");
    expect(link?.getAttribute("role")).toBe("link");

    const click = new MouseEvent("click", {
      bubbles: true,
      button: 0,
      cancelable: true,
    });
    link?.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(false);
    expect(router.stores.location.get().pathname).toBe("/");
  });

  it("preloads the current destination when a stable mask hides a change", async () => {
    let setDestination: ((destination: "/a" | "/b") => void) | undefined;

    function Layout(): FigNode {
      const [destination, updateDestination] = useState<"/a" | "/b">("/a");
      setDestination = updateDestination;
      return createElement(
        Link,
        {
          id: "masked-link",
          mask: { to: "/masked" },
          preload: "render",
          to: destination,
        } as never,
        "Masked",
      );
    }

    const rootRoute = createRootRoute({ component: Layout });
    const routeA = createRoute({
      component: () => null,
      getParentRoute: () => rootRoute,
      path: "a",
    });
    const routeB = createRoute({
      component: () => null,
      getParentRoute: () => rootRoute,
      path: "b",
    });
    const maskedRoute = createRoute({
      component: () => null,
      getParentRoute: () => rootRoute,
      path: "masked",
    });
    const router = createRouter({
      history: createMemoryHistory({ initialEntries: ["/"] }),
      routeTree: rootRoute.addChildren([routeA, routeB, maskedRoute]),
    });
    await router.load();
    const preloadRoute = vi.spyOn(router, "preloadRoute");
    const container = document.createElement("div");
    const root = createRoot(container);
    mountedRoots.push(root);

    await act(() => root.render(createElement(RouterProvider, { router })));
    expect(router.isServer).toBe(false);
    const link = container.querySelector<HTMLAnchorElement>("#masked-link");
    expect(link?.getAttribute("href")).toBe("/masked");
    const initialPreloads = preloadRoute.mock.calls.length;
    expect(initialPreloads).toBeGreaterThan(0);
    for (const [options] of preloadRoute.mock.calls) {
      expect(options).toMatchObject({ to: "/a" });
    }

    await act(() => setDestination?.("/b"));
    const updatedLink =
      container.querySelector<HTMLAnchorElement>("#masked-link");
    expect(updatedLink?.getAttribute("href")).toBe("/masked");

    expect(preloadRoute.mock.calls.length).toBeGreaterThan(initialPreloads);
    expect(preloadRoute.mock.calls.at(-1)?.[0]).toMatchObject({ to: "/b" });
  });

  it("preloads the render destination again after replacing the router", async () => {
    let replaceRouter:
      | ((router: ReturnType<typeof makeRenderPreloadRouter>) => void)
      | undefined;
    const firstRouter = makeRenderPreloadRouter();
    const secondRouter = makeRenderPreloadRouter();
    await firstRouter.load();
    await secondRouter.load();
    const firstPreload = vi.spyOn(firstRouter, "preloadRoute");
    const secondPreload = vi.spyOn(secondRouter, "preloadRoute");

    function App(): FigNode {
      const [router, setRouter] = useState(firstRouter);
      replaceRouter = setRouter;
      return createElement(RouterProvider, { router });
    }

    const container = document.createElement("div");
    const root = createRoot(container);
    mountedRoots.push(root);

    await act(() => root.render(createElement(App)));
    expect(container.querySelector("#render-preload-link")).not.toBeNull();
    expect(firstPreload).toHaveBeenCalled();
    expect(secondPreload).not.toHaveBeenCalled();

    await act(() => replaceRouter?.(secondRouter));

    expect(container.querySelector("#render-preload-link")).not.toBeNull();
    expect(secondPreload).toHaveBeenCalled();
  });

  it("clears an in-flight transition after replacing the router", async () => {
    let releaseSlowRoute: (() => void) | undefined;
    const slowRoute = new Promise<void>((resolve) => {
      releaseSlowRoute = resolve;
    });
    const firstRouter = makeRenderPreloadRouter(() => slowRoute);
    const secondRouter = makeRenderPreloadRouter();
    await firstRouter.load();
    await secondRouter.load();
    let replaceRouter:
      | ((router: ReturnType<typeof makeRenderPreloadRouter>) => void)
      | undefined;

    function App(): FigNode {
      const [router, setRouter] = useState(firstRouter);
      replaceRouter = setRouter;
      return createElement(RouterProvider, { router });
    }

    const container = document.createElement("div");
    const root = createRoot(container);
    mountedRoots.push(root);

    await act(() => root.render(createElement(App)));
    const link = container.querySelector<HTMLAnchorElement>(
      "#render-preload-link",
    );
    link?.dispatchEvent(
      new MouseEvent("click", { bubbles: true, button: 0, cancelable: true }),
    );
    await waitForText(link, "transitioning");

    await act(() => replaceRouter?.(secondRouter));
    await waitForText(link, "idle");

    expect(firstRouter.history.location.pathname).toBe("/next");
    expect(secondRouter.history.location.pathname).toBe("/");
    releaseSlowRoute?.();
  });

  it("uses the latest committed destination for intent preloads", async () => {
    let setDestination: ((destination: "/a" | "/b") => void) | undefined;
    function Layout(): FigNode {
      const [destination, updateDestination] = useState<"/a" | "/b">("/a");
      setDestination = updateDestination;
      return createElement(
        Link,
        {
          id: "intent-link",
          mask: { to: "/masked" },
          preload: "intent",
          preloadDelay: 0,
          to: destination,
        } as never,
        "Masked",
      );
    }

    const rootRoute = createRootRoute({ component: Layout });
    const routeA = createRoute({
      component: () => null,
      getParentRoute: () => rootRoute,
      path: "a",
    });
    const routeB = createRoute({
      component: () => null,
      getParentRoute: () => rootRoute,
      path: "b",
    });
    const maskedRoute = createRoute({
      component: () => null,
      getParentRoute: () => rootRoute,
      path: "masked",
    });
    const router = createRouter({
      history: createMemoryHistory({ initialEntries: ["/"] }),
      routeTree: rootRoute.addChildren([routeA, routeB, maskedRoute]),
    });
    await router.load();
    const preloadRoute = vi.spyOn(router, "preloadRoute");
    const container = document.createElement("div");
    const root = createRoot(container);
    mountedRoots.push(root);

    await act(() => root.render(createElement(RouterProvider, { router })));
    await act(() => setDestination?.("/b"));
    const link = container.querySelector<HTMLAnchorElement>("#intent-link");
    expect(link?.getAttribute("href")).toBe("/masked");

    link?.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));

    expect(preloadRoute).toHaveBeenCalledOnce();
    expect(preloadRoute.mock.calls[0]?.[0]).toMatchObject({ to: "/b" });
  });

  it("cancels delayed intent preloading when the link becomes disabled", async () => {
    let disableLink: (() => void) | undefined;

    function Layout(): FigNode {
      const [disabled, setDisabled] = useState(false);
      disableLink = () => setDisabled(true);
      return createElement(
        Link,
        {
          disabled,
          id: "delayed-intent-link",
          preload: "intent",
          preloadDelay: 10,
          to: "/next",
        } as never,
        "Next",
      );
    }

    const rootRoute = createRootRoute({ component: Layout });
    const homeRoute = createRoute({
      component: () => null,
      getParentRoute: () => rootRoute,
      path: "/",
    });
    const nextRoute = createRoute({
      component: () => null,
      getParentRoute: () => rootRoute,
      path: "next",
    });
    const router = createRouter({
      history: createMemoryHistory({ initialEntries: ["/"] }),
      routeTree: rootRoute.addChildren([homeRoute, nextRoute]),
    });
    await router.load();
    const preloadRoute = vi.spyOn(router, "preloadRoute");
    const container = document.createElement("div");
    const root = createRoot(container);
    mountedRoots.push(root);

    await act(() => root.render(createElement(RouterProvider, { router })));
    container
      .querySelector("#delayed-intent-link")
      ?.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
    await act(() => disableLink?.());
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(preloadRoute).not.toHaveBeenCalled();
  });

  it("clears transition state when an inline resolver blocker is reset", async () => {
    let resolver: ReturnType<typeof useBlocker<AnyRouter, true>> | undefined;

    function Layout(): FigNode {
      resolver = useBlocker({
        enableBeforeUnload: () => true,
        shouldBlockFn: () => true,
        withResolver: true,
      });
      return createElement(
        "main",
        null,
        createElement(Link, {
          children: ({ isTransitioning }: LinkRenderState) =>
            isTransitioning ? "transitioning" : "idle",
          id: "blocked-link",
          to: "/next",
        }),
        createElement(Outlet),
      );
    }

    const rootRoute = createRootRoute({ component: Layout });
    const homeRoute = createRoute({
      component: () => null,
      getParentRoute: () => rootRoute,
      path: "/",
    });
    const nextRoute = createRoute({
      component: () => null,
      getParentRoute: () => rootRoute,
      path: "next",
    });
    const router = createRouter({
      history: createMemoryHistory({ initialEntries: ["/"] }),
      routeTree: rootRoute.addChildren([homeRoute, nextRoute]),
    });
    await router.load();
    const container = document.createElement("div");
    const root = createRoot(container);
    mountedRoots.push(root);

    await act(() => root.render(createElement(RouterProvider, { router })));
    const link = container.querySelector<HTMLAnchorElement>("#blocked-link");
    link?.dispatchEvent(
      new MouseEvent("click", { bubbles: true, button: 0, cancelable: true }),
    );
    await waitForText(link, "transitioning");
    await waitForBlocker(() => resolver);

    if (resolver?.status !== "blocked") throw new Error("Missing blocker.");
    resolver.reset();
    await waitForText(link, "idle");

    expect(router.history.location.pathname).toBe("/");
  });

  it("queues overlapping resolver attempts until each one settles", async () => {
    let resolver: ReturnType<typeof useBlocker<AnyRouter, true>> | undefined;
    let resolveFirstDecision: ((blocked: boolean) => void) | undefined;
    let resolveSecondDecision: ((blocked: boolean) => void) | undefined;
    const firstDecision = new Promise<boolean>((resolve) => {
      resolveFirstDecision = resolve;
    });
    const secondDecision = new Promise<boolean>((resolve) => {
      resolveSecondDecision = resolve;
    });
    const shouldBlockFn = vi.fn(({ next }: { next: { pathname: string } }) =>
      next.pathname === "/first" ? firstDecision : secondDecision,
    );

    function Layout(): FigNode {
      resolver = useBlocker({
        shouldBlockFn,
        withResolver: true,
      });
      return createElement(
        "main",
        null,
        createElement(Link, {
          children: ({ isTransitioning }: LinkRenderState) =>
            isTransitioning ? "first:transitioning" : "first:idle",
          id: "first-blocked-link",
          to: "/first",
        }),
        createElement(Link, {
          children: ({ isTransitioning }: LinkRenderState) =>
            isTransitioning ? "second:transitioning" : "second:idle",
          id: "second-blocked-link",
          to: "/second",
        }),
        createElement(Outlet),
      );
    }

    const rootRoute = createRootRoute({ component: Layout });
    const homeRoute = createRoute({
      component: () => null,
      getParentRoute: () => rootRoute,
      path: "/",
    });
    const firstRoute = createRoute({
      component: () => null,
      getParentRoute: () => rootRoute,
      path: "first",
    });
    const secondRoute = createRoute({
      component: () => null,
      getParentRoute: () => rootRoute,
      path: "second",
    });
    const router = createRouter({
      history: createMemoryHistory({ initialEntries: ["/"] }),
      routeTree: rootRoute.addChildren([homeRoute, firstRoute, secondRoute]),
    });
    await router.load();
    const container = document.createElement("div");
    const root = createRoot(container);
    mountedRoots.push(root);

    await act(() => root.render(createElement(RouterProvider, { router })));
    const firstLink = container.querySelector<HTMLAnchorElement>(
      "#first-blocked-link",
    );
    const secondLink = container.querySelector<HTMLAnchorElement>(
      "#second-blocked-link",
    );

    firstLink?.dispatchEvent(
      new MouseEvent("click", { bubbles: true, button: 0, cancelable: true }),
    );

    secondLink?.dispatchEvent(
      new MouseEvent("click", { bubbles: true, button: 0, cancelable: true }),
    );
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (shouldBlockFn.mock.calls.length === 2) break;
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect(shouldBlockFn).toHaveBeenCalledTimes(2);
    await act(async () => {
      resolveSecondDecision?.(true);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(resolver?.status).toBe("idle");

    resolveFirstDecision?.(true);
    await waitForBlockerPath(() => resolver, "/first");
    if (resolver?.status !== "blocked") throw new Error("Missing blocker.");
    expect(resolver.next.pathname).toBe("/first");

    resolver.proceed();
    await waitForText(firstLink, "first:idle");
    await waitForText(secondLink, "second:transitioning");
    await waitForPath(router, "/first");
    await waitForBlockerPath(() => resolver, "/second");

    if (resolver?.status !== "blocked") throw new Error("Missing blocker.");
    expect(resolver.next.pathname).toBe("/second");
    resolver.reset();
    await waitForText(secondLink, "second:idle");

    expect(router.history.location.pathname).toBe("/first");
  });

  it("discards an async resolver decision after the blocker is disabled", async () => {
    let disableBlocker: (() => void) | undefined;
    let releaseDecision: ((blocked: boolean) => void) | undefined;
    let resolver: ReturnType<typeof useBlocker<AnyRouter, true>> | undefined;
    const decision = new Promise<boolean>((resolve) => {
      releaseDecision = resolve;
    });
    const shouldBlockFn = vi.fn(() => decision);

    function Layout(): FigNode {
      const [disabled, setDisabled] = useState(false);
      disableBlocker = () => setDisabled(true);
      resolver = useBlocker({ disabled, shouldBlockFn, withResolver: true });
      return createElement(
        "main",
        null,
        createElement(Link, {
          children: ({ isTransitioning }: LinkRenderState) =>
            isTransitioning ? "transitioning" : "idle",
          id: "async-blocked-link",
          to: "/next",
        }),
        createElement(Outlet),
      );
    }

    const rootRoute = createRootRoute({ component: Layout });
    const homeRoute = createRoute({
      component: () => null,
      getParentRoute: () => rootRoute,
      path: "/",
    });
    const nextRoute = createRoute({
      component: () => null,
      getParentRoute: () => rootRoute,
      path: "next",
    });
    const router = createRouter({
      history: createMemoryHistory({ initialEntries: ["/"] }),
      routeTree: rootRoute.addChildren([homeRoute, nextRoute]),
    });
    await router.load();
    const container = document.createElement("div");
    const root = createRoot(container);
    mountedRoots.push(root);

    await act(() => root.render(createElement(RouterProvider, { router })));
    const link = container.querySelector<HTMLAnchorElement>(
      "#async-blocked-link",
    );
    link?.dispatchEvent(
      new MouseEvent("click", { bubbles: true, button: 0, cancelable: true }),
    );
    await waitForText(link, "transitioning");
    expect(shouldBlockFn).toHaveBeenCalledOnce();

    await act(() => disableBlocker?.());
    releaseDecision?.(true);
    await act(() => waitForPath(router, "/next"));
    await waitForText(link, "idle");

    expect(resolver?.status).toBe("idle");
  });

  it("skips a queued blocker callback after the blocker is disabled", async () => {
    let disableSecondBlocker: (() => void) | undefined;
    let releaseFirstDecision: ((blocked: boolean) => void) | undefined;
    const firstDecision = new Promise<boolean>((resolve) => {
      releaseFirstDecision = resolve;
    });
    const firstShouldBlock = vi.fn(() => firstDecision);
    const secondShouldBlock = vi.fn(() => false);

    function Layout(): FigNode {
      const [secondDisabled, setSecondDisabled] = useState(false);
      disableSecondBlocker = () => setSecondDisabled(true);
      useBlocker({ shouldBlockFn: firstShouldBlock });
      useBlocker({
        disabled: secondDisabled,
        shouldBlockFn: secondShouldBlock,
      });
      return createElement(
        "main",
        null,
        createElement(Link, {
          children: ({ isTransitioning }: LinkRenderState) =>
            isTransitioning ? "transitioning" : "idle",
          id: "queued-blocker-link",
          to: "/next",
        }),
        createElement(Outlet),
      );
    }

    const rootRoute = createRootRoute({ component: Layout });
    const homeRoute = createRoute({
      component: () => null,
      getParentRoute: () => rootRoute,
      path: "/",
    });
    const nextRoute = createRoute({
      component: () => null,
      getParentRoute: () => rootRoute,
      path: "next",
    });
    const router = createRouter({
      history: createMemoryHistory({ initialEntries: ["/"] }),
      routeTree: rootRoute.addChildren([homeRoute, nextRoute]),
    });
    await router.load();
    const container = document.createElement("div");
    const root = createRoot(container);
    mountedRoots.push(root);

    await act(() => root.render(createElement(RouterProvider, { router })));
    const link = container.querySelector<HTMLAnchorElement>(
      "#queued-blocker-link",
    );
    link?.dispatchEvent(
      new MouseEvent("click", { bubbles: true, button: 0, cancelable: true }),
    );
    await waitForText(link, "transitioning");
    expect(firstShouldBlock).toHaveBeenCalledOnce();

    await act(() => disableSecondBlocker?.());
    releaseFirstDecision?.(false);
    await act(() => waitForPath(router, "/next"));
    await waitForText(link, "idle");

    expect(secondShouldBlock).not.toHaveBeenCalled();
  });

  it("clears transition state when a later blocker cancels navigation", async () => {
    const allowNavigation = vi.fn(async () => false);
    const blockNavigation = vi.fn(() => true);

    function Layout(): FigNode {
      useBlocker({ shouldBlockFn: allowNavigation });
      useBlocker({ shouldBlockFn: blockNavigation });
      return createElement(
        "main",
        null,
        createElement(Link, {
          children: ({ isTransitioning }: LinkRenderState) =>
            isTransitioning ? "transitioning" : "idle",
          id: "blocked-link",
          to: "/next",
        }),
        createElement(Outlet),
      );
    }

    const rootRoute = createRootRoute({ component: Layout });
    const homeRoute = createRoute({
      component: () => null,
      getParentRoute: () => rootRoute,
      path: "/",
    });
    const nextRoute = createRoute({
      component: () => null,
      getParentRoute: () => rootRoute,
      path: "next",
    });
    const router = createRouter({
      history: createMemoryHistory({ initialEntries: ["/"] }),
      routeTree: rootRoute.addChildren([homeRoute, nextRoute]),
    });
    await router.load();
    const container = document.createElement("div");
    const root = createRoot(container);
    mountedRoots.push(root);

    await act(() => root.render(createElement(RouterProvider, { router })));
    const link = container.querySelector<HTMLAnchorElement>("#blocked-link");
    await act(async () => {
      link?.dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          button: 0,
          cancelable: true,
        }),
      );
      for (let attempt = 0; attempt < 100; attempt += 1) {
        if (blockNavigation.mock.calls.length > 0) return;
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      throw new Error("The later navigation blocker was not called.");
    });

    expect(allowNavigation).toHaveBeenCalledOnce();
    expect(blockNavigation).toHaveBeenCalledOnce();
    expect(link?.textContent).toBe("idle");
    expect(router.history.location.pathname).toBe("/");
  });

  it("keeps an allowed navigation transitioning when a programmatic navigation is blocked", async () => {
    let releaseSlowRoute: (() => void) | undefined;
    const slowRoute = new Promise<void>((resolve) => {
      releaseSlowRoute = resolve;
    });
    const shouldBlockFn = ({ next }: { next: { pathname: string } }) =>
      next.pathname === "/blocked";

    function Layout(): FigNode {
      useBlocker({ shouldBlockFn });
      return createElement(
        "main",
        null,
        createElement(Link, {
          children: ({ isTransitioning }: LinkRenderState) =>
            isTransitioning ? "slow:transitioning" : "slow:idle",
          id: "slow-link",
          to: "/slow",
        }),
        createElement(Outlet),
      );
    }

    const rootRoute = createRootRoute({ component: Layout });
    const homeRoute = createRoute({
      component: () => null,
      getParentRoute: () => rootRoute,
      path: "/",
    });
    const slowRouteRecord = createRoute({
      component: () => null,
      getParentRoute: () => rootRoute,
      loader: () => slowRoute,
      path: "slow",
    });
    const blockedRoute = createRoute({
      component: () => null,
      getParentRoute: () => rootRoute,
      path: "blocked",
    });
    const router = createRouter({
      history: createMemoryHistory({ initialEntries: ["/"] }),
      routeTree: rootRoute.addChildren([
        homeRoute,
        slowRouteRecord,
        blockedRoute,
      ]),
    });
    await router.load();
    const container = document.createElement("div");
    const root = createRoot(container);
    mountedRoots.push(root);

    await act(() => root.render(createElement(RouterProvider, { router })));
    const slowLink = container.querySelector<HTMLAnchorElement>("#slow-link");

    slowLink?.dispatchEvent(
      new MouseEvent("click", { bubbles: true, button: 0, cancelable: true }),
    );
    await waitForText(slowLink, "slow:transitioning");

    await act(async () => {
      void router.navigate({ to: "/blocked" } as never);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(slowLink?.textContent).toBe("slow:transitioning");

    releaseSlowRoute?.();
    await waitForText(slowLink, "slow:idle");
  });
});

function makeLinkRouter() {
  const rootRoute = createRootRoute({ component: LinkLayout });
  const homeRoute = createRoute({
    component: () => createElement("h1", null, "Home"),
    getParentRoute: () => rootRoute,
    path: "/",
  });
  const userRoute = createRoute({
    component: () => createElement("h1", null, "User 42"),
    getParentRoute: () => rootRoute,
    path: "users/$id",
    validateSearch: (search): { tab?: string } => ({
      tab: typeof search.tab === "string" ? search.tab : undefined,
    }),
  });
  return createRouter({
    history: createMemoryHistory({ initialEntries: ["/"] }),
    routeTree: rootRoute.addChildren([homeRoute, userRoute]),
  });
}

function makeRenderPreloadRouter(loader?: () => Promise<void>) {
  const rootRoute = createRootRoute({ component: RenderPreloadLayout });
  const homeRoute = createRoute({
    component: () => null,
    getParentRoute: () => rootRoute,
    path: "/",
  });
  const nextRoute = createRoute({
    component: () => null,
    getParentRoute: () => rootRoute,
    loader,
    path: "next",
  });
  return createRouter({
    history: createMemoryHistory({ initialEntries: ["/"] }),
    routeTree: rootRoute.addChildren([homeRoute, nextRoute]),
  });
}

function RenderPreloadLayout(): FigNode {
  return createElement(
    "main",
    null,
    createElement(Link, {
      children: ({ isTransitioning }: LinkRenderState) =>
        isTransitioning ? "transitioning" : "idle",
      id: "render-preload-link",
      preload: "render",
      to: "/next",
    } as never),
    createElement(Outlet),
  );
}

function LinkLayout(): FigNode {
  return (
    <main>
      <Link
        activeProps={{
          class: "active",
          "data-link-state": "active",
          style: { color: "green" },
        }}
        class="base"
        id="user-link"
        inactiveProps={() => ({
          class: "inactive",
          "data-link-state": "inactive",
          style: { color: "gray" },
        })}
        params={{ id: "42" }}
        search={{ tab: "profile" }}
        to="/users/$id"
        viewTransition
      >
        {({ isActive, isTransitioning }) =>
          `${isActive ? "active" : "inactive"}:${
            isTransitioning ? "transitioning" : "idle"
          }`
        }
      </Link>
      <Link
        id="preload-link"
        params={{ id: "7" }}
        preload="intent"
        preloadDelay={0}
        to="/users/$id"
      >
        Preload user
      </Link>
      <Link id="external-link" to={externalUrl}>
        External
      </Link>
      <Outlet />
    </main>
  );
}

async function waitForPath(router: AnyRouter, pathname: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (router.stores.location.get().pathname === pathname) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error(`Router did not navigate to ${pathname}.`);
}

async function waitForBlocker(
  readResolver: () =>
    | ReturnType<typeof useBlocker<AnyRouter, true>>
    | undefined,
): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (readResolver()?.status === "blocked") return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("Link navigation was not blocked.");
}

async function waitForBlockerPath(
  readResolver: () =>
    | ReturnType<typeof useBlocker<AnyRouter, true>>
    | undefined,
  pathname: string,
): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const resolver = readResolver();
    if (resolver?.status === "blocked" && resolver.next.pathname === pathname) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error(`Link navigation to ${pathname} was not blocked.`);
}

async function waitForText(
  element: Element | null,
  text: string,
): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (element?.textContent === text) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error(
    `Element did not render ${JSON.stringify(text)}; received ${JSON.stringify(element?.textContent)}.`,
  );
}
