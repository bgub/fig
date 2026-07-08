// @vitest-environment happy-dom
import {
  createElement,
  transition,
  useSyncExternalStore,
  useState,
  ViewTransition,
  type StateSetter,
} from "@bgub/fig";
import { describe, expect, it } from "vite-plus/test";
import { act } from "./act.ts";
import { createRoot } from "./index.ts";

interface MockViewTransitionDocument {
  startViewTransition?: (update: () => void) => {
    finished: Promise<unknown>;
    ready: Promise<unknown>;
  };
}

describe("ViewTransition", () => {
  it("wraps transition commits and restores temporary names", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const snapshots: string[] = [];
    let setLabel: StateSetter<string> | null = null;
    const ownerDocument = document as unknown as MockViewTransitionDocument;
    const previousStart = ownerDocument.startViewTransition;

    ownerDocument.startViewTransition = (update) => {
      snapshots.push(surfaceStyle(container).viewTransitionName ?? "");
      snapshots.push(surfaceStyle(container).viewTransitionClass ?? "");
      update();
      snapshots.push(surfaceStyle(container).viewTransitionName ?? "");
      snapshots.push(surfaceStyle(container).viewTransitionClass ?? "");
      return { finished: Promise.resolve(), ready: Promise.resolve() };
    };

    function App() {
      const [label, set] = useState("First");
      setLabel = set;
      return createElement(
        ViewTransition,
        { default: "fade", name: "card" },
        createElement("section", null, label),
      );
    }

    try {
      const root = createRoot(container);
      await act(() => root.render(createElement(App, null)));
      await act(() => setLabel?.("Sync"));

      expect(snapshots).toEqual([]);

      await act(() => transition(() => setLabel?.("Transition")));

      expect(snapshots).toEqual(["card", "fade", "card", "fade"]);
      await Promise.resolve();
      expect(surfaceStyle(container).viewTransitionName).toBe("");
      expect(surfaceStyle(container).viewTransitionClass).toBe("");
      expect(container.textContent).toBe("Transition");
    } finally {
      ownerDocument.startViewTransition = previousStart;
      container.remove();
    }
  });

  it("keeps the commit alive for async native update callbacks", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const snapshots: string[] = [];
    let setLabel: StateSetter<string> | null = null;
    let returned = false;
    const ownerDocument = document as unknown as MockViewTransitionDocument;
    const previousStart = ownerDocument.startViewTransition;

    ownerDocument.startViewTransition = (update) => {
      queueMicrotask(() => {
        snapshots.push(returned ? "async" : "sync");
        snapshots.push(surfaceStyle(container).viewTransitionName ?? "");
        update();
        snapshots.push(container.textContent ?? "");
        snapshots.push(surfaceStyle(container).viewTransitionName ?? "");
      });
      returned = true;
      return { finished: Promise.resolve(), ready: Promise.resolve() };
    };

    function App() {
      const [label, set] = useState("First");
      setLabel = set;
      return createElement(
        ViewTransition,
        { default: "fade", name: "card" },
        createElement("section", null, label),
      );
    }

    try {
      const root = createRoot(container);
      await act(() => root.render(createElement(App, null)));
      await act(() => transition(() => setLabel?.("Second")));

      expect(snapshots).toEqual(["async", "card", "Second", "card"]);
      expect(container.textContent).toBe("Second");
      await Promise.resolve();
      expect(surfaceStyle(container).viewTransitionName).toBe("");
    } finally {
      ownerDocument.startViewTransition = previousStart;
      container.remove();
    }
  });

  it("uses the share phase for named insert/delete pairs", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const snapshots: string[] = [];
    let setShowFirst: StateSetter<boolean> | null = null;
    const ownerDocument = document as unknown as MockViewTransitionDocument;
    const previousStart = ownerDocument.startViewTransition;

    ownerDocument.startViewTransition = (update) => {
      const oldSurface = container.querySelector("#old") as HTMLElement | null;
      snapshots.push(oldSurface?.style.viewTransitionName ?? "");
      snapshots.push(oldSurface?.style.viewTransitionClass ?? "");
      update();
      const newSurface = container.querySelector("#new") as HTMLElement | null;
      snapshots.push(newSurface?.style.viewTransitionName ?? "");
      snapshots.push(newSurface?.style.viewTransitionClass ?? "");
      return { finished: Promise.resolve(), ready: Promise.resolve() };
    };

    function App() {
      const [showFirst, set] = useState(true);
      setShowFirst = set;
      return showFirst
        ? createElement(
            "div",
            null,
            createElement(
              ViewTransition,
              { exit: "none", name: "card", share: "shared" },
              createElement("section", { id: "old" }, "Old"),
            ),
          )
        : createElement(
            "article",
            null,
            createElement(
              ViewTransition,
              { name: "card", share: "shared" },
              createElement("section", { id: "new" }, "New"),
            ),
          );
    }

    try {
      const root = createRoot(container);
      await act(() => root.render(createElement(App, null)));
      await act(() => transition(() => setShowFirst?.(false)));

      expect(snapshots).toEqual(["card", "shared", "card", "shared"]);
      expect(container.textContent).toBe("New");
    } finally {
      ownerDocument.startViewTransition = previousStart;
      container.remove();
    }
  });

  it("preserves transition priority for external store updates", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const snapshots: string[] = [];
    const listeners = new Set<() => void>();
    let value = "First";
    const ownerDocument = document as unknown as MockViewTransitionDocument;
    const previousStart = ownerDocument.startViewTransition;

    ownerDocument.startViewTransition = (update) => {
      snapshots.push(surfaceStyle(container).viewTransitionName ?? "");
      snapshots.push(surfaceStyle(container).viewTransitionClass ?? "");
      update();
      snapshots.push(surfaceStyle(container).viewTransitionName ?? "");
      snapshots.push(surfaceStyle(container).viewTransitionClass ?? "");
      return { finished: Promise.resolve(), ready: Promise.resolve() };
    };

    function notify() {
      for (const listener of listeners) listener();
    }

    function App() {
      const label = useSyncExternalStore(
        (listener) => {
          listeners.add(listener);
          return () => {
            listeners.delete(listener);
          };
        },
        () => value,
        () => value,
      );
      return createElement(
        ViewTransition,
        { default: "fade", name: "card" },
        createElement("section", null, label),
      );
    }

    try {
      const root = createRoot(container);
      await act(() => root.render(createElement(App, null)));
      await act(() => {
        value = "Sync";
        notify();
      });

      expect(snapshots).toEqual([]);

      await act(() =>
        transition(() => {
          value = "Transition";
          notify();
        }),
      );

      expect(snapshots).toEqual(["card", "fade", "card", "fade"]);
      expect(container.textContent).toBe("Transition");
    } finally {
      ownerDocument.startViewTransition = previousStart;
      container.remove();
    }
  });
});

function surfaceStyle(container: Element): CSSStyleDeclaration & {
  viewTransitionClass?: string;
  viewTransitionName?: string;
} {
  const surface = container.firstElementChild;
  if (surface === null) throw new Error("Expected a surface element.");
  return (surface as HTMLElement).style;
}
