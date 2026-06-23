import { clientReference, createElement, type FigNode } from "@bgub/fig";
import { describe, expect, it } from "vite-plus/test";
import {
  hasClientReferences,
  RSC_PAYLOAD_SCRIPT_ID,
  RSC_SLOT_ATTR,
  ROUTER_STATE_SCRIPT_ID,
} from "./bootstrap.ts";
import { Outlet } from "./components.tsx";
import { redirect } from "./redirect.ts";
import { createFileRoute, createRootRoute } from "./route.ts";
import { createRequestHandler } from "./server.ts";

// A manually-declared client reference (the @bgub/fig-start/vite plugin will
// generate these from `.tsx` imports inside `.server.tsx`).
const islandId = "test/Island.tsx#Island";
const Island = clientReference({
  id: islandId,
  load: () => Promise.resolve({}),
});

const dashboardRoute = createFileRoute("/dashboard")({
  server: true,
  component: () =>
    createElement("section", null, "server markup ", createElement(Island, {})),
});

const postRoute = createFileRoute("/posts/$postId")({
  loader: ({ params }) => ({ id: params.postId }),
  component: PostView,
});

// Annotate the return type to break the self-reference cycle (the component
// reads its own route's typed hooks).
function PostView(): FigNode {
  // Typed straight from the loader return and the path literal, no codegen.
  const data = postRoute.useLoaderData();
  const params = postRoute.useParams();
  return createElement("h1", null, `Post ${data.id} (${params.postId})`);
}

const routes = [
  createRootRoute({
    component: () =>
      createElement("div", { id: "root-layout" }, createElement(Outlet)),
    notFoundComponent: () => createElement("p", null, "Nothing here"),
  }),
  createFileRoute("/")({
    component: () => createElement("h1", null, "Home page"),
  }),
  createFileRoute("/about")({
    component: () => createElement("h1", null, "About page"),
  }),
  createFileRoute("/guarded")({
    beforeLoad: ({ context }) => {
      if (!(context as { allow: boolean }).allow) throw redirect({ to: "/" });
    },
    component: () => createElement("h1", null, "Secret"),
  }),
  postRoute,
  dashboardRoute,
];

function handlerFor(allow: boolean) {
  return createRequestHandler({
    clientEntry: "/client.js",
    context: () => ({ allow }),
    routes,
  });
}

describe("@bgub/fig-start server handler", () => {
  it("renders the matched route into a full document with bootstrap", async () => {
    const response = await handlerFor(true)(
      new Request("http://localhost/about"),
    );
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(html).toContain("<html");
    expect(html).toContain("About page");
    expect(html).toContain(`id="fig-root"`);
    expect(html).toContain(ROUTER_STATE_SCRIPT_ID);
    expect(html).toContain("/client.js");
    // bootstrap injected before </body>
    expect(html.indexOf(ROUTER_STATE_SCRIPT_ID)).toBeLessThan(
      html.indexOf("</body>"),
    );
  });

  it("serializes loader data for hydration", async () => {
    const response = await handlerFor(true)(
      new Request("http://localhost/posts/42"),
    );
    const html = await response.text();

    expect(html).toContain("Post 42");
    expect(html).toContain('"/posts/$postId"');
    expect(html).toContain('"id":"42"');
  });

  it("responds with a redirect when beforeLoad throws", async () => {
    const response = await handlerFor(false)(
      new Request("http://localhost/guarded"),
    );
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/");
  });

  it("renders the not-found component with a 404 status", async () => {
    const response = await handlerFor(true)(
      new Request("http://localhost/does/not/exist"),
    );
    const html = await response.text();
    expect(response.status).toBe(404);
    expect(html).toContain("Nothing here");
  });

  it("inlines an RSC payload + empty slot for a .server.tsx route", async () => {
    const response = await handlerFor(true)(
      new Request("http://localhost/dashboard"),
    );
    const html = await response.text();

    // SSR leaves an empty slot in the isomorphic layout (the server component
    // is not rendered into the document — it has client refs that can't SSR).
    expect(html).toContain(`${RSC_SLOT_ATTR}="/dashboard"></div>`);
    // The RSC payload is inlined, carrying a client row for the island.
    expect(html).toContain(RSC_PAYLOAD_SCRIPT_ID);
    expect(html).toContain(islandId);
    expect(html).toContain('"routeId":"/dashboard"');
  });

  it("omits the RSC payload for ordinary isomorphic routes", async () => {
    const response = await handlerFor(true)(
      new Request("http://localhost/about"),
    );
    const html = await response.text();
    expect(html).not.toContain(RSC_PAYLOAD_SCRIPT_ID);
  });

  it("builds the data context once per server-route request", async () => {
    let calls = 0;
    const handler = createRequestHandler({
      clientEntry: "/client.js",
      context: () => ({ allow: true }),
      dataContext: () => {
        calls += 1;
        return {};
      },
      routes,
    });
    await handler(new Request("http://localhost/dashboard"));
    // One context shared by the RSC render and the document render.
    expect(calls).toBe(1);
  });

  it("detects client references in an RSC payload", () => {
    expect(hasClientReferences('{"tag":"client","value":{"id":"x"}}')).toBe(
      true,
    );
    expect(hasClientReferences('{"tag":"model","value":null}')).toBe(false);
  });
});
