import { createElement, Suspense, readPromise } from "@bgub/fig";
import { describe, expect, it } from "vite-plus/test";
import { createRenderTreeCollector, renderToHtml } from "./index.ts";
import type { RenderTreeNode } from "./render-tree.ts";

function outline(node: RenderTreeNode): unknown {
  return {
    kind: node.kind,
    name: node.name,
    ...(node.children.length === 0
      ? {}
      : { children: node.children.map(outline) }),
  };
}

describe("render tree collection", () => {
  it("collects the component structure while rendering", async () => {
    const collector = createRenderTreeCollector();

    function Panel({ label }: { label: string }) {
      return createElement("section", { class: "panel" }, label);
    }

    function App() {
      return createElement(
        "main",
        null,
        createElement("h1", null, "Title"),
        createElement(Panel, { label: "One" }),
      );
    }

    await renderToHtml(createElement(App, null), { renderTree: collector });

    expect(outline(collector.tree)).toEqual({
      kind: "root",
      name: "Root",
      children: [
        {
          kind: "function",
          name: "App",
          children: [
            {
              kind: "host",
              name: "main",
              children: [
                {
                  kind: "host",
                  name: "h1",
                  children: [{ kind: "text", name: "#text" }],
                },
                {
                  kind: "function",
                  name: "Panel",
                  children: [
                    {
                      kind: "host",
                      name: "section",
                      children: [{ kind: "text", name: "#text" }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });
    const panel = collector.tree.children[0]?.children?.[0]?.children?.[1];
    expect(panel?.props).toEqual({ label: "One" });
    expect(panel?.props).not.toHaveProperty("children");
  });

  it("attaches resumed suspended content under its boundary", async () => {
    const collector = createRenderTreeCollector();
    let resolve: (value: string) => void = () => undefined;
    const promise = new Promise<string>((done) => {
      resolve = done;
    });

    function Late() {
      return createElement("p", null, readPromise(promise));
    }

    const render = renderToHtml(
      createElement(
        Suspense,
        { fallback: createElement("span", null, "Loading") },
        createElement(Late, null),
      ),
      { renderTree: collector },
    );
    resolve("Ready");
    await render;

    const suspense = collector.tree.children[0];
    expect(suspense?.kind).toBe("suspense");
    const names = suspense?.children.map((child) => child.name);
    // The fallback records first; the resumed content lands under the same
    // boundary node when its task completes.
    expect(names).toContain("span");
    expect(names).toContain("Late");
  });

  it("does not collect when no collector is passed", async () => {
    // Smoke: the treeParent threading must not affect plain renders.
    const html = await renderToHtml(createElement("p", null, "plain"));
    expect(html).toContain("plain");
  });
});
