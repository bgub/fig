import {
  createElement,
  ErrorBoundary,
  readPromise,
  Suspense,
  useBeforePaint,
  useReactive,
  useState,
} from "@bgub/fig";
import { describe, expect, it } from "vite-plus/test";
import { createRoot, flushSync } from "./index.ts";
import {
  deferred,
  delay,
  FakeElement,
  installFakeDocument,
} from "./test-utils.ts";

installFakeDocument();

describe("@bgub/fig-dom error boundaries", () => {
  it("renders sticky error boundary fallbacks for render errors", () => {
    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);
    let renders = 0;

    function Broken({ fail }: { fail: boolean }) {
      renders += 1;
      if (fail) throw new Error("boom");
      return createElement("span", null, "Ready");
    }

    function App({ fail }: { fail: boolean }) {
      return createElement(
        ErrorBoundary,
        { fallback: createElement("span", null, "Crashed") },
        createElement(Broken, { fail }),
      );
    }

    flushSync(() => root.render(createElement(App, { fail: false })));
    expect(container.textContent).toBe("Ready");

    flushSync(() => root.render(createElement(App, { fail: true })));
    expect(container.textContent).toBe("Crashed");

    flushSync(() => root.render(createElement(App, { fail: false })));
    expect(container.textContent).toBe("Crashed");
    // Mount renders twice (strict shadow pass); the failing pass throws in
    // the shadow render, and the sticky fallback never renders Broken again.
    expect(renders).toBe(3);
  });

  it("reports caught errors with component stacks after fallback commit", () => {
    const container = new FakeElement("root");
    const reports: Array<{ error: unknown; stack: string }> = [];
    const root = createRoot(container as unknown as Element);

    function Broken(): never {
      throw new Error("boom");
    }

    function Panel() {
      return createElement(Broken, null);
    }

    flushSync(() =>
      root.render(
        createElement(
          ErrorBoundary,
          {
            fallback: createElement("span", null, "Crashed"),
            onError(error, info) {
              reports.push({ error, stack: info.componentStack });
            },
          },
          createElement(Panel, null),
        ),
      ),
    );

    expect(container.textContent).toBe("Crashed");
    const report = reports[0];
    if (report === undefined) throw new Error("Expected error report.");
    expect((report.error as Error).message).toBe("boom");
    expect(report.stack).toContain("at Broken");
    expect(report.stack).toContain("at Panel");
    expect(report.stack).toContain("at ErrorBoundary");
  });

  it("does not let error reporting failures corrupt committed fallbacks", () => {
    const container = new FakeElement("root");
    const uncaught: unknown[] = [];
    const root = createRoot(container as unknown as Element, {
      onUncaughtError(error) {
        uncaught.push(error);
      },
    });

    function Broken(): never {
      throw new Error("boom");
    }

    flushSync(() =>
      root.render(
        createElement(
          ErrorBoundary,
          {
            fallback: createElement("span", null, "Crashed"),
            onError() {
              throw new Error("report failed");
            },
          },
          createElement(Broken, null),
        ),
      ),
    );

    expect(container.textContent).toBe("Crashed");
    expect((uncaught[0] as Error).message).toBe("report failed");
  });

  it("lets error boundary fallbacks update state without retrying children", () => {
    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);
    let renders = 0;
    let setFallbackCount:
      | ((updater: (count: number) => number) => void)
      | null = null;

    function Broken(): never {
      renders += 1;
      throw new Error("boom");
    }

    function Fallback() {
      const [count, setCount] = useState(0);
      setFallbackCount = setCount;
      return createElement("span", null, "Crashed ", count);
    }

    flushSync(() =>
      root.render(
        createElement(
          ErrorBoundary,
          { fallback: createElement(Fallback, null) },
          createElement(Broken, null),
        ),
      ),
    );

    expect(container.textContent).toBe("Crashed 0");
    expect(renders).toBe(1);

    flushSync(() => setFallbackCount?.((count) => count + 1));

    expect(container.textContent).toBe("Crashed 1");
    expect(renders).toBe(1);
  });

  it("resets error boundaries when their key changes", () => {
    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);

    function Broken({ fail }: { fail: boolean }) {
      if (fail) throw new Error("boom");
      return createElement("span", null, "Ready");
    }

    function App({ attempt, fail }: { attempt: number; fail: boolean }) {
      return createElement(
        ErrorBoundary,
        {
          key: attempt,
          fallback: createElement("span", null, "Crashed"),
        },
        createElement(Broken, { fail }),
      );
    }

    flushSync(() =>
      root.render(createElement(App, { attempt: 0, fail: true })),
    );
    expect(container.textContent).toBe("Crashed");

    flushSync(() =>
      root.render(createElement(App, { attempt: 1, fail: false })),
    );
    expect(container.textContent).toBe("Ready");
  });

  it("bubbles fallback errors to the next error boundary", () => {
    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);

    function Broken(): never {
      throw new Error("primary failed");
    }

    function BrokenFallback(): never {
      throw new Error("fallback failed");
    }

    flushSync(() =>
      root.render(
        createElement(
          ErrorBoundary,
          { fallback: createElement("span", null, "Outer") },
          createElement(
            ErrorBoundary,
            { fallback: createElement(BrokenFallback, null) },
            createElement(Broken, null),
          ),
        ),
      ),
    );

    expect(container.textContent).toBe("Outer");
  });

  it("does not catch suspending promises with error boundaries", async () => {
    const pending = deferred<string>();
    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);

    function Message() {
      return createElement("span", null, readPromise(pending.promise));
    }

    flushSync(() =>
      root.render(
        createElement(
          ErrorBoundary,
          { fallback: createElement("span", null, "Crashed") },
          createElement(Message, null),
        ),
      ),
    );

    expect(container.textContent).toBe("");

    pending.resolve("Ready");
    await delay();

    expect(container.textContent).toBe("Ready");
  });

  it("catches rejected promise reasons after Suspense retries", async () => {
    const pending = deferred<string>();
    const container = new FakeElement("root");
    const reports: string[] = [];
    const root = createRoot(container as unknown as Element);

    function Message() {
      return createElement("span", null, readPromise(pending.promise));
    }

    const node = createElement(
      ErrorBoundary,
      {
        fallback: createElement("span", null, "Crashed"),
        onError(error) {
          reports.push((error as Error).message);
        },
      },
      createElement(
        Suspense,
        { fallback: createElement("span", null, "Loading") },
        createElement(Message, null),
      ),
    );

    flushSync(() => root.render(node));
    expect(container.textContent).toBe("Loading");

    pending.reject(new Error("read failed"));
    await delay();

    expect(container.textContent).toBe("Crashed");
    expect(reports).toEqual(["read failed"]);
  });

  it("catches Fig effect errors with error boundaries", () => {
    const container = new FakeElement("root");
    const reports: string[] = [];
    const root = createRoot(container as unknown as Element);

    function BrokenEffect() {
      useBeforePaint(() => {
        throw new Error("effect failed");
      }, []);
      return createElement("span", null, "Primary");
    }

    flushSync(() =>
      root.render(
        createElement(
          ErrorBoundary,
          {
            fallback: createElement("span", null, "Crashed"),
            onError(error) {
              reports.push((error as Error).message);
            },
          },
          createElement(BrokenEffect, null),
        ),
      ),
    );

    flushSync(() => undefined);

    expect(container.textContent).toBe("Crashed");
    expect(reports).toEqual(["effect failed"]);
  });

  it("catches reactive effect errors with error boundaries", async () => {
    const container = new FakeElement("root");
    const reports: string[] = [];
    const root = createRoot(container as unknown as Element);

    function BrokenEffect() {
      useReactive(() => {
        throw new Error("reactive failed");
      }, []);
      return createElement("span", null, "Primary");
    }

    flushSync(() =>
      root.render(
        createElement(
          ErrorBoundary,
          {
            fallback: createElement("span", null, "Crashed"),
            onError(error) {
              reports.push((error as Error).message);
            },
          },
          createElement(BrokenEffect, null),
        ),
      ),
    );

    expect(container.textContent).toBe("Primary");

    await delay();

    expect(container.textContent).toBe("Crashed");
    expect(reports).toEqual(["reactive failed"]);
  });

  it("unmounts uncaught render errors and recovers on later renders", () => {
    const container = new FakeElement("root");
    const uncaught: Array<{ error: unknown; stack: string }> = [];
    const root = createRoot(container as unknown as Element, {
      onUncaughtError(error, info) {
        uncaught.push({ error, stack: info.componentStack });
      },
    });

    function Broken(): never {
      throw new Error("render failed");
    }

    function Recovered() {
      const [value] = useState("Recovered");
      return createElement("main", null, value);
    }

    flushSync(() => root.render(createElement("main", null, "Stable")));

    expect(() => {
      flushSync(() => root.render(createElement(Broken, null)));
    }).toThrow("render failed");

    expect(container.textContent).toBe("");
    const uncaughtReport = uncaught[0];
    if (
      typeof uncaughtReport !== "object" ||
      uncaughtReport === null ||
      !("error" in uncaughtReport) ||
      !("stack" in uncaughtReport)
    ) {
      throw new Error("Expected uncaught error report.");
    }
    expect((uncaughtReport.error as Error).message).toBe("render failed");
    expect(uncaughtReport.stack).toContain("at Broken");

    flushSync(() => root.render(createElement(Recovered, null)));

    expect(container.textContent).toBe("Recovered");
  });

  it("drops pending state updates when uncaught render errors unmount", () => {
    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);
    let setCount: ((updater: (count: number) => number) => void) | null = null;

    function Counter() {
      const [count, set] = useState(0);
      setCount = set;
      return createElement("span", null, count);
    }

    function Broken(): never {
      throw new Error("render failed");
    }

    function App({ fail }: { fail: boolean }) {
      return createElement(
        "main",
        null,
        createElement(Counter, null),
        fail ? createElement(Broken, null) : null,
      );
    }

    flushSync(() => root.render(createElement(App, { fail: false })));
    expect(container.textContent).toBe("0");

    expect(() => {
      flushSync(() => {
        setCount?.((count) => count + 1);
        root.render(createElement(App, { fail: true }));
      });
    }).toThrow("render failed");

    expect(container.textContent).toBe("");

    flushSync(() => root.render(createElement(App, { fail: false })));

    expect(container.textContent).toBe("0");
  });

  it("recovers after before-paint effects throw", () => {
    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);

    function App({
      shouldThrow,
      value,
    }: {
      shouldThrow?: boolean;
      value: string;
    }) {
      useBeforePaint(() => {
        if (shouldThrow) throw new Error("before paint failed");
      }, [shouldThrow]);

      return createElement("main", null, value);
    }

    flushSync(() => root.render(createElement(App, { value: "Stable" })));

    expect(() => {
      flushSync(() =>
        root.render(
          createElement(App, { shouldThrow: true, value: "Committed" }),
        ),
      );
    }).toThrow("before paint failed");

    expect(container.textContent).toBe("");

    flushSync(() => root.render(createElement(App, { value: "Recovered" })));

    expect(container.textContent).toBe("Recovered");
  });

  it("treats bind failures as uncaught commit errors", () => {
    const container = new FakeElement("root");
    const reports: Array<{ error: unknown; stack: string }> = [];
    const root = createRoot(container as unknown as Element, {
      onUncaughtError(error, info) {
        reports.push({ error, stack: info.componentStack });
      },
    });

    function App() {
      return createElement("button", {
        bind() {
          throw new Error("bind failed");
        },
      });
    }

    expect(() =>
      flushSync(() => root.render(createElement(App, null))),
    ).toThrow("bind failed");
    expect(container.textContent).toBe("");
    const report = reports[0];
    if (report === undefined) throw new Error("Expected error report.");
    expect((report.error as Error).message).toBe("bind failed");
    expect(report.stack).toContain("at App");
  });
});
