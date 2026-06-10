import {
  createElement,
  useBeforeLayout,
  useBeforePaint,
  useReactive,
} from "@bgub/fig";
import { describe, expect, it } from "vite-plus/test";
import { createRoot, flushSync } from "./index.ts";
import { delay, FakeElement, installFakeDocument } from "./test-utils.ts";

installFakeDocument();

// Tests run in development mode, where Fig strict-runs first-time effects:
// run, abort, run again with a fresh signal. Deps-change reruns and unmount
// aborts stay single.
describe("@bgub/fig-dom effects", () => {
  it("runs effect phases in commit order", async () => {
    const calls: string[] = [];
    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);

    function App() {
      useBeforeLayout(() => {
        calls.push(`before-layout:${container.textContent}`);
      });
      useBeforePaint(() => {
        calls.push(`before-paint:${container.textContent}`);
      });
      useReactive(() => {
        calls.push(`reactive:${container.textContent}`);
      });

      return createElement("main", null, "Committed");
    }

    flushSync(() => root.render(createElement(App, null)));
    expect(calls).toEqual([
      "before-layout:",
      "before-layout:",
      "before-paint:Committed",
      "before-paint:Committed",
    ]);

    await delay();
    expect(calls).toEqual([
      "before-layout:",
      "before-layout:",
      "before-paint:Committed",
      "before-paint:Committed",
      "reactive:Committed",
      "reactive:Committed",
    ]);
  });

  it("respects reactive deps and aborts changed effects", async () => {
    const calls: string[] = [];
    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);

    function App({ value }: { value: number }) {
      useReactive(
        (signal) => {
          calls.push(`run:${value}`);
          signal.addEventListener("abort", () => calls.push(`abort:${value}`), {
            once: true,
          });
        },
        [value],
      );

      return createElement("main", null, value);
    }

    root.render(createElement(App, { value: 1 }));
    await delay();
    expect(calls).toEqual(["run:1", "abort:1", "run:1"]);

    root.render(createElement(App, { value: 1 }));
    await delay();
    expect(calls).toEqual(["run:1", "abort:1", "run:1"]);

    root.render(createElement(App, { value: 2 }));
    await delay();
    expect(calls).toEqual(["run:1", "abort:1", "run:1", "abort:1", "run:2"]);

    root.unmount();
    await delay();
    expect(calls).toEqual([
      "run:1",
      "abort:1",
      "run:1",
      "abort:1",
      "run:2",
      "abort:2",
    ]);
  });

  it("flushes pending reactive effects before rendering new work", async () => {
    const calls: string[] = [];
    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);

    function App({ value }: { value: number }) {
      useReactive(
        (signal) => {
          calls.push(`run:${value}`);
          signal.addEventListener("abort", () => calls.push(`abort:${value}`), {
            once: true,
          });
        },
        [value],
      );

      return createElement("main", null, value);
    }

    flushSync(() => root.render(createElement(App, { value: 1 })));
    expect(calls).toEqual([]);

    root.render(createElement(App, { value: 2 }));
    await delay();

    expect(calls).toEqual(["run:1", "abort:1", "run:1", "abort:1", "run:2"]);
  });

  it("aborts before-layout and before-paint signals on deps changes and unmount", () => {
    const calls: string[] = [];
    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);

    function App({ value }: { value: number }) {
      useBeforeLayout(
        (signal) => {
          calls.push(`layout:${value}`);
          signal.addEventListener(
            "abort",
            () => calls.push(`abort-layout:${value}`),
            { once: true },
          );
        },
        [value],
      );
      useBeforePaint(
        (signal) => {
          calls.push(`paint:${value}`);
          signal.addEventListener(
            "abort",
            () => calls.push(`abort-paint:${value}`),
            { once: true },
          );
        },
        [value],
      );

      return createElement("main", null, value);
    }

    flushSync(() => root.render(createElement(App, { value: 1 })));
    flushSync(() => root.render(createElement(App, { value: 2 })));
    flushSync(() => root.unmount());

    expect(calls).toEqual([
      "layout:1",
      "abort-layout:1",
      "layout:1",
      "paint:1",
      "abort-paint:1",
      "paint:1",
      "abort-layout:1",
      "layout:2",
      "abort-paint:1",
      "paint:2",
      "abort-layout:2",
      "abort-paint:2",
    ]);
  });

  it("does not rerun empty-deps effects on updates", async () => {
    const calls: string[] = [];
    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);

    function App({ value }: { value: number }) {
      useReactive((signal) => {
        calls.push(`mount:${value}`);
        signal.addEventListener("abort", () => calls.push(`abort:${value}`), {
          once: true,
        });
      }, []);

      return createElement("main", null, value);
    }

    root.render(createElement(App, { value: 1 }));
    await delay();
    root.render(createElement(App, { value: 2 }));
    await delay();

    expect(calls).toEqual(["mount:1", "abort:1", "mount:1"]);

    root.unmount();
    await delay();
    expect(calls).toEqual(["mount:1", "abort:1", "mount:1", "abort:1"]);
  });

  it("aborts only the removed subtree effects", async () => {
    const calls: string[] = [];
    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);

    function Child() {
      useReactive((signal) => {
        calls.push("child:run");
        signal.addEventListener("abort", () => calls.push("child:abort"), {
          once: true,
        });
      }, []);

      return createElement("span", null, "Child");
    }

    function App({ showChild }: { showChild: boolean }) {
      useReactive((signal) => {
        calls.push("parent:run");
        signal.addEventListener("abort", () => calls.push("parent:abort"), {
          once: true,
        });
      }, []);

      return createElement(
        "main",
        null,
        showChild ? createElement(Child) : null,
      );
    }

    const parentMount = ["parent:run", "parent:abort", "parent:run"];
    const childMount = ["child:run", "child:abort", "child:run"];

    root.render(createElement(App, { showChild: true }));
    await delay();
    expect(calls).toEqual([...parentMount, ...childMount]);

    root.render(createElement(App, { showChild: false }));
    await delay();
    expect(calls).toEqual([...parentMount, ...childMount, "child:abort"]);

    root.unmount();
    await delay();
    expect(calls).toEqual([
      ...parentMount,
      ...childMount,
      "child:abort",
      "parent:abort",
    ]);
  });

  it("reruns only effects whose deps changed", async () => {
    const calls: string[] = [];
    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);

    function App({ a, b }: { a: number; b: number }) {
      useReactive(
        (signal) => {
          calls.push(`a:${a}`);
          signal.addEventListener("abort", () => calls.push(`abort-a:${a}`), {
            once: true,
          });
        },
        [a],
      );
      useReactive(
        (signal) => {
          calls.push(`b:${b}`);
          signal.addEventListener("abort", () => calls.push(`abort-b:${b}`), {
            once: true,
          });
        },
        [b],
      );

      return createElement("main", null, a, b);
    }

    root.render(createElement(App, { a: 1, b: 1 }));
    await delay();
    root.render(createElement(App, { a: 2, b: 1 }));
    await delay();

    expect(calls).toEqual([
      "a:1",
      "abort-a:1",
      "a:1",
      "b:1",
      "abort-b:1",
      "b:1",
      "abort-a:1",
      "a:2",
    ]);
  });
});
