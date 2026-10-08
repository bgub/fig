import {
  createElement,
  ErrorBoundary,
  readPromise,
  Suspense,
  useState,
  type StateSetter,
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

it.each([
  ["sibling", "persistent"],
  ["fallback", "persistent"],
  ["sibling", "recovered"],
  ["fallback", "recovered"],
  ["sibling", "changed"],
  ["fallback", "changed"],
] as const)(
  "retries an uncommitted error after %s suspension: %s",
  async (source, outcome) => {
    const gates = [deferred<void>(), deferred<void>()];
    let failure: Error | null = new Error("primary failed");
    const uncaught: unknown[] = [];
    const reports: Array<{ error: unknown; text: string; stack: string }> = [];
    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element, {
      onUncaughtError(error) {
        uncaught.push(error);
      },
    });
    function Broken() {
      if (failure !== null) throw failure;
      return "Recovered";
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
      // Stable ancestors must not let a bailout adopt the abandoned error.
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

      if (outcome === "recovered") failure = null;
      if (outcome === "changed") failure = new Error("latest failure");
      gates[1].resolve();
      await waitForHostTurns();
      const text = `${failure === null ? "Recovered" : "Crashed"}${source === "sibling" ? "sibling" : ""}`;
      expect(uncaught).toEqual([]);
      expect(container.textContent).toBe(text);
      expect(reports).toEqual(
        failure === null
          ? []
          : [
              {
                error: failure,
                text,
                stack: expect.stringContaining("at Broken"),
              },
            ],
      );

      flushSync(() => root.render([content, "updated"]));
      expect(container.textContent).toBe(`${text}updated`);
      expect(reports).toHaveLength(failure === null ? 0 : 1);
      expect(uncaught).toEqual([]);
    } finally {
      flushSync(() => root.unmount());
    }
  },
);

it("does not report an abandoned error when its suspended subtree is removed", async () => {
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

it("keeps a committed error fallback sticky when it later suspends", async () => {
  const pending = deferred<void>();
  const failure = new Error("committed failure");
  const reports: unknown[] = [];
  const container = new FakeElement("root");
  const root = createRoot(container as unknown as Element);
  let failing = true;
  let blocked = false;
  let primaryRenders = 0;
  let update: StateSetter<number> = () => {};
  function Primary() {
    primaryRenders++;
    if (failing) throw failure;
    return "Recovered";
  }
  function Fallback() {
    const [count, setCount] = useState(0);
    update = setCount;
    if (blocked) readPromise(pending.promise);
    return createElement("span", null, `Crashed ${count}`);
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
              fallback: createElement(Fallback),
              onError(error) {
                reports.push(error);
              },
            },
            createElement(Primary),
          ),
        ),
      ),
    );
    expect(container.textContent).toBe("Crashed 0");
    expect(reports).toEqual([failure]);
    const renders = primaryRenders;

    failing = false;
    blocked = true;
    flushSync(() => update(1));
    expect(container.textContent).toContain("waiting");
    pending.resolve();
    await waitForHostTurns();
    expect(container.textContent).toBe("Crashed 1");
    expect(primaryRenders).toBe(renders);
    expect(reports).toEqual([failure]);
  } finally {
    flushSync(() => root.unmount());
  }
});
