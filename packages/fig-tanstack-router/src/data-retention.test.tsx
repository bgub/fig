// @vitest-environment happy-dom
import {
  createDataStore,
  createElement,
  dataResource,
  readData,
  useState,
} from "@bgub/fig";
import { createRoot } from "@bgub/fig-dom";
import { act } from "@bgub/fig-dom/test-utils";
import { hydrate } from "@tanstack/router-core/ssr/client";
import { afterEach, expect, it, vi } from "vitest";
import {
  createMemoryHistory,
  createRootRouteWithContext,
  createRoute,
  createRouter,
  ensureRouteData,
  RouterProvider,
  type RouteDataContext,
} from "./router.tsx";

const roots: Array<ReturnType<typeof createRoot>> = [];
afterEach(() => {
  for (const root of roots.splice(0)) root.unmount();
  vi.useRealTimers();
  delete window.$_TSR;
});
const retention = 5 * 60 * 1000;

function fixture() {
  const resource = dataResource<[string], string>({
    key: (id) => ["route-owned", id],
  });
  const data = createDataStore({
    initialData: [
      { key: ["route-owned", "1"], value: "Ada" },
      { key: ["route-owned", "2"], value: "Grace" },
    ],
  });
  let toggle = () => {};
  let loaderCalls = 0;
  function Panel() {
    return createElement("span", null, readData(resource, "1"));
  }
  function Page() {
    const [visible, setVisible] = useState(false);
    toggle = () => setVisible((value) => !value);
    return visible ? createElement(Panel) : "hidden";
  }
  const rootRoute = createRootRouteWithContext<RouteDataContext>()({});
  const route = createRoute({
    getParentRoute: () => rootRoute,
    path: "/users/$id",
    component: Page,
    loader: ({ context, params }) => {
      loaderCalls += 1;
      return ensureRouteData(context, resource, params.id);
    },
  });
  const home = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => "home",
  });
  const routeTree = rootRoute.addChildren([route, home]);
  const router = createRouter({
    context: { data },
    routeTree,
    history: createMemoryHistory({ initialEntries: ["/users/1"] }),
  });
  return {
    data,
    router,
    routeTree,
    toggle: () => toggle(),
    loaderCalls: () => loaderCalls,
  };
}

async function mount(f: ReturnType<typeof fixture>) {
  const container = document.createElement("div");
  const root = createRoot(container, { dataStore: f.data });
  roots.push(root);
  await f.router.load();
  await act(() =>
    root.render(createElement(RouterProvider, { router: f.router })),
  );
  return container;
}

it("retains never-read route data, retains it across reader unmounts, and releases on exit", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  const f = fixture();
  const container = await mount(f);
  await act(() => vi.advanceTimersByTime(retention * 2));
  expect(f.data.snapshot()).toEqual([
    { key: ["route-owned", "1"], value: "Ada" },
  ]);
  await act(f.toggle);
  expect(container.textContent).toBe("Ada");
  await act(f.toggle);
  await act(() => vi.advanceTimersByTime(retention * 2));
  await act(f.toggle);
  expect(container.textContent).toBe("Ada");
  await act(() => f.router.navigate({ to: "/" }));
  await act(() => vi.advanceTimersByTime(retention));
  expect(f.data.snapshot()).toEqual([]);
});

it("releases the old parameter key while retaining the new match", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  const f = fixture();
  await mount(f);
  await act(() => f.router.navigate({ to: "/users/$id", params: { id: "2" } }));
  await act(() => vi.advanceTimersByTime(retention * 2));
  expect(f.data.snapshot()).toEqual([
    { key: ["route-owned", "2"], value: "Grace" },
  ]);
});

it("does not give completed preloads an active route lifetime", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  const f = fixture();
  await mount(f);
  await act(() =>
    f.router.preloadRoute({ to: "/users/$id", params: { id: "2" } }),
  );
  await act(() => vi.advanceTimersByTime(retention * 2));
  expect(f.data.snapshot()).toEqual([
    { key: ["route-owned", "1"], value: "Ada" },
  ]);
});

it("transfers server route ownership without rerunning client loaders and preserves app hydration", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  const f = fixture();
  const appHydrate = vi.fn();
  // A separate server router also exercises reuse of the same route definitions.
  const server = createRouter({
    context: { data: f.data },
    routeTree: f.routeTree,
    isServer: true,
    dehydrate: () => ({ greeting: "hello" }),
  });
  server.update({
    context: { ...server.options.context },
    history: createMemoryHistory({ initialEntries: ["/users/1"] }),
  });
  await server.load();
  const transported = JSON.parse(
    JSON.stringify(await server.options.dehydrate?.()),
  );
  const clientData = createDataStore({
    initialData: JSON.parse(JSON.stringify(f.data.snapshot())),
  });
  const client = createRouter({
    context: { data: clientData },
    routeTree: f.routeTree,
    history: createMemoryHistory({ initialEntries: ["/users/1"] }),
    hydrate: appHydrate,
  });
  const serverLoaderCalls = f.loaderCalls();
  window.$_TSR = {
    router: {
      manifest: undefined,
      matches: server.stores.matches.get().map((match) => ({
        i: match.id.replaceAll("/", "#"),
        u: match.updatedAt,
        s: match.status,
        ssr: match.ssr,
      })),
      dehydratedData: transported,
    },
    buffer: [],
    h() {},
    e() {},
    c() {},
    p(fn) {
      fn();
    },
  };
  await hydrate(client);
  expect(f.loaderCalls()).toBe(serverLoaderCalls);
  expect(appHydrate).toHaveBeenCalledWith({ greeting: "hello" });
  const container = document.createElement("div");
  const root = createRoot(container, { dataStore: clientData });
  roots.push(root);
  await act(() =>
    root.render(createElement(RouterProvider, { router: client })),
  );
  await act(() => vi.advanceTimersByTime(retention * 2));
  await act(f.toggle);
  expect(container.textContent).toBe("Ada");
  await act(() => client.navigate({ to: "/" }));
  await act(() => vi.advanceTimersByTime(retention));
  expect(clientData.snapshot()).toEqual([]);
  f.data.dispose();
});

it.each(["complete", "cancel"])(
  "retains a slow multi-step loader until %s, then releases on exit",
  async (outcome) => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const data = createDataStore();
    const resource = dataResource({
      key: (id: string) => ["slow", id],
      load: (id) => id,
    });
    let finish = () => {};
    let started = () => {};
    const gate = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const loading = new Promise<void>((resolve) => {
      started = resolve;
    });
    const rootRoute = createRootRouteWithContext<RouteDataContext>()({});
    const home = createRoute({
      getParentRoute: () => rootRoute,
      path: "/",
      component: () => "home",
    });
    const slow = createRoute({
      getParentRoute: () => rootRoute,
      path: "/slow",
      component: () => "slow",
      loader: async ({ context }) => {
        await ensureRouteData(context, resource, "first");
        started();
        await gate;
        await ensureRouteData(context, resource, "second");
      },
    });
    const router = createRouter({
      context: { data },
      routeTree: rootRoute.addChildren([home, slow]),
      history: createMemoryHistory({ initialEntries: ["/"] }),
    });
    const root = createRoot(document.createElement("div"), { dataStore: data });
    roots.push(root);
    await router.load();
    await act(() => root.render(createElement(RouterProvider, { router })));
    const navigation = router.navigate({ to: "/slow" } as never);
    await loading;
    await act(() => vi.advanceTimersByTime(retention * 2));
    expect(data.snapshot()).toEqual([
      { key: ["slow", "first"], value: "first" },
    ]);
    if (outcome === "cancel") await act(() => router.navigate({ to: "/" }));
    finish();
    await act(() => navigation);
    if (outcome === "complete") {
      await act(() => vi.advanceTimersByTime(retention * 2));
      expect(data.snapshot()).toEqual([
        { key: ["slow", "first"], value: "first" },
        { key: ["slow", "second"], value: "second" },
      ]);
      await act(() => router.navigate({ to: "/" }));
    }
    await act(() => vi.advanceTimersByTime(retention * 2));
    expect(data.snapshot()).toEqual([]);
  },
);
