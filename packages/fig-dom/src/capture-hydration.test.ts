// @vitest-environment happy-dom
import {
  createElement,
  readPromise,
  Suspense,
  transition,
  useState,
  ViewTransition,
  type StateSetter,
} from "@bgub/fig";
import { renderToHtml } from "@bgub/fig-server";
import { expect, it, vi } from "vitest";
import { flushSync, hydrateRoot, on } from "./index.ts";
import { deferred, waitForHostTurns } from "./test-utils.ts";
import { enableViewTransitions } from "./view-transitions.ts";

enableViewTransitions();

it.each(["before-update", "before-ready"] as const)(
  "hydrates a discrete event target synchronously during capture %s",
  async (phase) => {
    const container = document.createElement("div");
    document.body.append(container);
    const ready = deferred<void>();
    const finished = deferred<void>();
    const content = deferred<void>();
    let canHydrate = true;
    let select: StateSetter<string> = () => {};
    let nativeUpdate = () => {};
    const click = vi.fn();
    const onTransition = vi.fn();
    const onRecoverableError = vi.fn();
    const skip = vi.fn();
    const originalStart = Object.getOwnPropertyDescriptor(
      document,
      "startViewTransition",
    );
    const start = vi.fn(
      (input: ViewTransitionUpdateCallback | StartViewTransitionOptions) => {
        const update = typeof input === "function" ? input : input.update!;
        nativeUpdate = () => {
          void update();
        };
        if (phase === "before-ready") nativeUpdate();
        return {
          ready: ready.promise,
          finished: finished.promise,
          updateCallbackDone: Promise.resolve(),
          skipTransition: skip,
          types: new Set<string>(),
        };
      },
    );
    Object.defineProperty(document, "startViewTransition", {
      configurable: true,
      value: start,
    });
    function Button() {
      if (!canHydrate) readPromise(content.promise);
      return createElement(
        "button",
        { mix: on("click", click) },
        "Server button",
      );
    }
    function App() {
      const [label, setLabel] = useState("old");
      select = setLabel;
      return [
        createElement(
          ViewTransition,
          { name: "card", onTransition },
          createElement(
            "section",
            { style: { viewTransitionName: `author-${label}` } },
            label,
          ),
        ),
        createElement(Suspense, { fallback: "Loading" }, createElement(Button)),
      ];
    }
    container.innerHTML = await renderToHtml(createElement(App));
    const button = container.querySelector("button")!;
    canHydrate = false;
    let root: ReturnType<typeof hydrateRoot> | undefined;
    try {
      flushSync(() => {
        root = hydrateRoot(container, createElement(App), {
          onRecoverableError,
        });
      });
      await waitForHostTurns();
      expect(container.innerHTML).toContain("fig:suspense:completed");
      transition(() => select("next"));
      await waitForHostTurns(10);
      expect(start).toHaveBeenCalledOnce();
      canHydrate = true;
      button.click();
      // No scheduler turn or promise settlement is allowed before these checks.
      expect(click).toHaveBeenCalledOnce();
      expect(skip).toHaveBeenCalledOnce();
      expect(container.querySelector("button")).toBe(button);
      expect(container.innerHTML).not.toContain("fig:suspense:");
      expect(container.querySelector("section")!.textContent).toBe("next");
      expect(container.querySelector("section")!.style.viewTransitionName).toBe(
        "author-next",
      );
      nativeUpdate();
      ready.resolve();
      finished.resolve();
      content.resolve();
      await waitForHostTurns();
      expect(click).toHaveBeenCalledOnce();
      expect(onTransition).not.toHaveBeenCalled();
      expect(onRecoverableError).not.toHaveBeenCalled();
      expect(start).toHaveBeenCalledOnce();
      expect(container.querySelector("button")).toBe(button);
    } finally {
      root?.unmount();
      ready.resolve();
      finished.resolve();
      content.resolve();
      await waitForHostTurns();
      if (originalStart)
        Object.defineProperty(document, "startViewTransition", originalStart);
      else Reflect.deleteProperty(document, "startViewTransition");
      container.remove();
    }
  },
);
