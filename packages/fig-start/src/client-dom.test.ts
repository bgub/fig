// @vitest-environment happy-dom
import {
  clientReference,
  createElement,
  type FigNode,
  readPromise,
  stylesheet,
} from "@bgub/fig";
import { describe, expect, it } from "vite-plus/test";
import { hydrateStart } from "./client.ts";
import { Outlet } from "./components.tsx";
import { markServerRoute } from "./internal.ts";
import { createFileRoute, createRootRoute } from "./route.ts";
import { createRequestHandler } from "./server.ts";
import type { AnyRoute } from "./route.ts";

// A manual client reference (the @bgub/fig-start/vite plugin generates these).
const islandId = "test/Island.tsx#Island";
const Island = clientReference({
  id: islandId,
  load: () => Promise.resolve({}),
});
const styledIslandId = "test/StyledIsland.tsx#StyledIsland";
const styledIslandHref = "http://[::1";
const StyledIsland = clientReference({
  id: styledIslandId,
  load: () => Promise.resolve({}),
  resources: [stylesheet(styledIslandHref)],
});

function RealIsland(): FigNode {
  return createElement("span", { class: "island" }, "island!");
}

function RealStyledIsland(): FigNode {
  return createElement("span", { class: "styled-island" }, "styled!");
}

const routes = [
  createRootRoute({
    component: () => createElement("div", { id: "app" }, createElement(Outlet)),
  }),
  createFileRoute("/")({
    component: () => createElement("h1", null, "Home"),
  }),
  markServerRoute(
    createFileRoute("/dash")({
      component: () =>
        createElement(
          "section",
          null,
          createElement("p", { class: "static" }, "static markup"),
          createElement(Island, {}),
        ),
    }),
  ),
  markServerRoute(
    createFileRoute("/styled")({
      component: () =>
        createElement("section", null, createElement(StyledIsland, {})),
    }),
  ),
];

const loadClientReference = ({ id }: { id: string }): Promise<unknown> =>
  id === islandId
    ? Promise.resolve({ Island: RealIsland })
    : id === styledIslandId
      ? Promise.resolve({ StyledIsland: RealStyledIsland })
      : Promise.reject(new Error(`unknown client reference ${id}`));

async function flush(): Promise<void> {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

// Render the document on the server, then install it as the live DOM (as the
// browser would on first load) so hydrateStart hydrates against real SSR markup.
async function installServerRenderedDocument(
  path: string,
  routeSet: readonly AnyRoute[] = routes,
): Promise<void> {
  const handler = createRequestHandler({
    clientEntry: "/client.js",
    routes: routeSet,
  });
  const response = await handler(new Request(`http://localhost${path}`));
  const html = await response.text();
  document.documentElement.innerHTML = html
    .replace(/^<!doctype[^>]*>/i, "")
    .replace(/^\s*<html[^>]*>/i, "")
    .replace(/<\/html>\s*$/i, "")
    // Drop the client bootstrap import script; hydrateStart is called manually.
    .replace(
      /<script(?:\s+nonce="[^"]*")?>import\("\/client\.js"\);<\/script>/gi,
      "",
    );
}

function installHandlerFetch(
  routeSet: readonly AnyRoute[] = routes,
): () => void {
  const handler = createRequestHandler({
    clientEntry: "/client.js",
    routes: routeSet,
  });
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const request =
      input instanceof Request
        ? input
        : new Request(new URL(String(input), "http://localhost").href, init);
    return handler(request);
  };
  return () => {
    globalThis.fetch = previousFetch;
  };
}

describe("@bgub/fig-start client RSC mount (happy-dom)", () => {
  it("mounts a server route's RSC payload, resolves its island, and tears down on nav", async () => {
    await installServerRenderedDocument("/dash");

    // The SSR'd document has an empty slot for the server route.
    const slot = document.querySelector('[data-fig-rsc-slot="/dash"]');
    expect(slot).not.toBeNull();
    expect(slot?.textContent).toBe("");

    const router = hydrateStart({ routes, loadClientReference });
    await flush();

    // The island resolved through the resolver and client-rendered into the slot.
    expect(slot?.querySelector(".island")?.textContent).toBe("island!");

    // Static markup rendered beside the (async, suspending) island survives the
    // Suspense reveal — the sibling-drop bug this harness originally caught.
    expect(slot?.querySelector(".static")?.textContent).toBe("static markup");

    // Navigating away tears the nested root down — the island is gone, no leak/stale.
    await router.navigate("/");
    await flush();
    expect(document.body.textContent).toContain("Home");
    expect(document.querySelector(".island")).toBeNull();
  });

  it("fetches a server route's RSC payload when navigating on the client", async () => {
    await installServerRenderedDocument("/");
    const restoreFetch = installHandlerFetch();

    try {
      const router = hydrateStart({ routes, loadClientReference });
      await flush();
      expect(document.body.textContent).toContain("Home");

      await router.navigate("/dash");
      await flush();

      const slot = document.querySelector('[data-fig-rsc-slot="/dash"]');
      expect(slot?.querySelector(".static")?.textContent).toBe("static markup");
      expect(slot?.querySelector(".island")?.textContent).toBe("island!");
    } finally {
      restoreFetch();
    }
  });

  it("reports missing client-reference resolvers during server route navigation", async () => {
    await installServerRenderedDocument("/");
    const restoreFetch = installHandlerFetch();
    const errors: unknown[] = [];

    try {
      const router = hydrateStart({
        onRecoverableError: (error) => errors.push(error),
        routes,
      });

      await router.navigate("/dash");
      await flush();

      expect(
        errors.some((error) =>
          String(error).includes("client-reference resolver"),
        ),
      ).toBe(true);
    } finally {
      restoreFetch();
    }
  });

  it("inserts and gates server route client-reference stylesheets", async () => {
    await installServerRenderedDocument("/");
    const restoreFetch = installHandlerFetch();

    try {
      const router = hydrateStart({ routes, loadClientReference });
      await router.navigate("/styled");
      await flush();

      const link = document.head.querySelector('link[rel="stylesheet"]');
      const slot = document.querySelector('[data-fig-rsc-slot="/styled"]');
      expect(link).not.toBeNull();
      expect(link?.getAttribute("href")).toBe(styledIslandHref);
      expect(slot?.querySelector(".styled-island")).toBeNull();

      link?.dispatchEvent(new Event("load"));
      await flush();

      expect(slot?.querySelector(".styled-island")?.textContent).toBe(
        "styled!",
      );
    } finally {
      restoreFetch();
    }
  });

  it("ignores server route stylesheet gates after navigation away", async () => {
    await installServerRenderedDocument("/");
    const restoreFetch = installHandlerFetch();

    try {
      const router = hydrateStart({ routes, loadClientReference });
      await router.navigate("/styled");
      await flush();

      const link = document.head.querySelector('link[rel="stylesheet"]');
      expect(link).not.toBeNull();
      expect(document.querySelector(".styled-island")).toBeNull();

      await router.navigate("/");
      link?.dispatchEvent(new Event("load"));
      await flush();

      expect(document.body.textContent).toContain("Home");
      expect(document.querySelector(".styled-island")).toBeNull();
    } finally {
      restoreFetch();
    }
  });

  it("aborts stale server route fetches when navigating away", async () => {
    const pending = deferred<string>();
    const slowRoutes = [
      createRootRoute({
        component: () =>
          createElement("div", { id: "app" }, createElement(Outlet)),
      }),
      createFileRoute("/")({
        component: () => createElement("h1", null, "Home"),
      }),
      markServerRoute(
        createFileRoute("/slow")({
          component: () =>
            createElement("section", null, readPromise(pending.promise)),
        }),
      ),
    ];

    await installServerRenderedDocument("/", slowRoutes);
    const restoreFetch = installHandlerFetch(slowRoutes);

    try {
      const router = hydrateStart({ routes: slowRoutes });
      await router.navigate("/slow");
      await flush();
      expect(
        document.querySelector('[data-fig-rsc-slot="/slow"]'),
      ).not.toBeNull();

      await router.navigate("/");
      pending.resolve("too late");
      await flush();

      expect(document.body.textContent).toContain("Home");
      expect(document.body.textContent).not.toContain("too late");
    } finally {
      restoreFetch();
    }
  });
});

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}
