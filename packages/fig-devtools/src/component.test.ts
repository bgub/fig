// @vitest-environment happy-dom
import { createElement, useState } from "@bgub/fig";
import { createRoot } from "@bgub/fig-dom";
import { act } from "@bgub/fig-dom/test-utils";
import { describe, expect, it } from "vite-plus/test";
import { createFigDevtoolsGlobalHook, FigDevtools } from "./index.ts";
import type { FigDevtoolsGlobalTarget } from "./hook.ts";
import { FIG_DEVTOOLS_HOOK_KEY } from "./hook.ts";

// Mirrors the demo apps' wiring: the panel renders in its own root (with
// DevTools publishing disabled) before any app root commits, then updates as
// app commits arrive through the global hook.
describe("FigDevtools panel", () => {
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

      expect(devtoolsContainer.textContent).toContain("Waiting for a commit");

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
      expect(panelText).not.toContain("Waiting for a commit");
      expect(panelText).toContain("Counter");
    } finally {
      target[FIG_DEVTOOLS_HOOK_KEY] = previous;
    }
  });
});
