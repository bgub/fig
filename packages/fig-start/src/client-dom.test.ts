// @vitest-environment happy-dom
import { clientReference, createElement, type FigNode } from "@bgub/fig";
import { describe, expect, it } from "vite-plus/test";
import { hydrateStart } from "./client.ts";
import { Outlet } from "./components.tsx";
import { createFileRoute, createRootRoute } from "./route.ts";
import { createRequestHandler } from "./server.ts";

// A manual client reference (the @bgub/fig-start/vite plugin generates these).
const islandId = "test/Island.tsx#Island";
const Island = clientReference({
  id: islandId,
  load: () => Promise.resolve({}),
});

function RealIsland(): FigNode {
  return createElement("span", { class: "island" }, "island!");
}

const routes = [
  createRootRoute({
    component: () => createElement("div", { id: "app" }, createElement(Outlet)),
  }),
  createFileRoute("/")({
    component: () => createElement("h1", null, "Home"),
  }),
  createFileRoute("/dash")({
    server: true,
    component: () => createElement("section", null, createElement(Island, {})),
  }),
];

const loadClientReference = ({ id }: { id: string }): Promise<unknown> =>
  id === islandId
    ? Promise.resolve({ Island: RealIsland })
    : Promise.reject(new Error(`unknown client reference ${id}`));

async function flush(): Promise<void> {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

// Render the document on the server, then install it as the live DOM (as the
// browser would on first load) so hydrateStart hydrates against real SSR markup.
async function installServerRenderedDocument(path: string): Promise<void> {
  const handler = createRequestHandler({ clientEntry: "/client.js", routes });
  const response = await handler(new Request(`http://localhost${path}`));
  const html = await response.text();
  document.documentElement.innerHTML = html
    .replace(/^<!doctype[^>]*>/i, "")
    .replace(/^\s*<html[^>]*>/i, "")
    .replace(/<\/html>\s*$/i, "")
    // Drop the client bootstrap module script (happy-dom would try to fetch it).
    .replace(/<script type="module"[^>]*><\/script>/gi, "");
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

    // Navigating away tears the nested root down — the island is gone, no leak/stale.
    await router.navigate("/");
    await flush();
    expect(document.body.textContent).toContain("Home");
    expect(document.querySelector(".island")).toBeNull();
  });
});
