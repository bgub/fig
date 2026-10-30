// @vitest-environment happy-dom
import { createContext, createElement, readContext, useState } from "@bgub/fig";
import { createRoot } from "@bgub/fig-dom";
import { act } from "@bgub/fig-dom/test-utils";
import { describe, expect, it } from "vitest";
import { alignTreeToRow, syncTreeHorizontalScroll } from "./component.ts";
import { createFigDevtoolsGlobalHook, FigDevtools } from "./index.ts";
import type { FigDevtoolsGlobalTarget } from "./hook.ts";
import { FIG_DEVTOOLS_HOOK_KEY } from "./hook.ts";

function Nested({ remaining }: { remaining: number }) {
  return remaining === 0
    ? createElement("span", { id: "deep-leaf" }, "Leaf")
    : createElement(Nested, { remaining: remaining - 1 });
}

// Mirrors the demo apps' wiring: the panel renders in its own root (with
// DevTools publishing disabled) before any app root commits, then updates as
// app commits arrive through the global hook.
describe("FigDevtools panel", () => {
  it("portals inspection highlights outside an embedded panel", async () => {
    const hook = createFigDevtoolsGlobalHook();
    const rendererId = hook.inject({
      name: "Fig",
      packageName: "@bgub/fig-reconciler",
    });
    const inspectedElement = document.createElement("main");
    inspectedElement.getBoundingClientRect = () =>
      new DOMRect(12, 34, 320, 180);
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
        elementForFiber: (fiberId) => (fiberId === 2 ? inspectedElement : null),
      },
    );
    const container = document.createElement("aside");
    document.body.append(container);

    await act(() => {
      createRoot(container, { devtools: false }).render(
        createElement(FigDevtools, {
          hook,
          overlayTarget: document.body,
          overlayZIndex: 99998,
          placement: "panel",
        }),
      );
    });

    const rootButton = [...container.querySelectorAll("button")].find(
      (button) => button.textContent?.includes("Root"),
    );
    const rootRow = rootButton?.closest(".fig-devtools__tree-line");
    await act(() => {
      rootRow?.dispatchEvent(new Event("pointerenter"));
    });
    expect(
      document.body.querySelector(":scope > .fig-devtools__inspect-overlay"),
    ).toBeNull();
    await act(() => {
      rootButton?.dispatchEvent(new Event("pointerenter"));
    });

    const overlay = document.body.querySelector<HTMLElement>(
      ":scope > .fig-devtools__inspect-overlay",
    );
    expect(overlay).not.toBeNull();
    expect(
      container.querySelector(".fig-devtools__inspect-overlay"),
    ).toBeNull();
    expect(overlay?.style.zIndex).toBe("99998");
    expect(overlay?.style.left).toBe("12px");
    expect(overlay?.style.top).toBe("34px");
    await act(() => {
      rootButton?.dispatchEvent(new Event("pointerleave"));
    });
    expect(
      document.body.querySelector(":scope > .fig-devtools__inspect-overlay"),
    ).toBeNull();
  });

  it("renders committed app roots published to the global hook", async () => {
    const hook = createFigDevtoolsGlobalHook();
    const target = globalThis as FigDevtoolsGlobalTarget;
    const previous = target[FIG_DEVTOOLS_HOOK_KEY];
    target[FIG_DEVTOOLS_HOOK_KEY] = hook;

    try {
      const devtoolsContainer = document.createElement("aside");
      const appContainer = document.createElement("div");
      document.body.append(devtoolsContainer, appContainer);

      await act(() => {
        createRoot(devtoolsContainer, { devtools: false }).render(
          createElement(FigDevtools, { hook, placement: "sidebar" }),
        );
      });

      expect(devtoolsContainer.textContent).toContain("Render a Fig root.");

      function Counter() {
        const [count] = useState(1);
        return createElement("button", { id: "count" }, `Count ${count}`);
      }

      await act(() => {
        createRoot(appContainer).render(createElement(Counter, null));
      });

      expect(hook.commits.length).toBeGreaterThan(0);

      const panelText = devtoolsContainer.textContent ?? "";
      expect(panelText).not.toContain("Render a Fig root.");
      expect(panelText).toContain("Counter");
    } finally {
      target[FIG_DEVTOOLS_HOOK_KEY] = previous;
    }
  });

  it("expands trees by default and preserves manual collapsing", async () => {
    const hook = createFigDevtoolsGlobalHook();
    const target = globalThis as FigDevtoolsGlobalTarget;
    const previous = target[FIG_DEVTOOLS_HOOK_KEY];
    target[FIG_DEVTOOLS_HOOK_KEY] = hook;

    try {
      const devtoolsContainer = document.createElement("aside");
      const appContainer = document.createElement("div");
      document.body.append(devtoolsContainer, appContainer);

      await act(() => {
        createRoot(devtoolsContainer, { devtools: false }).render(
          createElement(FigDevtools, { hook, placement: "sidebar" }),
        );
        createRoot(appContainer).render(
          createElement(Nested, { remaining: 12 }),
        );
      });

      const initialRows = devtoolsContainer.querySelectorAll(
        ".fig-devtools__tree-button",
      );
      expect(initialRows).toHaveLength(14);

      const toggles = devtoolsContainer.querySelectorAll<HTMLButtonElement>(
        '.fig-devtools__tree-toggle[aria-expanded="true"]',
      );
      const deepToggle = toggles[4];
      expect(deepToggle).toBeDefined();
      await act(() => deepToggle?.click());
      expect(
        devtoolsContainer.querySelectorAll(".fig-devtools__tree-button"),
      ).toHaveLength(5);
      expect(deepToggle?.getAttribute("aria-expanded")).toBe("false");
      const collapsedToggle =
        devtoolsContainer.querySelector<HTMLButtonElement>(
          '.fig-devtools__tree-toggle[aria-expanded="false"]',
        );
      expect(collapsedToggle).toBeDefined();
      await act(() => collapsedToggle?.click());
      expect(
        devtoolsContainer.querySelectorAll(".fig-devtools__tree-button"),
      ).toHaveLength(14);
    } finally {
      target[FIG_DEVTOOLS_HOOK_KEY] = previous;
    }
  });

  it("aligns deeply nested tree rows horizontally", () => {
    const treePane = document.createElement("div");
    const row = document.createElement("div");
    const button = document.createElement("button");
    row.className = "fig-devtools__tree-line";
    button.className = "fig-devtools__tree-button";
    row.append(button);
    treePane.append(row);

    treePane.scrollLeft = 40;
    treePane.getBoundingClientRect = () => new DOMRect(0, 0, 400, 300);
    button.getBoundingClientRect = () => new DOMRect(160, 0, 220, 28);
    alignTreeToRow(treePane, row);
    expect(treePane.scrollLeft).toBe(136);

    button.getBoundingClientRect = () => new DOMRect(-80, 0, 220, 28);
    alignTreeToRow(treePane, row);
    expect(treePane.scrollLeft).toBe(0);
  });

  it("resets horizontal tree scrolling at the vertical top", () => {
    const treePane = document.createElement("div");
    const row = document.createElement("div");
    const button = document.createElement("button");
    row.className = "fig-devtools__tree-line";
    button.className = "fig-devtools__tree-button";
    row.append(button);
    treePane.append(row);

    treePane.scrollLeft = 40;
    treePane.scrollTop = 0;
    treePane.getBoundingClientRect = () => new DOMRect(0, 0, 400, 300);
    button.getBoundingClientRect = () => new DOMRect(160, 0, 220, 28);
    syncTreeHorizontalScroll(treePane);

    expect(treePane.scrollLeft).toBe(0);
  });

  it("expands collapsed ancestors when inspecting an element", async () => {
    const hook = createFigDevtoolsGlobalHook();
    const target = globalThis as FigDevtoolsGlobalTarget;
    const previous = target[FIG_DEVTOOLS_HOOK_KEY];
    target[FIG_DEVTOOLS_HOOK_KEY] = hook;

    try {
      const devtoolsContainer = document.createElement("aside");
      const appContainer = document.createElement("div");
      document.body.append(devtoolsContainer, appContainer);

      await act(() => {
        createRoot(devtoolsContainer, { devtools: false }).render(
          createElement(FigDevtools, { hook, placement: "sidebar" }),
        );
        createRoot(appContainer).render(
          createElement(Nested, { remaining: 12 }),
        );
      });

      const toggles = devtoolsContainer.querySelectorAll<HTMLButtonElement>(
        '.fig-devtools__tree-toggle[aria-expanded="true"]',
      );
      const deepToggle = toggles[4];
      expect(deepToggle).toBeDefined();
      await act(() => deepToggle?.click());
      expect(
        devtoolsContainer.querySelectorAll(".fig-devtools__tree-button"),
      ).toHaveLength(5);

      const selectButton = Array.from(
        devtoolsContainer.querySelectorAll<HTMLButtonElement>("button"),
      ).find((candidate) => candidate.textContent === "Select");
      expect(selectButton).toBeDefined();
      await act(() => selectButton?.click());

      const leaf = appContainer.querySelector<HTMLElement>("#deep-leaf");
      expect(leaf).not.toBeNull();
      if (leaf === null) throw new Error("Expected a deep leaf.");
      leaf.getBoundingClientRect = () => new DOMRect(0, 0, 20, 20);
      await act(() => {
        leaf.dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true }),
        );
      });

      expect(
        devtoolsContainer.querySelectorAll(".fig-devtools__tree-button"),
      ).toHaveLength(14);
    } finally {
      target[FIG_DEVTOOLS_HOOK_KEY] = previous;
    }
  });

  it("renders multiple anonymous context dependencies", async () => {
    const hook = createFigDevtoolsGlobalHook();
    const target = globalThis as FigDevtoolsGlobalTarget;
    const previous = target[FIG_DEVTOOLS_HOOK_KEY];
    target[FIG_DEVTOOLS_HOOK_KEY] = hook;
    const FirstContext = createContext("first");
    const SecondContext = createContext("second");

    function ContextReader() {
      readContext(FirstContext);
      readContext(SecondContext);
      return createElement("span", null, "Contexts read");
    }

    try {
      const devtoolsContainer = document.createElement("aside");
      const appContainer = document.createElement("div");
      document.body.append(devtoolsContainer, appContainer);

      await act(() => {
        createRoot(appContainer).render(createElement(ContextReader, null));
      });
      await act(() => {
        createRoot(devtoolsContainer, { devtools: false }).render(
          createElement(FigDevtools, { hook, placement: "sidebar" }),
        );
      });

      const readerButton = Array.from(
        devtoolsContainer.querySelectorAll<HTMLButtonElement>(
          ".fig-devtools__tree-button",
        ),
      ).find((button) => button.textContent?.includes("ContextReader"));
      expect(readerButton).toBeDefined();
      await act(() => readerButton?.click());

      const contextChips = devtoolsContainer.querySelectorAll(
        ".fig-devtools__value-chip",
      );
      expect(contextChips).toHaveLength(2);
      expect(Array.from(contextChips, (chip) => chip.textContent)).toEqual([
        "Context",
        "Context",
      ]);
    } finally {
      target[FIG_DEVTOOLS_HOOK_KEY] = previous;
    }
  });

  it("shows only the selected fiber's data resources", async () => {
    const hook = createFigDevtoolsGlobalHook();
    const rendererId = hook.inject({
      name: "Fig",
      packageName: "@bgub/fig-reconciler",
    });
    hook.onCommitRoot(rendererId, {
      id: 1,
      rendererId,
      committedAt: 1,
      dataResources: [
        {
          canonicalKey: '["refreshing"]',
          hasValue: true,
          key: ["refreshing"],
          pending: true,
          stale: false,
          status: "refreshing",
          subscriberCount: 1,
          value: "previous value",
        },
        {
          canonicalKey: '["pending"]',
          hasValue: false,
          key: ["pending"],
          pending: true,
          stale: false,
          status: "pending",
          subscriberCount: 1,
        },
      ],
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
        // Empty on purpose: the root fiber never reads data itself, yet its
        // selection must still list the whole store.
        dataResourceCanonicalKeys: [],
        children: [
          {
            id: 2,
            parentId: 1,
            name: "WeatherView",
            kind: "function",
            key: null,
            index: 0,
            props: {},
            pendingWork: [],
            childWork: [],
            hooks: [],
            contextDependencies: [],
            dataResourceCanonicalKeys: ['["refreshing"]'],
            children: [],
          },
          {
            id: 3,
            parentId: 1,
            name: "PostView",
            kind: "function",
            key: null,
            index: 1,
            props: {},
            pendingWork: [],
            childWork: [],
            hooks: [],
            contextDependencies: [],
            dataResourceCanonicalKeys: ['["pending"]'],
            children: [],
          },
        ],
      },
    });

    const container = document.createElement("aside");
    document.body.append(container);
    await act(() => {
      createRoot(container, { devtools: false }).render(
        createElement(FigDevtools, { hook, placement: "sidebar" }),
      );
    });

    const entries = container.querySelectorAll(".fig-devtools__data");
    expect(entries[0]?.textContent).toContain("refreshing");
    expect(entries[0]?.textContent).not.toContain("Pending");
    expect(entries[1]?.textContent).toContain("pending");
    expect(entries[1]?.textContent).toContain("Pendingyes");

    const weatherButton = Array.from(
      container.querySelectorAll<HTMLButtonElement>(
        ".fig-devtools__tree-button",
      ),
    ).find((button) => button.textContent?.includes("WeatherView"));
    expect(weatherButton).toBeDefined();
    expect(
      weatherButton?.querySelector(".fig-devtools__data-count")?.textContent,
    ).toBe("1");
    const rootButton = Array.from(
      container.querySelectorAll<HTMLButtonElement>(
        ".fig-devtools__tree-button",
      ),
    ).find((button) => button.textContent?.includes("Root"));
    expect(rootButton?.querySelector(".fig-devtools__data-count")).toBeNull();
    await act(() => weatherButton?.click());

    const selectedEntries = container.querySelectorAll(".fig-devtools__data");
    expect(selectedEntries).toHaveLength(1);
    expect(selectedEntries[0]?.textContent).toContain('["refreshing"]');
    expect(selectedEntries[0]?.textContent).not.toContain('["pending"]');
    expect(selectedEntries[0]?.textContent).not.toContain("Pending");
  });
});
