// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { act } from "@bgub/fig-dom/test-utils";
import { createFigDevtoolsGlobalHook } from "./hook.ts";
import { createFigDevtoolsPlugin } from "./tanstack.ts";

afterEach(() => {
  document.body.replaceChildren();
});

describe("Fig TanStack Devtools plugin", () => {
  it("exposes stable default plugin metadata", () => {
    const plugin = createFigDevtoolsPlugin({
      hook: createFigDevtoolsGlobalHook(),
    });

    expect(plugin.id).toBe("fig");
    expect(plugin.name).toBe("Fig");
    expect(plugin.defaultOpen).toBe(true);
  });

  it("mounts an embedded panel and updates it in place", () => {
    const target = document.createElement("div");
    document.body.appendChild(target);
    const plugin = createFigDevtoolsPlugin({
      banner: "TanStack host",
      hook: createFigDevtoolsGlobalHook(),
    });

    plugin.render(target, { devtoolsOpen: true, theme: "light" });

    const panel = target.querySelector<HTMLElement>("[data-fig-devtools]");
    expect(panel?.dataset.placement).toBe("panel");
    expect(panel?.dataset.theme).toBe("light");
    expect(panel?.textContent).toContain("TanStack host");
    expect(panel?.querySelector('[aria-label="Hide Fig DevTools"]')).toBeNull();
    expect(target.children).toHaveLength(1);

    plugin.render(target, { devtoolsOpen: true, theme: "dark" });

    expect(target.children).toHaveLength(1);
    expect(
      target.querySelector<HTMLElement>("[data-fig-devtools]")?.dataset.theme,
    ).toBe("dark");

    plugin.dispose();
    expect(target.children).toHaveLength(0);
  });

  it("releases a disconnected panel before mounting its replacement", () => {
    const firstTarget = document.createElement("div");
    const secondTarget = document.createElement("div");
    document.body.append(firstTarget, secondTarget);
    const plugin = createFigDevtoolsPlugin({
      hook: createFigDevtoolsGlobalHook(),
    });

    plugin.render(firstTarget, { devtoolsOpen: true, theme: "light" });
    firstTarget.remove();
    plugin.render(secondTarget, { devtoolsOpen: true, theme: "light" });

    expect(firstTarget.children).toHaveLength(0);
    expect(secondTarget.querySelector("[data-fig-devtools]")).not.toBeNull();

    plugin.destroy?.("fig");
    expect(secondTarget.children).toHaveLength(0);
  });

  it("portals highlights below the TanStack host stacking context", async () => {
    const highlightedElement = document.createElement("main");
    highlightedElement.getBoundingClientRect = () =>
      new DOMRect(20, 40, 300, 160);
    const hook = inspectableHook(highlightedElement);
    const host = document.createElement("div");
    host.style.position = "fixed";
    host.style.zIndex = "99999";
    const target = document.createElement("div");
    host.appendChild(target);
    document.body.appendChild(host);
    const plugin = createFigDevtoolsPlugin({ hook });

    plugin.render(target, { devtoolsOpen: true, theme: "light" });
    const rootRow = [...target.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Root"),
    );
    await act(() => {
      rootRow?.dispatchEvent(new Event("pointerenter"));
    });

    const overlay = document.body.querySelector<HTMLElement>(
      ":scope > .fig-devtools__inspect-overlay",
    );
    expect(overlay).not.toBeNull();
    expect(target.querySelector(".fig-devtools__inspect-overlay")).toBeNull();
    expect(overlay?.style.zIndex).toBe("99998");
  });
});

function inspectableHook(highlightedElement: HTMLElement) {
  const hook = createFigDevtoolsGlobalHook();
  const rendererId = hook.inject({
    name: "Fig",
    packageName: "@bgub/fig-reconciler",
  });
  hook.onCommitRoot(
    rendererId,
    {
      id: 1,
      rendererId,
      committedAt: 1,
      dataResources: [],
      pendingWork: [],
      suspendedWork: [],
      pingedWork: [],
      expiredWork: [],
      tree: {
        id: 1,
        parentId: null,
        name: "Root",
        kind: "root",
        key: null,
        index: 0,
        props: {},
        pendingWork: [],
        childWork: [],
        hooks: [],
        contextDependencies: [],
        dataResourceCanonicalKeys: [],
        children: [
          {
            id: 2,
            parentId: 1,
            name: "main",
            kind: "host",
            key: null,
            index: 0,
            props: {},
            pendingWork: [],
            childWork: [],
            hooks: [],
            contextDependencies: [],
            dataResourceCanonicalKeys: [],
            children: [],
          },
        ],
      },
    },
    {
      inspectElement: () => null,
      elementForFiber: (fiberId) => (fiberId === 2 ? highlightedElement : null),
    },
  );
  return hook;
}
