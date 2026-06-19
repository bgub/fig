import { createElement, type FigNode } from "@bgub/fig";
import { describe, expect, it } from "vite-plus/test";
import { ROUTER_STATE_SCRIPT_ID } from "./bootstrap.ts";
import { Outlet } from "./components.tsx";
import { redirect } from "./redirect.ts";
import { createFileRoute, createRootRoute } from "./route.ts";
import { createRequestHandler } from "./server.ts";

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
});
