import { createElement, readPromise, Suspense, useState } from "@bgub/fig";
import { requestPaint } from "@bgub/fig-scheduler";
import { afterEach, describe, expect, it } from "vitest";
import {
  createRenderer,
  type FigDevtoolsGlobalHook,
  type FigDevtoolsRootSnapshot,
  type HostConfig,
} from "./index.ts";

class TestText {
  parentNode: TestElement | null = null;

  constructor(public nodeValue: string) {}

  get textContent(): string {
    return this.nodeValue;
  }
}

class TestElement {
  childNodes: Array<TestElement | TestText> = [];
  parentNode: TestElement | null = null;

  constructor(public type: string) {}

  insertBefore(
    node: TestElement | TestText,
    child: TestElement | TestText | null,
  ): void {
    node.parentNode?.removeChild(node);

    if (child === null) {
      this.childNodes.push(node);
    } else {
      const index = this.childNodes.indexOf(child);
      if (index === -1) this.childNodes.push(node);
      else this.childNodes.splice(index, 0, node);
    }

    node.parentNode = this;
  }

  removeChild(node: TestElement | TestText): void {
    const index = this.childNodes.indexOf(node);
    if (index !== -1) this.childNodes.splice(index, 1);
    node.parentNode = null;
  }

  get textContent(): string {
    return this.childNodes.map((child) => child.textContent).join("");
  }
}

const host: HostConfig<TestElement, TestElement, TestText> = {
  createInstance: (type) => new TestElement(type),
  createTextInstance: (text) => new TestText(text),
  insertBefore: (parent, child, before) => parent.insertBefore(child, before),
  removeChild: (parent, child) => parent.removeChild(child),
  commitUpdate: () => undefined,
  commitTextUpdate: (text, value) => {
    text.nodeValue = value;
  },
};

const delay = () => new Promise((resolve) => setTimeout(resolve, 20));

const globalWithDevtoolsHook = globalThis as typeof globalThis & {
  __FIG_DEVTOOLS_GLOBAL_HOOK__?: FigDevtoolsGlobalHook;
};

afterEach(() => {
  delete globalWithDevtoolsHook.__FIG_DEVTOOLS_GLOBAL_HOOK__;
});

describe("reconciler", () => {
  it("commits Suspense fallback and retries the boundary", async () => {
    const { createRoot, flushSync } = createRenderer(host);
    const container = new TestElement("root");
    const root = createRoot(container);
    let resolve: (value: string) => void = () => undefined;
    const promise = new Promise<string>((done) => {
      resolve = done;
    });

    function Message() {
      return createElement("span", null, readPromise(promise));
    }

    function App() {
      return createElement(
        "main",
        null,
        createElement("span", null, "Header"),
        createElement(
          Suspense,
          { fallback: createElement("span", null, "Loading") },
          createElement(Message, null),
        ),
        createElement("span", null, "Footer"),
      );
    }

    flushSync(() => root.render(createElement(App, null)));
    expect(container.textContent).toBe("HeaderLoadingFooter");

    resolve("Loaded");
    await delay();

    expect(container.textContent).toBe("HeaderLoadedFooter");
  });

  it("publishes committed fiber snapshots to the Fig DevTools hook", () => {
    const commits: FigDevtoolsRootSnapshot[] = [];
    const hook: FigDevtoolsGlobalHook = {
      inject(renderer) {
        expect(renderer).toEqual({
          name: "Fig",
          packageName: "@bgub/fig-reconciler",
        });
        return 7;
      },
      onCommitRoot(rendererId, snapshot) {
        expect(rendererId).toBe(7);
        commits.push(snapshot);
      },
    };
    globalWithDevtoolsHook.__FIG_DEVTOOLS_GLOBAL_HOOK__ = hook;

    const { createRoot, flushSync } = createRenderer(host);
    const container = new TestElement("root");
    const root = createRoot(container);

    function Counter({ label }: { label: string }) {
      const [count] = useState(3);
      return createElement("span", { id: "count" }, label, count);
    }

    flushSync(() => root.render(createElement(Counter, { label: "Count " })));

    const firstSnapshot = commits.at(-1);
    expect(firstSnapshot?.rendererId).toBe(7);
    expect(firstSnapshot?.tree.name).toBe("Root");

    const counter = firstSnapshot?.tree.children[0];
    expect(counter?.name).toBe("Counter");
    expect(counter?.kind).toBe("function");
    expect(counter?.hooks).toMatchObject([{ id: 1, kind: "state", state: 3 }]);

    const span = counter?.children[0];
    expect(span?.name).toBe("span");
    expect(span?.props).toEqual({ id: "count" });
    expect(span?.children.map((child) => child.props.nodeValue)).toEqual([
      "Count ",
      "3",
    ]);

    const counterId = counter?.id;
    flushSync(() => root.render(createElement(Counter, { label: "Again " })));

    expect(commits.at(-1)?.tree.children[0]?.id).toBe(counterId);
  });

  it("restarts yielded work when flushSync schedules higher-priority work", async () => {
    const { createRoot, flushSync } = createRenderer(host);
    const container = new TestElement("root");
    const root = createRoot(container);
    let setCount: ((updater: (count: number) => number) => void) | null = null;
    let yieldThenFlush = false;
    let textAfterFlush = "";
    let resolveFlushed = () => undefined;
    const flushed = new Promise<void>((resolve) => {
      resolveFlushed = resolve;
    });

    function Yielding() {
      if (yieldThenFlush) {
        yieldThenFlush = false;
        requestPaint();
        queueMicrotask(() => {
          flushSync(() => setCount?.((count) => count + 1));
          textAfterFlush = container.textContent;
          resolveFlushed();
        });
      }

      return null;
    }

    function Counter() {
      const [count, set] = useState(0);
      setCount = set;
      return createElement("span", null, "count:", count);
    }

    function App({ label }: { label: string }) {
      return createElement(
        "main",
        null,
        createElement(Yielding, null),
        createElement(Counter, null),
        createElement("span", null, label),
      );
    }

    flushSync(() => root.render(createElement(App, { label: "first" })));
    expect(container.textContent).toBe("count:0first");

    yieldThenFlush = true;
    root.render(createElement(App, { label: "second" }));

    await flushed;

    expect(textAfterFlush).toBe("count:1second");
  });
});
