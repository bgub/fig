import {
  createElement,
  ErrorBoundary,
  readPromise,
  Suspense,
  type FigNode,
} from "@bgub/fig";
import { expect, it } from "vitest";
import { createRoot, flushSync } from "./index.ts";
import {
  deferred,
  FakeElement,
  installFakeDocument,
  waitForHostTurns,
} from "./test-utils.ts";

installFakeDocument();

it.each(["sibling", "fallback"] as const)(
  "reports a retained error once after its %s finishes suspending",
  async (source) => {
    const gates = [deferred<void>(), deferred<void>()];
    const failure = new Error("primary failed");
    const uncaught: unknown[] = [];
    const reports: Array<{ error: unknown; text: string; stack: string }> = [];
    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element, {
      onUncaughtError(error) {
        uncaught.push(error);
      },
    });
    function Broken(): never {
      throw failure;
    }
    function Pending() {
      for (const gate of gates) readPromise(gate.promise);
      return source === "sibling" ? "sibling" : "Crashed";
    }
    function Wrapper({ children }: { children: FigNode }) {
      return children;
    }
    const boundary = createElement(
      ErrorBoundary,
      {
        fallback: source === "fallback" ? createElement(Pending) : "Crashed",
        onError(error, info) {
          reports.push({
            error,
            text: container.textContent,
            stack: info.componentStack,
          });
        },
      },
      createElement(Broken),
    );
    const content = createElement(
      Suspense,
      { fallback: "waiting" },
      // The second wrapper can adopt its children on retry, so the error
      // boundary itself need not begin again before its fallback commits.
      createElement(Wrapper, null, createElement(Wrapper, null, boundary)),
      source === "sibling" ? createElement(Pending) : null,
    );
    try {
      flushSync(() => root.render(content));
      expect(container.textContent).toBe("waiting");
      expect(reports).toEqual([]);

      gates[0].resolve();
      await waitForHostTurns();
      expect(container.textContent).toBe("waiting");
      expect(reports).toEqual([]);

      gates[1].resolve();
      await waitForHostTurns();
      const text = source === "sibling" ? "Crashedsibling" : "Crashed";
      expect(uncaught).toEqual([]);
      expect(container.textContent).toBe(text);
      expect(reports).toEqual([
        { error: failure, text, stack: expect.stringContaining("at Broken") },
      ]);

      flushSync(() => root.render([content, "updated"]));
      expect(container.textContent).toBe(`${text}updated`);
      expect(reports).toHaveLength(1);
      expect(uncaught).toEqual([]);
    } finally {
      flushSync(() => root.unmount());
    }
  },
);

it("does not report a retained error when its suspended subtree is removed", async () => {
  const pending = deferred<string>();
  const reports: unknown[] = [];
  const container = new FakeElement("root");
  const root = createRoot(container as unknown as Element);
  function Broken(): never {
    throw new Error("discarded error");
  }
  try {
    flushSync(() =>
      root.render(
        createElement(
          Suspense,
          { fallback: "waiting" },
          createElement(
            ErrorBoundary,
            {
              fallback: "Crashed",
              onError(error) {
                reports.push(error);
              },
            },
            createElement(Broken),
          ),
          pending.promise,
        ),
      ),
    );
    expect(container.textContent).toBe("waiting");
    expect(reports).toEqual([]);
    flushSync(() => root.render("replacement"));
    pending.resolve("late");
    await waitForHostTurns();
    expect(container.textContent).toBe("replacement");
    expect(reports).toEqual([]);
  } finally {
    flushSync(() => root.unmount());
  }
});
