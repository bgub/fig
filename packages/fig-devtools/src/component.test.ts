// @vitest-environment happy-dom
import { createElement, useState } from "@bgub/fig";
import { createRoot } from "@bgub/fig-dom";
import { act } from "@bgub/fig-dom/test-utils";
import { describe, expect, it } from "vitest";
import { createFigDevtoolsGlobalHook, FigDevtools } from "./index.ts";
import type { FigDevtoolsGlobalTarget } from "./hook.ts";
import { FIG_DEVTOOLS_HOOK_KEY } from "./hook.ts";

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

    const rootRow = [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Root"),
    );
    await act(() => {
      rootRow?.dispatchEvent(new Event("pointerenter"));
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
