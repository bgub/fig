import {
  Activity,
  assets,
  createContext,
  createElement,
  dataResource,
  ErrorBoundary,
  meta,
  type Props,
  readContext,
  readData,
  readPromise,
  Suspense,
  type StartTransition,
  stylesheet,
  title,
  useBeforeLayout,
  useBeforePaint,
  useSyncExternalStore,
  useDeferredValue,
  useMemo,
  useReactive,
  useState,
  useStableEvent,
  useTransition,
  ViewTransition,
} from "@bgub/fig";
import { Assets } from "@bgub/fig/internal";
import type { DataStoreEntrySnapshot } from "@bgub/fig/internal";
import type { ReconcilerCommitCoordinator } from "@bgub/fig-reconciler/commit-coordinator";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  FigDevtoolsCommitInspection,
  FigDevtoolsFiberSnapshot,
  FigDevtoolsGlobalHook,
  FigDevtoolsRootSnapshot,
} from "./devtools.ts";
import { createRenderer, type HostConfig } from "./index.ts";
import { requestPaint } from "./scheduler.ts";
import { waitForHostTurns } from "./test-utils.ts";

class TestText {
  parentNode: TestElement | null = null;
  hidden = false;

  constructor(public nodeValue: string) {}

  get textContent(): string {
    return this.hidden ? "" : this.nodeValue;
  }
}

class TestElement {
  childNodes: Array<TestElement | TestText> = [];
  parentNode: TestElement | null = null;
  attributeReads = 0;
  hidden = false;

  constructor(public type: string) {}

  getAttribute(_name: string): string | null {
    this.attributeReads += 1;
    return "test-value";
  }

  getAttributeNames(): string[] {
    this.attributeReads += 1;
    return ["data-test"];
  }

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
    if (this.hidden) return "";
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
  hideInstance: (instance) => {
    instance.hidden = true;
  },
  unhideInstance: (instance) => {
    instance.hidden = false;
  },
  hideTextInstance: (text) => {
    text.hidden = true;
  },
  unhideTextInstance: (text) => {
    text.hidden = false;
  },
  commitUpdate: () => undefined,
  commitTextUpdate: (text, value) => {
    text.nodeValue = value;
  },
};

function commitCoordinatorHostTypeChecks(): void {
  const renderer = createRenderer(host);
  const mismatched: ReconcilerCommitCoordinator<string, string> = {
    name: "mismatched",
    commit: () => false,
  };

  // @ts-expect-error coordinator host identities must match the renderer.
  renderer.installCommitCoordinator(mismatched);
}

void commitCoordinatorHostTypeChecks;

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const globalWithDevtoolsHook = globalThis as typeof globalThis & {
  __FIG_DEVTOOLS_GLOBAL_HOOK__?: FigDevtoolsGlobalHook;
};

function collectDevtoolsCommits(): FigDevtoolsRootSnapshot[] {
  const commits: FigDevtoolsRootSnapshot[] = [];
  globalWithDevtoolsHook.__FIG_DEVTOOLS_GLOBAL_HOOK__ = {
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
  return commits;
}

function collectDevtoolsInspections(): FigDevtoolsCommitInspection[] {
  const inspections: FigDevtoolsCommitInspection[] = [];
  globalWithDevtoolsHook.__FIG_DEVTOOLS_GLOBAL_HOOK__ = {
    inject() {
      return 7;
    },
    onCommitRoot(_rendererId, _snapshot, inspection) {
      if (inspection !== undefined) inspections.push(inspection);
    },
  };
  return inspections;
}

function dataSubscriberCounts(handle: object): number[] {
  if (!hasInspectDataEntries(handle)) {
    throw new Error("Expected test data store to expose entry inspection.");
  }
  return handle.inspectDataEntries().map((entry) => entry.subscriberCount);
}

function hasInspectDataEntries(handle: object): handle is {
  inspectDataEntries(): readonly DataStoreEntrySnapshot[];
} {
  return (
    "inspectDataEntries" in handle &&
    typeof handle.inspectDataEntries === "function"
  );
}

afterEach(() => {
  delete globalWithDevtoolsHook.__FIG_DEVTOOLS_GLOBAL_HOOK__;
});

describe("reconciler", () => {
  it("installs one commit coordinator idempotently", () => {
    const renderer = createRenderer(host);
    const container = new TestElement("root");
    const order: string[] = [];
    const coordinator: ReconcilerCommitCoordinator<TestElement, TestElement> = {
      name: "coordinator",
      commit(context) {
        order.push("coordinate");
        context.runMutation(() => order.push("after-mutation"));
        return "committed";
      },
    };

    const root = renderer.createRoot(container);
    renderer.installCommitCoordinator(coordinator);
    renderer.installCommitCoordinator(coordinator);
    renderer.flushSync(() =>
      root.render(createElement("span", null, "Coordinated")),
    );

    expect(container.textContent).toBe("Coordinated");
    expect(order).toEqual(["coordinate", "after-mutation"]);
    expect(() =>
      renderer.installCommitCoordinator({
        name: "other-coordinator",
        commit: () => false,
      }),
    ).toThrow(/already owned by "coordinator"/);
  });

  it("warns when an installed coordinator lacks View Transition support", () => {
    const renderer = createRenderer(host);
    const warning = vi.spyOn(console, "error").mockImplementation(() => {});
    renderer.installCommitCoordinator({
      name: "unrelated-coordinator",
      commit: () => false,
    });

    const root = renderer.createRoot(new TestElement("root"));
    renderer.flushSync(() =>
      root.render(
        createElement(
          ViewTransition,
          { name: "card" },
          createElement("span", null, "Unanimated"),
        ),
      ),
    );

    expect(warning).toHaveBeenCalledWith(
      expect.stringContaining("does not provide View Transition support"),
    );
  });

  it("lets a commit coordinator finish a deferred transaction", () => {
    const renderer = createRenderer(host);
    const container = new TestElement("root");
    const deferred: { commit: (() => void) | null } = { commit: null };

    renderer.installCommitCoordinator({
      name: "deferred-coordinator",
      commit(context) {
        deferred.commit = () => {
          context.runMutation(() => undefined);
          context.captureFinished();
        };
        return "deferred";
      },
    });

    const root = renderer.createRoot(container);
    renderer.flushSync(() =>
      root.render(createElement("span", null, "Deferred")),
    );
    expect(container.textContent).toBe("");

    deferred.commit?.();
    expect(container.textContent).toBe("Deferred");
  });

  it("rejects capture completion before the mutation transaction", () => {
    const renderer = createRenderer(host);
    const root = renderer.createRoot(new TestElement("root"));

    renderer.installCommitCoordinator({
      name: "broken-coordinator",
      commit(context) {
        context.captureFinished();
        return "deferred";
      },
    });

    expect(() =>
      renderer.flushSync(() =>
        root.render(createElement("span", null, "Never committed")),
      ),
    ).toThrow(/before running the mutation transaction/);
  });

  it("returns the flushSync callback result", () => {
    const { flushSync } = createRenderer(host);

    expect(flushSync(() => "result")).toBe("result");
  });

  it("does not require a process global to render", () => {
    vi.stubGlobal("process", undefined);

    try {
      const { createRoot, flushSync } = createRenderer(host);
      const container = new TestElement("root");
      const root = createRoot(container);

      flushSync(() => root.render(createElement("span", null, "Hello")));

      expect(container.textContent).toBe("Hello");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("flushes sync updates before rethrowing a flushSync callback error", () => {
    const { createRoot, flushSync } = createRenderer(host);
    const container = new TestElement("root");
    const root = createRoot(container);
    let setCount: ((count: number) => void) | undefined;

    function Counter() {
      const [count, nextCount] = useState(0);
      setCount = nextCount;
      return createElement("span", null, `Count ${count}`);
    }

    flushSync(() => root.render(createElement(Counter, null)));
    expect(container.textContent).toBe("Count 0");

    expect(() =>
      flushSync(() => {
        setCount?.(1);
        throw new Error("boom");
      }),
    ).toThrow("boom");

    expect(container.textContent).toBe("Count 1");
  });

  it("rejects flushSync calls during render with a clear error", () => {
    const { createRoot, flushSync } = createRenderer(host);
    const container = new TestElement("root");
    const root = createRoot(container);

    function Broken() {
      flushSync(() => undefined);
      return createElement("span", null, "unreachable");
    }

    expect(() =>
      flushSync(() => root.render(createElement(Broken, null))),
    ).toThrow("flushSync cannot be called while rendering a component.");
  });

  it("does not flush suspended root work at NoLanes", async () => {
    const { createRoot, flushSync } = createRenderer(host);
    const container = new TestElement("root");
    const root = createRoot(container);
    const pending = deferred<string>();
    let renders = 0;

    function SuspendedRoot() {
      renders += 1;
      return createElement("span", null, readPromise(pending.promise));
    }

    flushSync(() => root.render(createElement(SuspendedRoot, null)));
    expect(renders).toBe(1);

    flushSync(() => undefined);
    expect(renders).toBe(1);

    pending.resolve("Ready");
    await waitForHostTurns();

    expect(container.textContent).toBe("Ready");
  });

  it("keeps kept siblings' hooks live when a keyed sibling is deleted", async () => {
    const { createRoot, flushSync } = createRenderer(host);
    const container = new TestElement("root");
    const root = createRoot(container);

    const events: string[] = [];
    function Item({ id }: { id: string }) {
      useReactive(
        (signal) => {
          events.push(`run:${id}`);
          signal.addEventListener("abort", () => events.push(`abort:${id}`));
        },
        [id],
      );
      return createElement("span", null, id);
    }

    const list = (ids: string[]) =>
      createElement(
        "ul",
        null,
        ids.map((id) => createElement(Item, { key: id, id })),
      );

    flushSync(() => root.render(list(["a", "b", "c"])));
    await waitForHostTurns();
    // Dev strict rendering re-runs each effect once; only deletion behavior
    // is under test here.
    events.length = 0;

    // Deleting the head goes through the keyed-map path, where the deletion
    // entry's old-generation sibling pointers still reference kept fibers
    // whose hook state is shared with the new generation. Teardown must stay
    // inside the deleted subtree.
    flushSync(() => root.render(list(["b", "c"])));
    await waitForHostTurns();

    expect(container.textContent).toBe("bc");
    expect(events).toEqual(["abort:a"]);
  });

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
    await waitForHostTurns();

    expect(container.textContent).toBe("HeaderLoadedFooter");
  });

  it("renders promise-valued children as distinct child slots", async () => {
    const { createRoot, flushSync } = createRenderer(host);
    const container = new TestElement("root");
    const root = createRoot(container);
    const pending = deferred<string>();

    flushSync(() =>
      root.render(
        createElement(
          Suspense,
          { fallback: createElement("span", null, "Loading") },
          createElement("main", null, "before", pending.promise, "after"),
        ),
      ),
    );
    expect(container.textContent).toBe("Loading");

    pending.resolve("middle");
    await waitForHostTurns();

    expect(container.textContent).toBe("beforemiddleafter");
    const main = container.childNodes[0] as TestElement;
    expect(main.childNodes.map((child) => child.textContent)).toEqual([
      "before",
      "middle",
      "after",
    ]);
  });

  it("gives element brands precedence over incidental then methods", () => {
    const { createRoot, flushSync } = createRenderer(host);
    const container = new TestElement("root");
    const root = createRoot(container);

    function thenableElement(value: string) {
      const element = createElement("span", null, value);
      // oxlint-disable-next-line unicorn/no-thenable -- verifies brand precedence over structural thenables
      Reflect.defineProperty(element, "then", { value: () => undefined });
      return element;
    }

    flushSync(() =>
      root.render(
        createElement(
          Suspense,
          { fallback: "Loading" },
          thenableElement("first"),
        ),
      ),
    );

    expect(container.textContent).toBe("first");
    const instance = container.childNodes[0];

    flushSync(() =>
      root.render(
        createElement(
          Suspense,
          { fallback: "Loading" },
          thenableElement("second"),
        ),
      ),
    );

    expect(container.textContent).toBe("second");
    expect(container.childNodes[0]).toBe(instance);
  });

  it("reuses a memoized promise child across client Suspense retries", async () => {
    const { createRoot, flushSync } = createRenderer(host);
    const container = new TestElement("root");
    const root = createRoot(container);
    const pending = deferred<string>();

    function App() {
      const child = useMemo(
        () =>
          pending.promise.then((value) => createElement("span", null, value)),
        [pending.promise],
      );
      return createElement(
        Suspense,
        { fallback: createElement("span", null, "Loading") },
        child,
      );
    }

    flushSync(() => root.render(createElement(App, null)));
    expect(container.textContent).toBe("Loading");

    pending.resolve("Ready");
    await waitForHostTurns();

    expect(container.textContent).toBe("Ready");
  });

  it("routes rejected promise children to the nearest ErrorBoundary", async () => {
    const { createRoot, flushSync } = createRenderer(host);
    const container = new TestElement("root");
    const root = createRoot(container);
    let reject: (error: unknown) => void = () => undefined;
    const promise = new Promise<string>((_resolve, fail) => {
      reject = fail;
    });

    flushSync(() =>
      root.render(
        createElement(
          ErrorBoundary,
          {
            fallback: (error) =>
              createElement(
                "span",
                null,
                `Caught: ${(error as Error).message}`,
              ),
          },
          createElement(
            Suspense,
            { fallback: createElement("span", null, "Loading") },
            promise,
          ),
        ),
      ),
    );
    expect(container.textContent).toBe("Loading");

    reject(new Error("failed"));
    await waitForHostTurns();

    expect(container.textContent).toBe("Caught: failed");
  });

  it("retries a suspended boundary reused in place across a parent bailout", async () => {
    const { createRoot, flushSync } = createRenderer(host);
    const container = new TestElement("root");
    const root = createRoot(container);
    const { promise, resolve } = deferred<string>();

    function Message() {
      return createElement("span", null, readPromise(promise));
    }

    function Section() {
      return createElement(
        Suspense,
        { fallback: createElement("span", null, "Loading") },
        createElement(Message, null),
      );
    }

    // A stable element identity makes Section bail out on the next render,
    // reusing the suspended boundary in place: the boundary's return chain
    // then ends at the previous root generation while the committed tree
    // still contains it, and its ping must not be dropped.
    const section = createElement(Section, null);

    function App({ tick }: { tick: number }) {
      return createElement(
        "main",
        null,
        createElement("span", null, `tick ${tick}`),
        section,
      );
    }

    flushSync(() => root.render(createElement(App, { tick: 0 })));
    expect(container.textContent).toBe("tick 0Loading");

    // One commit while suspended flips root.current away from the generation
    // the boundary's return pointers lead to.
    flushSync(() => root.render(createElement(App, { tick: 1 })));
    expect(container.textContent).toBe("tick 1Loading");

    resolve("Loaded");
    await waitForHostTurns();

    expect(container.textContent).toBe("tick 1Loaded");
  });

  it("no-ops retries and updates that land after their boundary is deleted", async () => {
    const { createRoot, flushSync } = createRenderer(host);
    const container = new TestElement("root");
    const root = createRoot(container);
    const { promise, resolve } = deferred<string>();
    let setOutside: (value: number) => void = () => undefined;

    function Message() {
      return createElement("span", null, readPromise(promise));
    }

    function App({ showBoundary }: { showBoundary: boolean }) {
      const [outside, setState] = useState(0);
      setOutside = setState;
      return createElement(
        "main",
        null,
        createElement("span", null, `outside ${outside}`),
        showBoundary
          ? createElement(
              Suspense,
              { fallback: createElement("span", null, "Loading") },
              createElement(Message, null),
            )
          : null,
      );
    }

    flushSync(() => root.render(createElement(App, { showBoundary: true })));
    expect(container.textContent).toBe("outside 0Loading");

    // Delete the suspended boundary while its thenable is still pending;
    // deletion teardown severs the boundary's root path.
    flushSync(() => root.render(createElement(App, { showBoundary: false })));
    expect(container.textContent).toBe("outside 0");

    // The late resolution must neither crash nor resurrect the boundary.
    resolve("Loaded");
    await waitForHostTurns();
    expect(container.textContent).toBe("outside 0");

    // The root itself must stay fully schedulable afterwards.
    flushSync(() => setOutside(1));
    expect(container.textContent).toBe("outside 1");
  });

  it("retries a boundary that suspends again during a retry render", async () => {
    const { createRoot, flushSync } = createRenderer(host);
    const container = new TestElement("root");
    const root = createRoot(container);
    let resolveFirst: (value: string) => void = () => undefined;
    let resolveSecond: (value: string) => void = () => undefined;
    const first = new Promise<string>((done) => {
      resolveFirst = done;
    });
    const second = new Promise<string>((done) => {
      resolveSecond = done;
    });

    function Message() {
      const start = readPromise(first);
      const rest = readPromise(second);
      return createElement("span", null, `${start}${rest}`);
    }

    function App() {
      return createElement(
        Suspense,
        { fallback: createElement("span", null, "Loading") },
        createElement(Message, null),
      );
    }

    flushSync(() => root.render(createElement(App, null)));
    expect(container.textContent).toBe("Loading");

    resolveFirst("Hello ");
    await waitForHostTurns();
    expect(container.textContent).toBe("Loading");

    resolveSecond("World");
    await waitForHostTurns();
    expect(container.textContent).toBe("Hello World");
  });

  it("keeps tag-specific boundary state isolated across alternates", async () => {
    const { createRoot, flushSync } = createRenderer(host);
    const container = new TestElement("root");
    const root = createRoot(container);
    let fail = false;
    let resolve: (value: string) => void = () => undefined;
    const message = new Promise<string>((done) => {
      resolve = done;
    });

    function Content() {
      if (fail) throw new Error("failed");
      return createElement("span", null, readPromise(message));
    }

    function App({ mode }: { mode: "hidden" | "visible" }) {
      return createElement(
        Activity,
        { mode },
        createElement(
          ErrorBoundary,
          { fallback: createElement("span", null, "Crashed") },
          createElement(
            Suspense,
            { fallback: createElement("span", null, "Loading") },
            createElement(Content, null),
          ),
        ),
      );
    }

    flushSync(() => root.render(createElement(App, { mode: "visible" })));
    expect(container.textContent).toBe("Loading");

    resolve("Loaded");
    await waitForHostTurns();
    expect(container.textContent).toBe("Loaded");

    flushSync(() => root.render(createElement(App, { mode: "hidden" })));
    expect(container.textContent).toBe("");

    fail = true;
    flushSync(() => root.render(createElement(App, { mode: "visible" })));
    expect(container.textContent).toBe("Crashed");

    flushSync(() => root.render(createElement(App, { mode: "hidden" })));
    flushSync(() => root.render(createElement(App, { mode: "visible" })));
    expect(container.textContent).toBe("Crashed");
  });

  it("publishes committed fiber snapshots to the Fig DevTools hook", () => {
    const commits = collectDevtoolsCommits();
    const { createRoot, flushSync } = createRenderer(host);
    const container = new TestElement("root");
    const root = createRoot(container);

    function Counter({ label }: { label: string }) {
      const [count] = useState(3);
      const text = useMemo(() => `${label}${count}`, [label, count]);
      return createElement("span", { id: "count" }, text);
    }

    flushSync(() => root.render(createElement(Counter, { label: "Count " })));

    const firstSnapshot = commits.at(-1);
    expect(firstSnapshot?.rendererId).toBe(7);
    expect(firstSnapshot?.tree.name).toBe("Root");

    const counter = firstSnapshot?.tree.children[0];
    expect(counter?.name).toBe("Counter");
    expect(counter?.kind).toBe("function");
    expect(counter?.hooks).toMatchObject([
      { id: 1, kind: "state", state: 3 },
      { id: 2, kind: "memo", state: "Count 3", deps: ["Count ", 3] },
    ]);

    const span = counter?.children[0];
    expect(span?.name).toBe("span");
    expect(span?.host).toEqual({
      kind: "element",
      tagName: "span",
      attributes: {},
    });
    expect((container.childNodes[0] as TestElement).attributeReads).toBe(0);
    expect(span?.props).toEqual({ id: "count" });
    expect(span?.children.map((child) => child.props.nodeValue)).toEqual([
      "Count 3",
    ]);
    expect(span?.children[0]?.host).toEqual({
      kind: "text",
      text: "Count 3",
    });

    const counterId = counter?.id;
    flushSync(() => root.render(createElement(Counter, { label: "Again " })));

    expect(commits.at(-1)?.tree.children[0]?.id).toBe(counterId);
  });

  it("can disable DevTools publishing for a root", () => {
    const commits = collectDevtoolsCommits();
    const { createRoot, flushSync } = createRenderer(host);
    const container = new TestElement("root");
    const root = createRoot(container, { devtools: false });

    flushSync(() => root.render(createElement("span", null, "Hidden")));

    expect(container.textContent).toBe("Hidden");
    expect(commits).toEqual([]);
  });

  it("maps host instances to DevTools fiber ids for element inspection", () => {
    const inspections = collectDevtoolsInspections();
    const { createRoot, flushSync } = createRenderer(host);
    const container = new TestElement("root");
    const root = createRoot(container);

    flushSync(() => root.render(createElement("button", null, "Inspect")));

    const button = container.childNodes[0];
    const inspected = inspections.at(-1)?.inspectElement(button);

    expect(inspected?.rootId).toBeGreaterThan(0);
    expect(inspected?.fiberId).toBeGreaterThan(0);
  });

  it("publishes Suspense fibers to DevTools snapshots", () => {
    const commits = collectDevtoolsCommits();
    const { createRoot, flushSync } = createRenderer(host);
    const container = new TestElement("root");
    const root = createRoot(container);

    flushSync(() =>
      root.render(
        createElement(
          Suspense,
          { fallback: createElement("span", null, "Loading") },
          createElement("span", null, "Ready"),
        ),
      ),
    );

    const suspense = commits.at(-1)?.tree.children[0];
    expect(suspense).toMatchObject({
      kind: "suspense",
      name: "Suspense",
    });
    expect(suspense?.children[0]?.name).toBe("span");
  });

  it("flattens promise slots out of DevTools snapshots", async () => {
    const commits = collectDevtoolsCommits();
    const { createRoot, flushSync } = createRenderer(host);
    const container = new TestElement("root");
    const root = createRoot(container);
    const pending = deferred<ReturnType<typeof createElement>>();

    flushSync(() =>
      root.render(
        createElement(Suspense, { fallback: "Loading" }, pending.promise),
      ),
    );
    pending.resolve(createElement("span", null, "Ready"));
    await waitForHostTurns();

    const suspense = commits.at(-1)?.tree.children[0];
    expect(suspense?.children[0]?.name).toBe("span");
    expect(JSON.stringify(suspense)).not.toContain("Promise");
  });

  it("publishes data resource entries to DevTools snapshots", () => {
    const commits = collectDevtoolsCommits();
    const { createRoot, flushSync } = createRenderer(host);
    const container = new TestElement("root");
    const root = createRoot(container);
    const messageResource = dataResource({
      key: (id: string) => ["devtools-message", id],
      load: () => "Loaded",
    });

    function Message() {
      return createElement("span", null, readData(messageResource, "one"));
    }

    // Hoisted so App re-renders hand Message the same element and it bails
    // out without re-reading.
    const message = createElement(Message, null);
    let bump = () => undefined;

    function App() {
      const [count, setCount] = useState(0);
      bump = () => {
        setCount((value) => value + 1);
      };
      return createElement(
        "main",
        null,
        createElement("span", null, `count ${count}`),
        message,
      );
    }

    flushSync(() => root.render(createElement(App, null)));

    expect(commits.at(-1)?.dataResources).toMatchObject([
      {
        canonicalKey: '["devtools-message","one"]',
        hasValue: true,
        key: ["devtools-message", "one"],
        pending: false,
        stale: false,
        status: "fulfilled",
        subscriberCount: 1,
        value: "Loaded",
      },
    ]);
    expect(commits.at(-1)?.tree.dataResourceCanonicalKeys).toEqual([]);
    const findByName = (
      fiber: FigDevtoolsFiberSnapshot,
      name: string,
    ): FigDevtoolsFiberSnapshot | undefined => {
      if (fiber.name === name) return fiber;
      for (const child of fiber.children) {
        const found = findByName(child, name);
        if (found !== undefined) return found;
      }
      return undefined;
    };
    const messageFiber = (snapshot: FigDevtoolsRootSnapshot | undefined) =>
      snapshot === undefined ? undefined : findByName(snapshot.tree, "Message");
    expect(messageFiber(commits.at(-1))).toMatchObject({
      dataResourceCanonicalKeys: ['["devtools-message","one"]'],
    });

    // An unrelated parent update clones Message but bails out of rendering
    // it, so commitDataDependencies never moves the keys to the new
    // generation — the snapshot must still report them.
    flushSync(() => bump());
    expect(messageFiber(commits.at(-1))).toMatchObject({
      dataResourceCanonicalKeys: ['["devtools-message","one"]'],
    });
  });

  it("publishes resource wrappers as transparent fibers", () => {
    const commits = collectDevtoolsCommits();
    const { createRoot, flushSync } = createRenderer(host);
    const container = new TestElement("root");
    const root = createRoot(container);

    flushSync(() =>
      root.render(
        assets(stylesheet("/app.css"), createElement("span", null, "Ready")),
      ),
    );

    const wrapper = commits.at(-1)?.tree.children[0];
    expect(wrapper).toMatchObject({
      kind: "assets",
      name: "Assets",
    });
    expect(wrapper?.children[0]?.name).toBe("span");
    expect(container.textContent).toBe("Ready");
  });

  it("commits declarative asset ownership through the host lifecycle", () => {
    const changes: Array<readonly [unknown, unknown]> = [];
    const owners: object[] = [];
    const { createRoot, flushSync } = createRenderer({
      ...host,
      commitAssetResources(previous, next, owner) {
        changes.push([previous, next]);
        owners.push(owner);
      },
    });
    const container = new TestElement("root");
    const root = createRoot(container);
    const first = title("One");
    const second = title("Two");

    flushSync(() =>
      root.render(
        createElement(
          "main",
          null,
          assets(first, createElement("span", null, "Ready")),
        ),
      ),
    );
    flushSync(() =>
      root.render(
        createElement(
          "main",
          null,
          assets(second, createElement("span", null, "Ready")),
        ),
      ),
    );
    flushSync(() => root.render(null));

    expect(changes).toEqual([
      [null, first],
      [first, second],
      [second, null],
    ]);
    expect(owners[1]).toBe(owners[0]);
    expect(owners[2]).toBe(owners[0]);
  });

  it("gives sibling asset owners distinct stable identities", () => {
    const acquisitions: object[] = [];
    const releases: object[] = [];
    const { createRoot, flushSync } = createRenderer({
      ...host,
      commitAssetResources(previous, next, owner) {
        if (previous === null) acquisitions.push(owner);
        if (next === null) releases.push(owner);
      },
    });
    const container = new TestElement("root");
    const root = createRoot(container);

    flushSync(() =>
      root.render(
        createElement("main", null, assets(title("One")), assets(title("Two"))),
      ),
    );
    flushSync(() => root.render(null));

    expect(acquisitions).toHaveLength(2);
    expect(acquisitions[1]).not.toBe(acquisitions[0]);
    expect(new Set(releases)).toEqual(new Set(acquisitions));
  });

  it("does not acquire assets from a discarded suspended render", async () => {
    const changes: Array<readonly [unknown, unknown]> = [];
    const { createRoot, flushSync } = createRenderer({
      ...host,
      commitAssetResources(previous, next) {
        changes.push([previous, next]);
      },
    });
    const container = new TestElement("root");
    const root = createRoot(container);
    let resolve!: (value: string | PromiseLike<string>) => void;
    const pending = new Promise<string>((complete) => {
      resolve = complete;
    });

    function Reader() {
      return readPromise(pending);
    }

    flushSync(() =>
      root.render(
        createElement(
          Suspense,
          { fallback: "Loading" },
          assets(title("Pending"), createElement(Reader, null)),
        ),
      ),
    );
    flushSync(() => root.render(null));
    resolve("Ready");
    await waitForHostTurns();

    expect(changes).toEqual([]);
  });

  it("preserves child state when keyed resource metadata changes", () => {
    const { createRoot, flushSync } = createRenderer(host);
    const container = new TestElement("root");
    const root = createRoot(container);
    let increment = () => undefined;

    function Counter() {
      const [count, setCount] = useState(0);
      increment = () => {
        setCount((value) => value + 1);
      };
      return createElement("span", null, `Count ${count}`);
    }

    flushSync(() =>
      root.render(
        createElement(
          Assets,
          { key: "document", assets: title("One") },
          createElement(Counter, null),
        ),
      ),
    );
    flushSync(() => increment());

    flushSync(() =>
      root.render(
        createElement(
          Assets,
          {
            key: "document",
            assets: [
              title("Two"),
              meta({ name: "description", content: "Two" }),
            ],
          },
          createElement(Counter, null),
        ),
      ),
    );

    expect(container.textContent).toBe("Count 1");
  });

  it("publishes captured error boundary state to DevTools", () => {
    const commits = collectDevtoolsCommits();
    const { createRoot, flushSync } = createRenderer(host);
    const container = new TestElement("root");
    const root = createRoot(container);

    function Broken(): never {
      throw new Error("boom");
    }

    flushSync(() =>
      root.render(
        createElement(
          ErrorBoundary,
          { fallback: createElement("span", null, "Crashed") },
          createElement(Broken, null),
        ),
      ),
    );

    const boundary = commits.at(-1)?.tree.children[0];
    expect(boundary?.kind).toBe("error-boundary");
    if (boundary?.kind !== "error-boundary") {
      throw new Error("Expected committed error boundary.");
    }
    expect((boundary.capturedError as Error).message).toBe("boom");
    expect(boundary.componentStack).toContain("at Broken");
  });

  it("passes the caught error and info to function fallbacks", () => {
    const { createRoot, flushSync } = createRenderer(host);
    const container = new TestElement("root");
    const root = createRoot(container);
    const stacks: string[] = [];

    function Broken(): never {
      throw new Error("boom");
    }

    const tree = createElement(
      ErrorBoundary,
      {
        fallback: (error, info) => {
          stacks.push(info.componentStack);
          return createElement(
            "span",
            null,
            `Crashed: ${(error as Error).message}`,
          );
        },
      },
      createElement(Broken, null),
    );

    flushSync(() => root.render(tree));
    expect(container.textContent).toBe("Crashed: boom");
    expect(stacks.at(-1)).toContain("at Broken");

    // Sticky fallback: re-renders of the captured boundary still see the
    // error (the beginErrorBoundary path, not just initial capture).
    flushSync(() => root.render(tree));
    expect(container.textContent).toBe("Crashed: boom");
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

  it("throws a hoisted asset support diagnostic when the group is incomplete", () => {
    const { createRoot, flushSync } = createRenderer({
      ...host,
      resolveHoistedInstance: (type) =>
        type === "asset" ? new TestElement(type) : null,
    });
    const container = new TestElement("root");
    const root = createRoot(container);

    expect(() =>
      flushSync(() => root.render(createElement("asset", null))),
    ).toThrow("Hoisted assets are not supported by this renderer.");
  });

  it("resolves hoisted placement only for new host fibers", () => {
    const parents: TestElement[] = [];
    const resolveHoistedInstance = vi.fn(
      (_type: string, _props: Props, parent: TestElement) => {
        parents.push(parent);
        return null;
      },
    );
    const { createRoot, flushSync } = createRenderer({
      ...host,
      resolveHoistedInstance,
    });
    const container = new TestElement("root");
    const root = createRoot(container);

    flushSync(() =>
      root.render(
        createElement(
          "section",
          { version: 1 },
          createElement("span", { version: 1 }),
        ),
      ),
    );

    expect(resolveHoistedInstance).toHaveBeenCalledTimes(2);
    expect(parents[0]).toBe(container);
    expect(parents[1]?.type).toBe("section");

    flushSync(() =>
      root.render(
        createElement(
          "section",
          { version: 2 },
          createElement("span", { version: 2 }),
        ),
      ),
    );

    expect(resolveHoistedInstance).toHaveBeenCalledTimes(2);
  });

  it("lets the hoisted host own canonical text and preserves its owner", () => {
    const owners: object[] = [];
    let genericTextWrites = 0;
    let hoistedUpdates = 0;
    const { createRoot, flushSync } = createRenderer({
      ...host,
      finalizeInitialInstance(instance, props) {
        instance.textContent = String(props.children ?? "");
      },
      setTextContent(instance, text) {
        genericTextWrites += 1;
        instance.textContent = text;
      },
      resolveHoistedInstance(type) {
        return type === "asset" ? new TestElement(type) : null;
      },
      commitHoistedInstance(instance, _props, owner) {
        owners.push(owner);
        return instance;
      },
      updateHoistedInstance(instance, _previousProps, nextProps, owner) {
        owners.push(owner);
        hoistedUpdates += 1;
        instance.textContent = String(nextProps.children ?? "");
        return instance;
      },
      removeHoistedInstance(_instance, owner) {
        owners.push(owner);
      },
    });
    const container = new TestElement("root");
    const root = createRoot(container);

    flushSync(() => root.render(createElement("asset", null, "One")));
    flushSync(() => root.render(createElement("asset", null, "Two")));
    flushSync(() => root.render(null));

    expect(hoistedUpdates).toBe(1);
    // Initial detached construction uses the generic seam; the committed
    // shared instance's update is entirely host-owned.
    expect(genericTextWrites).toBe(1);
    expect(owners).toHaveLength(3);
    expect(owners[1]).toBe(owners[0]);
    expect(owners[2]).toBe(owners[0]);
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
    expect(container.textContent).toBe("");
  });

  it("does not collide numeric explicit keys with implicit index keys", () => {
    const { createRoot, flushSync } = createRenderer(host);
    const container = new TestElement("root");
    const root = createRoot(container);

    flushSync(() =>
      root.render(
        createElement(
          "main",
          null,
          createElement("span", { key: 1 }, "A"),
          createElement("span", null, "B"),
        ),
      ),
    );

    expect(container.textContent).toBe("AB");

    flushSync(() =>
      root.render(
        createElement("main", null, createElement("span", null, "B")),
      ),
    );

    expect(container.textContent).toBe("B");
    expect((container.childNodes[0] as TestElement).childNodes).toHaveLength(1);
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

  it("commits flat sibling lists without overflowing the commit stack", () => {
    const { createRoot, flushSync } = createRenderer(host);
    const container = new TestElement("root");
    const root = createRoot(container);
    const itemCount = 12_000;
    const items = Array.from({ length: itemCount }, (_item, index) => index);

    function App({ version }: { version: number }) {
      return createElement(
        "main",
        null,
        items.map((item) =>
          createElement("span", { key: item }, `${version}:${item}`),
        ),
      );
    }

    flushSync(() => root.render(createElement(App, { version: 1 })));
    flushSync(() => root.render(createElement(App, { version: 2 })));

    const main = container.childNodes[0] as TestElement;
    expect(main.childNodes).toHaveLength(itemCount);
  });

  it("reschedules remaining lanes after a root-level suspension", async () => {
    const suspended = deferred<string>();
    const { createRoot, flushSync } = createRenderer(host);
    const container = new TestElement("root");
    const root = createRoot(container);
    const controls: {
      setValue: ((value: string) => void) | null;
      start: StartTransition | null;
      suspend: ((value: Promise<string>) => void) | null;
    } = {
      setValue: null,
      start: null,
      suspend: null,
    };

    function MaybeSuspend({ value }: { value: Promise<string> | null }) {
      if (value !== null) readPromise(value);
      return null;
    }

    function App() {
      const [value, set] = useState("A");
      const [promise, setPromise] = useState<Promise<string> | null>(null);
      const [isPending, startTransition] = useTransition();
      const deferred = useDeferredValue(value);
      controls.setValue = set;
      controls.suspend = setPromise;
      controls.start = startTransition;

      return createElement(
        "main",
        null,
        isPending ? "Pending " : "Idle ",
        deferred,
        createElement(MaybeSuspend, { value: promise }),
      );
    }

    flushSync(() => root.render(createElement(App, null)));
    expect(container.textContent).toBe("Idle A");

    flushSync(() => controls.setValue?.("B"));
    expect(container.textContent).toBe("Idle A");

    const startTransition = controls.start;
    const suspendWith = controls.suspend;
    if (startTransition === null || suspendWith === null) {
      throw new Error("Expected transition controls to be captured.");
    }
    startTransition(() => suspendWith(suspended.promise));
    await waitForHostTurns();

    expect(container.textContent).toBe("Pending B");
  });

  it("reschedules remaining lanes after preserving a committed Suspense boundary", async () => {
    const suspended = deferred<string>();
    const { createRoot, flushSync } = createRenderer(host);
    const container = new TestElement("root");
    const root = createRoot(container);
    const controls: {
      setValue: ((value: string) => void) | null;
      start: StartTransition | null;
      suspend: ((value: Promise<string>) => void) | null;
    } = {
      setValue: null,
      start: null,
      suspend: null,
    };

    function MaybeSuspend({ value }: { value: Promise<string> | null }) {
      if (value !== null) readPromise(value);
      return createElement("span", null, "Ready");
    }

    function App() {
      const [value, set] = useState("A");
      const [promise, setPromise] = useState<Promise<string> | null>(null);
      const [isPending, startTransition] = useTransition();
      const deferred = useDeferredValue(value);
      controls.setValue = set;
      controls.suspend = setPromise;
      controls.start = startTransition;

      return createElement(
        "main",
        null,
        isPending ? "Pending " : "Idle ",
        deferred,
        createElement(
          Suspense,
          { fallback: createElement("span", null, "Loading") },
          createElement(MaybeSuspend, { value: promise }),
        ),
      );
    }

    flushSync(() => root.render(createElement(App, null)));
    expect(container.textContent).toBe("Idle AReady");

    flushSync(() => controls.setValue?.("B"));
    expect(container.textContent).toBe("Idle AReady");

    const startTransition = controls.start;
    const suspendWith = controls.suspend;
    if (startTransition === null || suspendWith === null) {
      throw new Error("Expected transition controls to be captured.");
    }
    startTransition(() => suspendWith(suspended.promise));
    await waitForHostTurns();

    expect(container.textContent).toBe("Pending BReady");
  });

  it("flushes useBeforePaint state updates before flushSync returns", () => {
    const { createRoot, flushSync } = createRenderer(host);
    const container = new TestElement("root");
    const root = createRoot(container);

    function App() {
      const [value, setValue] = useState(0);
      useBeforePaint(() => {
        if (value === 0) setValue(1);
      }, [value]);
      return createElement("span", null, value);
    }

    flushSync(() => root.render(createElement(App, null)));

    expect(container.textContent).toBe("1");
  });

  it("runs commit effects for sparse leaf updates under stable siblings", () => {
    const { createRoot, flushSync } = createRenderer(host);
    const container = new TestElement("root");
    const root = createRoot(container);
    const effectRuns: number[] = [];
    let increment: (() => void) | null = null;

    function Leaf() {
      const [count, setCount] = useState(0);
      increment = () => setCount((value) => value + 1);
      useBeforeLayout(() => {
        effectRuns.push(count);
      }, [count]);
      return createElement("span", null, count);
    }

    const stableTree = createElement(
      "main",
      null,
      ...Array.from({ length: 50 }, (_, index) =>
        createElement("span", { key: `before-${index}` }, "stable"),
      ),
      createElement("section", null, createElement(Leaf, null)),
      ...Array.from({ length: 50 }, (_, index) =>
        createElement("span", { key: `after-${index}` }, "stable"),
      ),
    );

    flushSync(() => root.render(stableTree));
    expect(effectRuns.length).toBeGreaterThan(0);
    expect(effectRuns.every((value) => value === 0)).toBe(true);

    effectRuns.length = 0;
    flushSync(() => increment?.());

    expect(effectRuns).toEqual([1]);
  });

  it("throws when post-commit sync updates exceed the nested update limit", () => {
    const { createRoot, flushSync } = createRenderer(host);
    const container = new TestElement("root");
    const root = createRoot(container);

    function App() {
      const [value, setValue] = useState(0);
      useBeforePaint(() => {
        setValue((current) => current + 1);
      });
      return createElement("span", null, value);
    }

    expect(() =>
      flushSync(() => root.render(createElement(App, null))),
    ).toThrow("Maximum update depth exceeded.");
  });

  it("flushes pending reactive effects before a useBeforePaint update re-renders", async () => {
    const { createRoot, flushSync } = createRenderer(host);
    const container = new TestElement("root");
    const root = createRoot(container);
    const calls: string[] = [];

    function App() {
      const [value, setValue] = useState(0);
      useBeforePaint(() => {
        if (value === 0) setValue(1);
      }, [value]);
      useReactive(() => {
        calls.push(`reactive:${value}`);
      }, [value]);
      return createElement("span", null, value);
    }

    flushSync(() => root.render(createElement(App, null)));

    expect(container.textContent).toBe("1");
    expect(calls).toEqual(["reactive:0", "reactive:0"]);

    await waitForHostTurns();
    expect(calls).toEqual(["reactive:0", "reactive:0", "reactive:1"]);
  });

  it("defers re-entrant flushSync from useBeforePaint until the active commit finishes", () => {
    const { createRoot, flushSync } = createRenderer(host);
    const container = new TestElement("root");
    const root = createRoot(container);

    function App() {
      const [value, setValue] = useState(0);
      useBeforePaint(() => {
        if (value === 0) {
          flushSync(() => setValue(1));
        }
      }, [value]);
      return createElement("span", null, value);
    }

    expect(() =>
      flushSync(() => root.render(createElement(App, null))),
    ).not.toThrow();
    expect(container.textContent).toBe("1");
  });

  it("updates stable event handlers after walking past an adopted subtree", () => {
    const { createRoot, flushSync } = createRenderer(host);
    const container = new TestElement("root");
    const root = createRoot(container);
    let setValue: ((value: string) => void) | null = null;
    let readValue: (() => string) | null = null;

    function CleanSubtree() {
      return createElement(
        "section",
        null,
        createElement("span", null, "clean"),
      );
    }

    function EventOwner() {
      const [value, set] = useState("initial");
      setValue = set;
      readValue = useStableEvent(() => value);
      return createElement("span", null, value);
    }

    function App() {
      return createElement(
        "main",
        null,
        createElement(CleanSubtree, null),
        createElement(EventOwner, null),
      );
    }

    function requireReadValue(): () => string {
      if (readValue === null) {
        throw new Error("Expected stable event handler to be captured.");
      }
      return readValue;
    }

    flushSync(() => root.render(createElement(App, null)));
    expect(requireReadValue()()).toBe("initial");

    flushSync(() => setValue?.("updated"));

    expect(container.textContent).toBe("cleanupdated");
    expect(requireReadValue()()).toBe("updated");
  });

  it("keeps stable events disabled while hidden and re-enables them on reveal", () => {
    const { createRoot, flushSync } = createRenderer(host);
    const container = new TestElement("root");
    const root = createRoot(container);
    let readSignal: (() => boolean) | null = null;

    function EventOwner() {
      readSignal = useStableEvent((signal: AbortSignal) => signal.aborted);
      return createElement("span", null, "owner");
    }

    function App({ mode }: { mode: "hidden" | "visible" }) {
      return createElement(
        Activity,
        { mode },
        createElement("section", null, createElement(EventOwner, null)),
      );
    }

    function requireReadSignal(): () => boolean {
      if (readSignal === null) {
        throw new Error("Expected stable event handler to be captured.");
      }
      return readSignal;
    }

    flushSync(() => root.render(createElement(App, { mode: "hidden" })));
    expect(requireReadSignal()()).toBe(true);

    flushSync(() => root.render(createElement(App, { mode: "visible" })));
    expect(container.textContent).toBe("owner");
    expect(requireReadSignal()()).toBe(false);
  });

  it("defers external store subscriptions while hidden and subscribes on reveal", () => {
    const { createRoot, flushSync } = createRenderer(host);
    const container = new TestElement("root");
    const root = createRoot(container);
    let subscribeCalls = 0;
    let unsubscribeCalls = 0;
    let value = "initial";
    let notify: () => void = () => {
      throw new Error("Expected store subscription.");
    };
    const subscribe = (callback: () => void) => {
      subscribeCalls += 1;
      notify = callback;
      return () => {
        unsubscribeCalls += 1;
        notify = () => {
          throw new Error("Expected store subscription.");
        };
      };
    };

    function StoreReader() {
      const snapshot = useSyncExternalStore(subscribe, () => value);
      return createElement("span", null, snapshot);
    }

    function App({ mode, tick }: { mode: "hidden" | "visible"; tick: number }) {
      return createElement(
        "main",
        null,
        createElement(Activity, { mode }, createElement(StoreReader, null)),
        createElement("span", null, tick),
      );
    }

    flushSync(() =>
      root.render(createElement(App, { mode: "hidden", tick: 0 })),
    );
    expect(subscribeCalls).toBe(0);

    flushSync(() =>
      root.render(createElement(App, { mode: "visible", tick: 0 })),
    );
    expect(container.textContent).toBe("initial0");
    expect(subscribeCalls).toBe(1);

    flushSync(() =>
      root.render(createElement(App, { mode: "visible", tick: 1 })),
    );
    expect(subscribeCalls).toBe(1);
    expect(unsubscribeCalls).toBe(0);

    value = "updated";
    notify();
    flushSync(() => undefined);
    expect(container.textContent).toBe("updated1");
  });

  it("does not poll external stores in adopted subtrees during unrelated commits", () => {
    const { createRoot, flushSync } = createRenderer(host);
    const container = new TestElement("root");
    const root = createRoot(container);
    const listeners = new Set<() => void>();
    let snapshotReads = 0;
    let update: (() => void) | null = null;

    const subscribe = (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    };
    const getSnapshot = () => {
      snapshotReads += 1;
      return "store";
    };

    function StoreConsumer() {
      const snapshot = useSyncExternalStore(subscribe, getSnapshot);
      return createElement("span", null, snapshot);
    }

    function Ticker() {
      const [count, setCount] = useState(0);
      update = () => setCount((value) => value + 1);
      return createElement("b", null, count);
    }

    const stableStoreSubtree = createElement(
      "section",
      null,
      Array.from({ length: 5 }, (_, index) =>
        createElement(StoreConsumer, { key: index }),
      ),
    );

    function App() {
      return createElement(
        "main",
        null,
        stableStoreSubtree,
        createElement(Ticker),
      );
    }

    flushSync(() => root.render(createElement(App, null)));
    expect(listeners.size).toBe(5);
    expect(container.textContent).toBe("storestorestorestorestore0");

    snapshotReads = 0;
    flushSync(() => update?.());

    expect(container.textContent).toBe("storestorestorestorestore1");
    expect(snapshotReads).toBe(0);
  });

  it("unwinds context providers from suspended branches before rendering later siblings", () => {
    const Theme = createContext("default");
    const pending = deferred<string>();
    const { createRoot, flushSync } = createRenderer(host);
    const container = new TestElement("root");
    const root = createRoot(container);
    const reads: string[] = [];

    function InnerProvider() {
      return createElement(
        Theme,
        { value: "inner" },
        createElement(SuspendingReader, null),
      );
    }

    function SuspendingReader() {
      reads.push(readContext(Theme));
      readPromise(pending.promise);
      return createElement("span", null, "inner");
    }

    function SiblingReader() {
      const value = readContext(Theme);
      reads.push(value);
      return createElement("span", null, value);
    }

    function App() {
      return createElement(
        Theme,
        { value: "outer" },
        createElement(
          Suspense,
          { fallback: createElement("em", null, "Loading") },
          createElement(InnerProvider, null),
        ),
        createElement(SiblingReader, null),
      );
    }

    flushSync(() => root.render(createElement(App, null)));

    expect(reads[0]).toBe("inner");
    expect(reads.slice(1)).toEqual(reads.slice(1).map(() => "outer"));
    expect(container.textContent).toBe("Loadingouter");
  });

  it("keeps stable provider context available while rendering child updates", () => {
    const Theme = createContext("default");
    const { createRoot, flushSync } = createRenderer(host);
    const container = new TestElement("root");
    const root = createRoot(container);
    let increment: (() => void) | null = null;

    function Consumer() {
      const theme = readContext(Theme);
      const [count, setCount] = useState(0);
      increment = () => setCount((value) => value + 1);
      return createElement("span", null, `${theme}:${count}`);
    }

    const stableChild = createElement("section", null, createElement(Consumer));
    const tree = createElement(Theme, { value: "provided" }, stableChild);

    flushSync(() => root.render(tree));
    expect(container.textContent).toBe("provided:0");

    flushSync(() => increment?.());
    expect(container.textContent).toBe("provided:1");
  });

  it("updates consumers when provider values change", () => {
    const Theme = createContext("default");
    const { createRoot, flushSync } = createRenderer(host);
    const container = new TestElement("root");
    const root = createRoot(container);

    function Consumer() {
      return createElement("span", null, readContext(Theme));
    }

    function App({ value }: { value: string }) {
      return createElement(
        Theme,
        { value },
        createElement("section", null, createElement(Consumer)),
      );
    }

    flushSync(() => root.render(createElement(App, { value: "first" })));
    expect(container.textContent).toBe("first");

    flushSync(() => root.render(createElement(App, { value: "second" })));
    expect(container.textContent).toBe("second");
  });

  it("checks context dependencies before bailing out visited consumers", () => {
    const Theme = createContext("default");
    const { createRoot, flushSync } = createRenderer(host);
    const container = new TestElement("root");
    const root = createRoot(container);
    let bump: (() => void) | null = null;
    let consumerRenders = 0;

    function Consumer() {
      consumerRenders += 1;
      return createElement("span", null, readContext(Theme));
    }

    function Ticker() {
      const [count, setCount] = useState(0);
      bump = () => setCount((value) => value + 1);
      return createElement("b", null, count);
    }

    const tree = createElement(
      Theme,
      { value: "first" },
      createElement(Consumer),
      createElement(Ticker),
    );

    flushSync(() => root.render(tree));
    expect(container.textContent).toBe("first0");
    expect(consumerRenders).toBe(2);

    // Keep provider props identity stable so only the context dependency check
    // prevents the visited consumer from taking the early bailout.
    tree.props.value = "second";
    flushSync(() => bump?.());

    expect(container.textContent).toBe("second1");
    expect(consumerRenders).toBe(4);
  });

  it("lazily propagates provider changes into bailed-out subtrees", () => {
    const Theme = createContext("default");
    const { createRoot, flushSync } = createRenderer(host);
    const container = new TestElement("root");
    const root = createRoot(container);
    let wrapperRenders = 0;

    function Consumer() {
      return createElement("span", null, readContext(Theme));
    }

    function Wrapper() {
      wrapperRenders += 1;
      return createElement("div", null, createElement(Consumer));
    }

    // Hoisted so the wrapper keeps props identity across renders: with no own
    // work and clean childLanes it is a whole-subtree bailout candidate, and
    // only lazy propagation at the skip point can reach the consumer inside.
    const wrapped = createElement(Wrapper);

    function App({ value }: { value: string }) {
      return createElement(Theme, { value }, wrapped);
    }

    flushSync(() => root.render(createElement(App, { value: "first" })));
    expect(container.textContent).toBe("first");
    expect(wrapperRenders).toBe(2);

    flushSync(() => root.render(createElement(App, { value: "second" })));
    expect(container.textContent).toBe("second");
    // The wrapper bailed out; only the consumer below it re-rendered.
    expect(wrapperRenders).toBe(2);
  });

  it("throws a diagnostic for state updates scheduled from useBeforeLayout effects", () => {
    const { createRoot, flushSync } = createRenderer(host);
    const container = new TestElement("root");
    const root = createRoot(container);

    function App() {
      const [value, setValue] = useState("initial");
      useBeforeLayout(() => {
        setValue("measured");
      }, []);
      return createElement("span", null, value);
    }

    expect(() =>
      flushSync(() => root.render(createElement(App, null))),
    ).toThrow("State updates are not allowed from useBeforeLayout effects.");
  });

  it("keeps same-lane updates dispatched while a time-sliced render is yielded", async () => {
    const { createRoot, flushSync } = createRenderer(host);
    const container = new TestElement("root");
    const root = createRoot(container);
    let setCount: ((updater: (count: number) => number) => void) | null = null;
    let yieldThenUpdate = false;

    function Counter() {
      const [count, set] = useState(0);
      setCount = set;
      return createElement("span", null, "count:", count);
    }

    function Yielding() {
      if (yieldThenUpdate) {
        yieldThenUpdate = false;
        requestPaint();
        queueMicrotask(() => {
          // The counter fiber already rendered in this pass, and this update
          // shares its lane with the yielded render — it must survive the
          // commit of that in-flight pass.
          setCount?.((count) => count + 1);
        });
      }

      return null;
    }

    function App({ label }: { label: string }) {
      return createElement(
        "main",
        null,
        createElement(Counter, null),
        createElement(Yielding, null),
        createElement("span", null, label),
      );
    }

    flushSync(() => root.render(createElement(App, { label: "first" })));
    expect(container.textContent).toBe("count:0first");

    yieldThenUpdate = true;
    root.render(createElement(App, { label: "second" }));

    await expect.poll(() => container.textContent).toBe("count:1second");
  });

  it("routes uncaught reactive effect errors to onUncaughtError and clears the root", async () => {
    const { createRoot, flushSync } = createRenderer(host);
    const container = new TestElement("root");
    const uncaught: Array<{ error: unknown; stack: string }> = [];
    const root = createRoot(container, {
      onUncaughtError(error, info) {
        uncaught.push({ error, stack: info.componentStack });
      },
    });

    function Broken() {
      useReactive(() => {
        throw new Error("reactive boom");
      }, []);
      return createElement("span", null, "Primary");
    }

    flushSync(() => root.render(createElement(Broken, null)));
    expect(container.textContent).toBe("Primary");

    await waitForHostTurns();

    expect(uncaught.map((report) => (report.error as Error).message)).toEqual([
      "reactive boom",
    ]);
    expect(uncaught[0]?.stack).toContain("at Broken");
    expect(container.textContent).toBe("");

    // The scheduler tick must survive the failure: later work still runs.
    flushSync(() => root.render(createElement("span", null, "Recovered")));
    expect(container.textContent).toBe("Recovered");
  });

  it("releases data owners for every root child after an uncaught error", () => {
    const { createRoot, flushSync } = createRenderer(host);
    const container = new TestElement("root");
    const errors: unknown[] = [];
    const root = createRoot(container, {
      onUncaughtError(error) {
        errors.push(error);
      },
    });
    const firstResource = dataResource({
      key: (id: string) => ["uncaught-root-first", id],
      load: (id: string) => `first-${id}`,
    });
    const secondResource = dataResource({
      key: (id: string) => ["uncaught-root-second", id],
      load: (id: string) => `second-${id}`,
    });

    function Reader({
      id,
      resource,
    }: {
      id: string;
      resource: typeof firstResource;
    }) {
      return createElement("span", null, readData(resource, id));
    }

    function Broken(_props: { key?: string }): never {
      throw new Error("root failed");
    }

    flushSync(() =>
      root.render([
        createElement(Reader, {
          id: "one",
          key: "first",
          resource: firstResource,
        }),
        createElement(Reader, {
          id: "one",
          key: "second",
          resource: secondResource,
        }),
      ]),
    );
    expect(dataSubscriberCounts(root.data)).toEqual([1, 1]);

    expect(() =>
      flushSync(() =>
        root.render([
          createElement(Reader, {
            id: "one",
            key: "first",
            resource: firstResource,
          }),
          createElement(Broken, { key: "broken" }),
        ]),
      ),
    ).toThrow("root failed");

    expect(errors).toHaveLength(1);
    expect(container.textContent).toBe("");
    expect(dataSubscriberCounts(root.data)).toEqual([0, 0]);
  });

  it("routes standalone reactive effect errors to ancestor error boundaries", async () => {
    const { createRoot, flushSync } = createRenderer(host);
    const container = new TestElement("root");
    const reports: string[] = [];
    const root = createRoot(container);

    function Broken() {
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
            onError(error: unknown) {
              reports.push((error as Error).message);
            },
          },
          createElement(Broken, null),
        ),
      ),
    );
    expect(container.textContent).toBe("Primary");

    await waitForHostTurns();

    expect(container.textContent).toBe("Crashed");
    expect(reports).toEqual(["reactive failed"]);
  });

  it("restarts yielded work when flushSync schedules higher-priority work", async () => {
    const { createRoot, flushSync } = createRenderer(host);
    const container = new TestElement("root");
    const root = createRoot(container);
    let setCount: ((updater: (count: number) => number) => void) | null = null;
    let yieldThenFlush = false;
    let textAfterFlush = "";
    let resolveFlushed: () => void = () => undefined;
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
