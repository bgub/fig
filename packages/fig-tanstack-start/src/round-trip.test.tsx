// @vitest-environment happy-dom
import { createElement, dataResource, readData } from "@bgub/fig";
import { hydrateRoot } from "@bgub/fig-dom";
import { act } from "@bgub/fig-dom/test-utils";
import {
  createMemoryHistory,
  createRootRouteWithContext,
  createRoute,
  createRouter,
  ensureRouteData,
  Outlet,
  type RouteDataContext,
} from "@bgub/fig-tanstack-router";
import { attachRouterServerSsrUtils } from "@tanstack/router-core/ssr/server";
import { afterEach, describe, expect, it } from "vitest";
import { createStartDataContext, StartScripts } from "./data.ts";
import { renderRouterToStream } from "./server.tsx";

const roots: Array<ReturnType<typeof hydrateRoot>> = [];

afterEach(() => {
  for (const root of roots.splice(0)) root.unmount();
  document.head.replaceChildren();
  document.body.replaceChildren();
});

describe("TanStack Start data round trip", () => {
  it("hydrates route-loader data without refetching, then reloads once on invalidation", async () => {
    let loads = 0;
    const userResource = dataResource<[string], string>({
      key: (id: string) => ["round-trip-user", id],
      load: async (id: string) => {
        loads += 1;
        return `user-${id}-v${loads}`;
      },
    });

    function User() {
      return createElement(
        "span",
        { id: "user" },
        readData(userResource, "42"),
      );
    }

    function Document() {
      return createElement(
        "html",
        { lang: "en" },
        createElement("head", null),
        createElement(
          "body",
          null,
          createElement("div", { id: "app" }, createElement(Outlet)),
          createElement(StartScripts),
        ),
      );
    }

    const serverRootRoute = createRootRouteWithContext<RouteDataContext>()({
      component: Document,
    });
    const serverUserRoute = createRoute({
      component: User,
      getParentRoute: () => serverRootRoute,
      loader: ({ context }) => ensureRouteData(context, userResource, "42"),
      path: "users/$id",
    });
    const serverData = createStartDataContext();
    const serverRouter = createRouter({
      ...serverData,
      history: createMemoryHistory({ initialEntries: ["/users/42"] }),
      isServer: true,
      routeTree: serverRootRoute.addChildren([serverUserRoute]),
    });

    await serverRouter.load();
    expect(loads).toBe(1);
    attachRouterServerSsrUtils({ router: serverRouter, manifest: undefined });
    await serverRouter.serverSsr?.dehydrate();
    const result = await renderRouterToStream({
      request: new Request("https://example.test/users/42"),
      responseHeaders: new Headers(),
      router: serverRouter,
    });
    const html = await result.response.text();

    expect(html).toContain("user-42-v1");

    const parsed = new DOMParser().parseFromString(html, "text/html");
    document.head.innerHTML = parsed.head.innerHTML;
    document.body.innerHTML = parsed.body.innerHTML;
    expect(
      document.querySelector('script[type="application/json"]'),
    ).not.toBeNull();

    const clientData = createStartDataContext();
    expect(clientData.context.data.snapshot()).toHaveLength(1);

    const container = document.querySelector("#app");
    if (container === null)
      throw new Error("Missing server-rendered app root.");
    const root = await act(() =>
      hydrateRoot(container, createElement(User), {
        dataStore: clientData.context.data,
      }),
    );
    roots.push(root);

    expect(container.textContent).toBe("user-42-v1");
    expect(loads).toBe(1);

    await act(() => clientData.context.data.invalidateData(userResource, "42"));

    expect(container.textContent).toBe("user-42-v2");
    expect(loads).toBe(2);
  });
});
