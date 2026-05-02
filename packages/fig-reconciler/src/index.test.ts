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

  set textContent(value: string) {
    for (const child of this.childNodes) child.parentNode = null;
    this.childNodes = [];

    if (value !== "") {
      const text = new TestText(value);
      text.parentNode = this;
      this.childNodes.push(text);
    }
  }
}

const host: HostConfig<TestElement, TestElement, TestText> = {
  createInstance: (type) => new TestElement(type),
  createTextInstance: (text) => new TestText(text),
  appendInitialChild: (parent, child) => parent.insertBefore(child, null),
  finalizeInitialInstance: () => undefined,
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
      "Count 3",
    ]);

    const counterId = counter?.id;
    flushSync(() => root.render(createElement(Counter, { label: "Again " })));

    expect(commits.at(-1)?.tree.children[0]?.id).toBe(counterId);
  });

  it("throws a hydration support diagnostic when clearContainer is missing", () => {
    const { hydrateRoot } = createRenderer({
      ...host,
      getFirstHydratableChild: () => null,
      getNextHydratableSibling: () => null,
      canHydrateInstance: () => false,
      canHydrateTextInstance: () => false,
    });
    const container = new TestElement("root");

    expect(() => hydrateRoot(container, createElement("span", null))).toThrow(
      "Hydration is not supported by this renderer.",
    );
  });

  it("coalesces adjacent text children into one host text node", () => {
    let createdTexts = 0;
    let textUpdates = 0;
    const { createRoot, flushSync } = createRenderer({
      ...host,
      createTextInstance: (text) => {
        createdTexts += 1;
        return new TestText(text);
      },
      commitTextUpdate: (text, value) => {
        textUpdates += 1;
        text.nodeValue = value;
      },
    });
    const container = new TestElement("root");
    const root = createRoot(container);

    function App({ count }: { count: number }) {
      return createElement("span", null, "Count", ": ", count);
    }

    flushSync(() => root.render(createElement(App, { count: 1 })));

    expect(container.textContent).toBe("Count: 1");
    expect(createdTexts).toBe(1);

    flushSync(() => root.render(createElement(App, { count: 2 })));

    expect(container.textContent).toBe("Count: 2");
    expect(textUpdates).toBe(1);
  });

  it("uses host text content for text-only host children", () => {
    let createdTexts = 0;
    let textContentUpdates = 0;
    const { createRoot, flushSync } = createRenderer({
      ...host,
      createTextInstance: (text) => {
        createdTexts += 1;
        return new TestText(text);
      },
      setTextContent: (instance, text) => {
        textContentUpdates += 1;
        instance.textContent = text;
      },
    });
    const container = new TestElement("root");
    const root = createRoot(container);

    function App({ count }: { count: number }) {
      return createElement("span", null, "Count", ": ", count);
    }

    flushSync(() => root.render(createElement(App, { count: 1 })));

    expect(container.textContent).toBe("Count: 1");
    expect(createdTexts).toBe(0);
    expect(textContentUpdates).toBe(1);

    flushSync(() => root.render(createElement(App, { count: 2 })));

    expect(container.textContent).toBe("Count: 2");
    expect(createdTexts).toBe(0);
    expect(textContentUpdates).toBe(2);
  });

  it("updates host text content without generic host commits", () => {
    let genericUpdates = 0;
    let textContentUpdates = 0;
    const { createRoot, flushSync } = createRenderer({
      ...host,
      commitUpdate: (instance, previousProps, nextProps) => {
        genericUpdates += 1;
        host.commitUpdate(instance, previousProps, nextProps);
      },
      setTextContent: (instance, text) => {
        textContentUpdates += 1;
        instance.textContent = text;
      },
    });
    const container = new TestElement("root");
    const root = createRoot(container);

    function App({ count }: { count: number }) {
      return createElement("span", { title: "stable" }, "Count ", count);
    }

    flushSync(() => root.render(createElement(App, { count: 1 })));
    flushSync(() => root.render(createElement(App, { count: 2 })));

    expect(container.textContent).toBe("Count 2");
    expect(genericUpdates).toBe(0);
    expect(textContentUpdates).toBe(2);
  });

  it("does not use host text content for mixed element and text children", () => {
    let createdTexts = 0;
    const { createRoot, flushSync } = createRenderer({
      ...host,
      createTextInstance: (text) => {
        createdTexts += 1;
        return new TestText(text);
      },
      setTextContent: (instance, text) => {
        instance.textContent = text;
      },
    });
    const container = new TestElement("root");
    const root = createRoot(container);

    function App() {
      return createElement("span", null, createElement("em", null, "A"), "B");
    }

    flushSync(() => root.render(createElement(App, null)));

    const span = container.childNodes[0] as TestElement;
    expect(span.type).toBe("span");
    expect((span.childNodes[0] as TestElement).type).toBe("em");
    expect(span.textContent).toBe("AB");
    expect(span.childNodes).toHaveLength(2);
    expect(createdTexts).toBe(1);
  });

  it("transitions between host text content and child elements", () => {
    const { createRoot, flushSync } = createRenderer({
      ...host,
      setTextContent: (instance, text) => {
        instance.textContent = text;
      },
    });
    const container = new TestElement("root");
    const root = createRoot(container);

    function App({ text }: { text: boolean }) {
      return createElement(
        "span",
        null,
        text ? "Plain text" : createElement("em", null, "Element text"),
      );
    }

    flushSync(() => root.render(createElement(App, { text: true })));
    expect(container.textContent).toBe("Plain text");

    flushSync(() => root.render(createElement(App, { text: false })));
    expect(container.textContent).toBe("Element text");

    flushSync(() => root.render(createElement(App, { text: true })));
    expect(container.textContent).toBe("Plain text");
  });

  it("inserts preassembled host subtrees once at the live parent", () => {
    let liveInserts = 0;
    let initialAppends = 0;
    const { createRoot, flushSync } = createRenderer({
      ...host,
      appendInitialChild: (parent, child) => {
        initialAppends += 1;
        parent.insertBefore(child, null);
      },
      insertBefore: (parent, child, before) => {
        liveInserts += 1;
        parent.insertBefore(child, before);
      },
    });
    const container = new TestElement("root");
    const root = createRoot(container);

    function App() {
      return createElement(
        "main",
        null,
        createElement("span", null, "A"),
        createElement("span", null, "B"),
      );
    }

    flushSync(() => root.render(createElement(App, null)));

    expect(container.textContent).toBe("AB");
    expect(initialAppends).toBe(4);
    expect(liveInserts).toBe(1);
  });

  it("updates same-order keyed children without remounting", () => {
    const { createRoot, flushSync } = createRenderer(host);
    const container = new TestElement("root");
    const root = createRoot(container);

    function Row({ label }: { label: string }) {
      const [initialLabel] = useState(label);
      return createElement("span", null, label, ":", initialLabel);
    }

    function List({ labels }: { labels: string[] }) {
      return createElement(
        "main",
        null,
        labels.map((label, index) => createElement(Row, { key: index, label })),
      );
    }

    flushSync(() =>
      root.render(createElement(List, { labels: ["A1", "B1", "C1"] })),
    );
    flushSync(() =>
      root.render(createElement(List, { labels: ["A2", "B2", "C2"] })),
    );

    expect(container.textContent).toBe("A2:A1B2:B1C2:C1");
  });

  it("appends keyed children after a same-order prefix", () => {
    const { createRoot, flushSync } = createRenderer(host);
    const container = new TestElement("root");
    const root = createRoot(container);

    function List({ items }: { items: string[] }) {
      return createElement(
        "main",
        null,
        items.map((item) => createElement("span", { key: item }, item)),
      );
    }

    flushSync(() =>
      root.render(createElement(List, { items: ["A", "B", "C"] })),
    );
    flushSync(() =>
      root.render(createElement(List, { items: ["A", "B", "C", "D"] })),
    );

    expect(container.textContent).toBe("ABCD");
  });

  it("prepends keyed children while preserving old child state", () => {
    const { createRoot, flushSync } = createRenderer(host);
    const container = new TestElement("root");
    const root = createRoot(container);

    function Row({ label }: { label: string }) {
      const [initialLabel] = useState(label);
      return createElement("span", null, label, ":", initialLabel);
    }

    function List({ items }: { items: Array<{ id: string; label: string }> }) {
      return createElement(
        "main",
        null,
        items.map((item) =>
          createElement(Row, { key: item.id, label: item.label }),
        ),
      );
    }

    flushSync(() =>
      root.render(
        createElement(List, {
          items: [
            { id: "a", label: "A1" },
            { id: "b", label: "B1" },
          ],
        }),
      ),
    );
    flushSync(() =>
      root.render(
        createElement(List, {
          items: [
            { id: "x", label: "X1" },
            { id: "a", label: "A2" },
            { id: "b", label: "B2" },
          ],
        }),
      ),
    );

    expect(container.textContent).toBe("X1:X1A2:A1B2:B1");
  });

  it("throws duplicate keys before committing fast-path work", () => {
    const { createRoot, flushSync } = createRenderer(host);
    const container = new TestElement("root");
    const root = createRoot(container);

    function List({ items }: { items: string[] }) {
      return createElement(
        "main",
        null,
        items.map((item) => createElement("span", { key: item }, item)),
      );
    }

    flushSync(() => root.render(createElement(List, { items: ["A"] })));

    expect(() =>
      flushSync(() => root.render(createElement(List, { items: ["A", "A"] }))),
    ).toThrow('Duplicate key "A" found among siblings.');
    expect(container.textContent).toBe("A");
  });

  it("commits reversed keyed host children", () => {
    const { createRoot, flushSync } = createRenderer(host);
    const container = new TestElement("root");
    const root = createRoot(container);

    function List({ items }: { items: string[] }) {
      return createElement(
        "main",
        null,
        items.map((item) => createElement("span", { key: item }, item)),
      );
    }

    flushSync(() =>
      root.render(createElement(List, { items: ["A", "B", "C", "D"] })),
    );
    flushSync(() =>
      root.render(createElement(List, { items: ["D", "C", "B", "A"] })),
    );

    expect(container.textContent).toBe("DCBA");
  });

  it("moves host subtrees without forcing descendant placement", () => {
    let liveInserts = 0;
    let hostUpdates = 0;
    let textUpdates = 0;
    const { createRoot, flushSync } = createRenderer({
      ...host,
      insertBefore: (parent, child, before) => {
        liveInserts += 1;
        parent.insertBefore(child, before);
      },
      commitUpdate: () => {
        hostUpdates += 1;
      },
      commitTextUpdate: (text, value) => {
        textUpdates += 1;
        text.nodeValue = value;
      },
    });
    const container = new TestElement("root");
    const root = createRoot(container);

    function List({ items }: { items: string[] }) {
      return createElement(
        "main",
        null,
        items.map((item) =>
          createElement("li", { key: item }, createElement("span", null, item)),
        ),
      );
    }

    flushSync(() =>
      root.render(createElement(List, { items: ["A", "B", "C"] })),
    );
    liveInserts = 0;
    hostUpdates = 0;
    textUpdates = 0;

    flushSync(() =>
      root.render(createElement(List, { items: ["C", "B", "A"] })),
    );

    expect(container.textContent).toBe("CBA");
    expect(liveInserts).toBe(2);
    expect(hostUpdates).toBe(0);
    expect(textUpdates).toBe(0);
  });

  it("commits a moved placement run before a stable anchor", () => {
    const { createRoot, flushSync } = createRenderer(host);
    const container = new TestElement("root");
    const root = createRoot(container);

    function List({ items }: { items: string[] }) {
      return createElement(
        "main",
        null,
        items.map((item) => createElement("span", { key: item }, item)),
      );
    }

    flushSync(() =>
      root.render(createElement(List, { items: ["A", "B", "C", "D", "E"] })),
    );
    flushSync(() =>
      root.render(createElement(List, { items: ["D", "A", "B", "C", "E"] })),
    );

    expect(container.textContent).toBe("DABCE");
  });

  it("commits moved keyed function children", () => {
    let liveInserts = 0;
    const { createRoot, flushSync } = createRenderer({
      ...host,
      insertBefore: (parent, child, before) => {
        liveInserts += 1;
        parent.insertBefore(child, before);
      },
    });
    const container = new TestElement("root");
    const root = createRoot(container);

    function Row({ label }: { label: string }) {
      return createElement("span", null, label);
    }

    function List({ items }: { items: string[] }) {
      return createElement(
        "main",
        null,
        items.map((item) => createElement(Row, { key: item, label: item })),
      );
    }

    flushSync(() =>
      root.render(createElement(List, { items: ["A", "B", "C", "D"] })),
    );
    liveInserts = 0;
    flushSync(() =>
      root.render(createElement(List, { items: ["D", "C", "B", "A"] })),
    );

    expect(container.textContent).toBe("DCBA");
    expect(liveInserts).toBe(3);
  });

  it("commits text updates inside moved keyed children", () => {
    const { createRoot, flushSync } = createRenderer(host);
    const container = new TestElement("root");
    const root = createRoot(container);

    function List({ items, version }: { items: string[]; version: number }) {
      return createElement(
        "main",
        null,
        items.map((item) =>
          createElement("span", { key: item }, `${item}:${version}`),
        ),
      );
    }

    flushSync(() =>
      root.render(createElement(List, { items: ["A", "B", "C"], version: 1 })),
    );
    flushSync(() =>
      root.render(createElement(List, { items: ["C", "A", "B"], version: 2 })),
    );

    expect(container.textContent).toBe("C:2A:2B:2");
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
