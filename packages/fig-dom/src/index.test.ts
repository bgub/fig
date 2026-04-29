import {
  createContext,
  createElement,
  type FigNode,
  Fragment,
  type Props,
  readContext,
  readPromise,
  Suspense,
  transition,
  useBeforeLayout,
  useBeforePaint,
  useOnMount,
  useReactive,
  useState,
} from "@bgub/fig";
import { requestUpdateLane } from "@bgub/fig-reconciler";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type Bind,
  batchedUpdates,
  createRoot,
  DefaultLane,
  flushSync,
  InputContinuousLane,
  on,
  render,
  runWithPriority,
  SyncLane,
} from "./index.ts";

class FakeText {
  parentNode: FakeElement | null = null;

  constructor(public nodeValue: string) {}

  get textContent(): string {
    return this.nodeValue;
  }
}

interface FakeListener {
  capture: boolean;
  listener: EventListener;
}

const nonBubblingEvents = new Set([
  "blur",
  "focus",
  "mouseenter",
  "mouseleave",
  "scroll",
]);

class FakeElement {
  childNodes: Array<FakeElement | FakeText> = [];
  attributes: Record<string, string> = {};
  listenerSets: Record<string, FakeListener[]> = {};
  listeners: Record<string, EventListener> = {};
  parentNode: FakeElement | null = null;
  style: Record<string, string> = {};

  constructor(public tagName: string) {}

  appendChild(node: FakeElement | FakeText): FakeElement | FakeText {
    node.parentNode?.removeChild(node);
    this.childNodes.push(node);
    node.parentNode = this;
    return node;
  }

  insertBefore(
    node: FakeElement | FakeText,
    child: FakeElement | FakeText | null,
  ): FakeElement | FakeText {
    if (child === null) {
      return this.appendChild(node);
    }

    node.parentNode?.removeChild(node);
    const index = this.childNodes.indexOf(child);

    if (index === -1) {
      this.childNodes.push(node);
    } else {
      this.childNodes.splice(index, 0, node);
    }

    node.parentNode = this;
    return node;
  }

  removeChild(node: FakeElement | FakeText): FakeElement | FakeText {
    const index = this.childNodes.indexOf(node);

    if (index !== -1) {
      this.childNodes.splice(index, 1);
    }

    node.parentNode = null;
    return node;
  }

  setAttribute(name: string, value: string): void {
    this.attributes[name] = value;
  }

  removeAttribute(name: string): void {
    delete this.attributes[name];
  }

  addEventListener(
    name: string,
    listener: EventListener,
    options?: AddEventListenerOptions | boolean,
  ): void {
    this.listenerSets[name] ??= [];
    this.listenerSets[name].push({
      capture: captureOption(options),
      listener,
    });
    this.listeners[name] = (event) => {
      for (const current of this.listenerSets[name] ?? []) {
        current.listener(event);
      }
    };
  }

  removeEventListener(
    name: string,
    listener: EventListener,
    options?: AddEventListenerOptions | boolean,
  ): void {
    const listeners = this.listenerSets[name];
    if (listeners === undefined) return;

    this.listenerSets[name] = listeners.filter(
      (current) =>
        current.listener !== listener ||
        current.capture !== captureOption(options),
    );
    if (this.listenerSets[name].length === 0) {
      delete this.listenerSets[name];
      delete this.listeners[name];
    }
  }

  dispatch(name: string): void {
    const path: FakeElement[] = [];
    for (
      let element: FakeElement | null = this;
      element !== null;
      element = element.parentNode
    ) {
      path.push(element);
    }

    const event = {
      cancelBubble: false,
      composedPath: () => path,
      target: this,
      type: name,
      stopPropagation() {
        this.cancelBubble = true;
      },
    } as Event;

    for (const element of path.toReversed()) {
      element.invoke(name, event, true);
      if (event.cancelBubble) return;
    }

    for (const element of path) {
      element.invoke(name, event, false);
      if (event.cancelBubble || nonBubblingEvents.has(name)) return;
    }
  }

  invoke(name: string, event: Event, capture: boolean): void {
    for (const current of this.listenerSets[name] ?? []) {
      if (current.capture === capture) current.listener(event);
    }
  }

  get textContent(): string {
    return this.childNodes.map((child) => child.textContent).join("");
  }
}

function captureOption(options?: AddEventListenerOptions | boolean): boolean {
  return typeof options === "boolean" ? options : options?.capture === true;
}

const delay = () => new Promise((resolve) => setTimeout(resolve, 20));
const documentValue = globalThis.document;

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (reason?: unknown) => void = () => undefined;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, reject, resolve };
}

function expectHookDiagnostic<P extends Props>(
  Component: (props: P & { children?: FigNode }) => FigNode,
  initialProps: P,
  nextProps: P,
  message: string,
): void {
  const container = new FakeElement("root");
  const root = createRoot(container as unknown as Element);

  flushSync(() => root.render(createElement(Component, initialProps)));

  expect(() => {
    flushSync(() => root.render(createElement(Component, nextProps)));
  }).toThrow(message);

  expect(container.textContent).toBe("Stable");

  flushSync(() => root.render(createElement("main", null, "Recovered")));
}

function expectRenderDiagnostic(node: FigNode, message: string): void {
  const container = new FakeElement("root");
  const root = createRoot(container as unknown as Element);

  flushSync(() => root.render(createElement("main", null, "Stable")));

  expect(() => {
    flushSync(() => root.render(node));
  }).toThrow(message);

  expect(container.textContent).toBe("Stable");

  flushSync(() => root.render(createElement("main", null, "Recovered")));
  expect(container.textContent).toBe("Recovered");
}

describe("@bgub/fig-dom", () => {
  beforeEach(() => {
    globalThis.document = {
      createElement: (tagName: string) => new FakeElement(tagName),
      createTextNode: (value: string) => new FakeText(value),
    } as unknown as Document;
  });

  afterEach(() => {
    globalThis.document = documentValue;
  });

  it("renders and updates host elements", async () => {
    const container = new FakeElement("root");

    render(
      createElement("div", { id: "first", className: "box" }, "Hello"),
      container as unknown as Element,
    );
    await delay();

    expect(container.textContent).toBe("Hello");
    expect(container.childNodes).toHaveLength(1);
    expect((container.childNodes[0] as FakeElement).attributes).toEqual({
      class: "box",
      id: "first",
    });

    render(
      createElement("div", { id: "second" }, "Goodbye"),
      container as unknown as Element,
    );
    await delay();

    expect(container.textContent).toBe("Goodbye");
    expect(container.childNodes).toHaveLength(1);
    expect((container.childNodes[0] as FakeElement).attributes).toEqual({
      id: "second",
    });
  });

  it("runs lazy state initializers only on mount", () => {
    let setCount: ((updater: (count: number) => number) => void) | null = null;
    let initializers = 0;

    function Counter() {
      const [count, set] = useState(() => {
        initializers += 1;
        return 0;
      });
      setCount = set;
      return createElement("button", null, "Count: ", count);
    }

    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);

    flushSync(() => root.render(createElement(Counter, null)));
    flushSync(() => setCount?.((count) => count + 1));

    expect(container.textContent).toBe("Count: 1");
    expect(initializers).toBe(1);
  });

  it("keeps state dispatches working across alternate tree swaps", () => {
    let setCount: ((updater: (count: number) => number) => void) | null = null;

    function Counter() {
      const [count, set] = useState(0);
      setCount = set;
      return createElement("span", null, count);
    }

    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);

    flushSync(() => root.render(createElement(Counter, null)));

    for (let expected = 1; expected <= 4; expected += 1) {
      flushSync(() => setCount?.((count) => count + 1));
      expect(container.textContent).toBe(String(expected));
    }
  });

  it("supports root unmounts", async () => {
    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);

    root.render(createElement("main", null, "Mounted"));
    await delay();
    expect(container.textContent).toBe("Mounted");

    root.unmount();
    await delay();
    expect(container.textContent).toBe("");
  });

  it("flushes sync work before returning", () => {
    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);

    flushSync(() => root.render(createElement("main", null, "Now")));

    expect(container.textContent).toBe("Now");
  });

  it("flushes batched root work inside flushSync", () => {
    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);

    flushSync(() => root.render(createElement("main", null, "Before")));

    batchedUpdates(() => {
      root.render(createElement("main", null, "After"));
      expect(container.textContent).toBe("Before");

      flushSync(() => undefined);

      expect(container.textContent).toBe("After");
    });
  });

  it("abandons failed render work and recovers on later renders", () => {
    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);

    function Broken() {
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

    expect(container.textContent).toBe("Stable");

    flushSync(() => root.render(createElement(Recovered, null)));

    expect(container.textContent).toBe("Recovered");
  });

  it("preserves pending state updates when render work is abandoned", () => {
    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);
    let setCount: ((updater: (count: number) => number) => void) | null = null;

    function Counter() {
      const [count, set] = useState(0);
      setCount = set;
      return createElement("span", null, count);
    }

    function Broken() {
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

    expect(container.textContent).toBe("0");

    flushSync(() => root.render(createElement(App, { fail: false })));

    expect(container.textContent).toBe("1");
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

    expect(container.textContent).toBe("Committed");

    flushSync(() => root.render(createElement(App, { value: "Recovered" })));

    expect(container.textContent).toBe("Recovered");
  });

  it("throws on duplicate sibling keys without committing failed work", () => {
    expectRenderDiagnostic(
      createElement(
        "ul",
        null,
        createElement("li", { key: "same" }, "A"),
        createElement("li", { key: "same" }, "B"),
      ),
      'Duplicate key "same" found among siblings.',
    );
  });

  it("throws on invalid children without committing failed work", () => {
    function Broken() {
      return { nope: true } as unknown as FigNode;
    }

    expectRenderDiagnostic(
      createElement(Broken, null),
      "Invalid Fig child: object with keys nope.",
    );
  });

  it("throws on render-phase state updates without committing failed work", () => {
    function Broken() {
      const [, setValue] = useState(0);
      setValue(1);
      return createElement("main", null, "Broken");
    }

    expectRenderDiagnostic(
      createElement(Broken, null),
      "State updates are not allowed while rendering a component.",
    );
  });

  it("throws when components render fewer hooks", () => {
    function App({ skip }: { skip?: boolean }) {
      useState("first");
      if (!skip) useState("second");
      return createElement("main", null, "Stable");
    }

    expectHookDiagnostic(
      App,
      { skip: false },
      { skip: true },
      "Rendered fewer hooks than during the previous render.",
    );
  });

  it("throws when components render more hooks", () => {
    function App({ extra }: { extra?: boolean }) {
      if (extra) useState("first");
      return createElement("main", null, "Stable");
    }

    expectHookDiagnostic(
      App,
      { extra: false },
      { extra: true },
      "Rendered more hooks than during the previous render.",
    );
  });

  it("throws when hook order changes", () => {
    function App({ effect }: { effect?: boolean }) {
      if (effect) useReactive(() => undefined, []);
      else useState("first");
      return createElement("main", null, "Stable");
    }

    expectHookDiagnostic(
      App,
      { effect: false },
      { effect: true },
      "Hook order changed: expected state, received reactive.",
    );
  });

  it("reads context defaults and nearest providers", () => {
    const Theme = createContext("default");

    function Label() {
      return createElement("span", null, readContext(Theme));
    }

    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);

    flushSync(() => root.render(createElement(Label, null)));
    expect(container.textContent).toBe("default");

    flushSync(() =>
      root.render(
        createElement(
          Theme,
          { value: "outer" },
          createElement(Theme, { value: "inner" }, createElement(Label, null)),
        ),
      ),
    );

    expect(container.textContent).toBe("inner");
  });

  it("updates context consumers behind stable children", () => {
    const Theme = createContext("light");
    const child = createElement(Label, null);
    let renders = 0;

    function Label() {
      renders += 1;
      return createElement("span", null, readContext(Theme));
    }

    function App({ value }: { value: string }) {
      return createElement(Theme, { value }, child);
    }

    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);

    flushSync(() => root.render(createElement(App, { value: "dark" })));
    expect(container.textContent).toBe("dark");

    flushSync(() => root.render(createElement(App, { value: "light" })));
    expect(container.textContent).toBe("light");
    expect(renders).toBe(2);
  });

  it("does not rerender stable non-consumers when providers change", () => {
    const Theme = createContext("light");
    const child = createElement(Child, null);
    const label = createElement(Label, null);
    let childRenders = 0;
    let labelRenders = 0;

    function Child() {
      childRenders += 1;
      return createElement("span", null, "Static");
    }

    function Label() {
      labelRenders += 1;
      return createElement("span", null, readContext(Theme));
    }

    function App({ value }: { value: string }) {
      return createElement(Theme, { value }, child, label);
    }

    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);

    flushSync(() => root.render(createElement(App, { value: "dark" })));
    flushSync(() => root.render(createElement(App, { value: "light" })));

    expect(container.textContent).toBe("Staticlight");
    expect(childRenders).toBe(1);
    expect(labelRenders).toBe(2);
  });

  it("does not propagate outer context changes through inner providers", () => {
    const Theme = createContext("outer");
    const inner = createElement(
      Theme,
      { value: "inner" },
      createElement(Label, null),
    );
    let renders = 0;

    function Label() {
      renders += 1;
      return createElement("span", null, readContext(Theme));
    }

    function App({ value }: { value: string }) {
      return createElement(Theme, { value }, inner);
    }

    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);

    flushSync(() => root.render(createElement(App, { value: "first" })));
    flushSync(() => root.render(createElement(App, { value: "second" })));

    expect(container.textContent).toBe("inner");
    expect(renders).toBe(1);
  });

  it("allows context reads inside conditional branches", () => {
    const Theme = createContext("light");

    function Label({ enabled }: { enabled: boolean }) {
      return createElement(
        "span",
        null,
        enabled ? readContext(Theme) : "disabled",
      );
    }

    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);

    flushSync(() =>
      root.render(
        createElement(
          Theme,
          { value: "dark" },
          createElement(Label, { enabled: false }),
        ),
      ),
    );
    expect(container.textContent).toBe("disabled");

    flushSync(() =>
      root.render(
        createElement(
          Theme,
          { value: "dark" },
          createElement(Label, { enabled: true }),
        ),
      ),
    );
    expect(container.textContent).toBe("dark");
  });

  it("suspends on pending promises and retries when they settle", async () => {
    let resolve: (value: string) => void = () => undefined;
    const promise = new Promise<string>((done) => {
      resolve = done;
    });

    function Message({ value }: { value: Promise<string> }) {
      return createElement("span", null, readPromise(value));
    }

    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);

    flushSync(() => root.render(createElement("main", null, "Stable")));
    flushSync(() => root.render(createElement(Message, { value: promise })));

    expect(container.textContent).toBe("Stable");

    resolve("Loaded");
    await delay();

    expect(container.textContent).toBe("Loaded");
  });

  it("renders Suspense fallback while promises are pending", async () => {
    const pending = deferred<string>();

    function Message({ value }: { value: Promise<string> }) {
      return createElement("span", null, readPromise(value));
    }

    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);

    flushSync(() => root.render(createElement("main", null, "Stable")));
    flushSync(() =>
      root.render(
        createElement(
          Suspense,
          { fallback: createElement("span", null, "Loading") },
          createElement(Message, { value: pending.promise }),
        ),
      ),
    );

    expect(container.textContent).toBe("Loading");

    pending.resolve("Loaded");
    await delay();

    expect(container.textContent).toBe("Loaded");
  });

  it("keeps revealed Suspense content visible while transitions suspend", async () => {
    const pending = deferred<string>();
    let setValue: ((value: Promise<string> | null) => void) | null = null;

    function Message({ value }: { value: Promise<string> | null }) {
      return createElement(
        "span",
        null,
        value === null ? "Ready" : readPromise(value),
      );
    }

    function App() {
      const [value, set] = useState<Promise<string> | null>(null);
      setValue = set;

      return createElement(
        Suspense,
        { fallback: createElement("span", null, "Loading") },
        createElement(Message, { value }),
      );
    }

    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);

    flushSync(() => root.render(createElement(App, null)));
    expect(container.textContent).toBe("Ready");

    transition(() => {
      setValue?.(pending.promise);
    });
    await delay();

    expect(container.textContent).toBe("Ready");

    pending.resolve("Loaded");
    await delay();

    expect(container.textContent).toBe("Loaded");
  });

  it("renders Suspense fallback for initial transition suspension", async () => {
    const pending = deferred<string>();

    function Message() {
      return createElement("span", null, readPromise(pending.promise));
    }

    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);

    transition(() => {
      root.render(
        createElement(
          Suspense,
          { fallback: createElement("span", null, "Loading") },
          createElement(Message, null),
        ),
      );
    });
    await delay();

    expect(container.textContent).toBe("Loading");

    pending.resolve("Loaded");
    await delay();

    expect(container.textContent).toBe("Loaded");
  });

  it("uses the nearest Suspense boundary", async () => {
    const pending = deferred<string>();

    function Message() {
      return createElement("span", null, readPromise(pending.promise));
    }

    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);

    flushSync(() =>
      root.render(
        createElement(
          Suspense,
          { fallback: createElement("span", null, "Outer") },
          createElement("span", null, "Header"),
          createElement(
            Suspense,
            { fallback: createElement("span", null, "Inner") },
            createElement(Message, null),
          ),
          createElement("span", null, "Footer"),
        ),
      ),
    );

    expect(container.textContent).toBe("HeaderInnerFooter");

    pending.resolve("Message");
    await delay();

    expect(container.textContent).toBe("HeaderMessageFooter");
  });

  it("bubbles fallback suspension to an outer Suspense boundary", async () => {
    const primary = deferred<string>();
    const fallback = deferred<string>();

    function PrimaryMessage() {
      return createElement("span", null, readPromise(primary.promise));
    }

    function FallbackMessage() {
      return createElement("span", null, readPromise(fallback.promise));
    }

    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);

    flushSync(() =>
      root.render(
        createElement(
          Suspense,
          { fallback: createElement("span", null, "Outer") },
          createElement("span", null, "Header"),
          createElement(
            Suspense,
            { fallback: createElement(FallbackMessage, null) },
            createElement(PrimaryMessage, null),
          ),
          createElement("span", null, "Footer"),
        ),
      ),
    );

    expect(container.textContent).toBe("Outer");

    fallback.resolve("Inner fallback");
    await delay();

    expect(container.textContent).toBe("HeaderInner fallbackFooter");

    primary.resolve("Primary");
    await delay();

    expect(container.textContent).toBe("HeaderPrimaryFooter");
  });

  it("keeps showing fallback across multiple promise retries", async () => {
    const first = deferred<string>();
    const second = deferred<string>();

    function Message() {
      const firstValue = readPromise(first.promise);
      const secondValue = readPromise(second.promise);
      return createElement("span", null, firstValue, secondValue);
    }

    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);

    flushSync(() =>
      root.render(
        createElement(
          Suspense,
          { fallback: createElement("span", null, "Loading") },
          createElement(Message, null),
        ),
      ),
    );

    expect(container.textContent).toBe("Loading");

    first.resolve("A");
    await delay();
    expect(container.textContent).toBe("Loading");

    second.resolve("B");
    await delay();
    expect(container.textContent).toBe("AB");
  });

  it("preserves state updates consumed by discarded Suspense primary work", async () => {
    const pending = deferred<string>();
    let setCount: ((updater: (count: number) => number) => void) | null = null;

    function Counter() {
      const [count, set] = useState(0);
      setCount = set;
      return createElement("span", null, count);
    }

    function Message({ value }: { value: Promise<string> | null }) {
      return createElement(
        "span",
        null,
        value === null ? "Ready" : readPromise(value),
      );
    }

    function App({ value }: { value: Promise<string> | null }) {
      return createElement(
        Suspense,
        { fallback: createElement("span", null, "Loading") },
        createElement(Counter, null),
        createElement(Message, { value }),
      );
    }

    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);

    flushSync(() => root.render(createElement(App, { value: null })));
    expect(container.textContent).toBe("0Ready");

    flushSync(() => {
      setCount?.((count) => count + 1);
      root.render(createElement(App, { value: pending.promise }));
    });

    expect(container.textContent).toBe("Loading");

    pending.resolve("Loaded");
    await delay();

    expect(container.textContent).toBe("1Loaded");
  });

  it("does not retry Suspense boundaries after they are unmounted", async () => {
    const pending = deferred<string>();

    function Message() {
      return createElement("span", null, readPromise(pending.promise));
    }

    function App({ show }: { show: boolean }) {
      return createElement(
        "main",
        null,
        show
          ? createElement(
              Suspense,
              { fallback: createElement("span", null, "Loading") },
              createElement(Message, null),
            )
          : createElement("span", null, "Gone"),
      );
    }

    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);

    flushSync(() => root.render(createElement(App, { show: true })));
    expect(container.textContent).toBe("Loading");

    flushSync(() => root.render(createElement(App, { show: false })));
    expect(container.textContent).toBe("Gone");

    pending.resolve("Loaded");
    await delay();

    expect(container.textContent).toBe("Gone");
  });

  it("throws rejected Suspense promises through the existing error path", async () => {
    const pending = deferred<string>();

    function Message() {
      return createElement("span", null, readPromise(pending.promise));
    }

    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);
    const node = createElement(
      Suspense,
      { fallback: createElement("span", null, "Loading") },
      createElement(Message, null),
    );

    flushSync(() => root.render(node));
    expect(container.textContent).toBe("Loading");

    pending.reject(new Error("read failed"));
    await Promise.resolve();

    expect(() => flushSync(() => root.render(node))).toThrow("read failed");
    expect(container.textContent).toBe("Loading");

    flushSync(() => root.render(createElement("main", null, "Recovered")));
    expect(container.textContent).toBe("Recovered");
  });

  it("cleans up effects when Suspense switches between primary and fallback", async () => {
    const pending = deferred<string>();
    const calls: string[] = [];

    function Primary({ value }: { value: Promise<string> | null }) {
      useReactive((signal) => {
        calls.push("primary:run");
        signal.addEventListener("abort", () => calls.push("primary:abort"), {
          once: true,
        });
      }, []);

      return createElement(
        "span",
        null,
        value === null ? "Primary" : readPromise(value),
      );
    }

    function Fallback() {
      useReactive((signal) => {
        calls.push("fallback:run");
        signal.addEventListener("abort", () => calls.push("fallback:abort"), {
          once: true,
        });
      }, []);

      return createElement("span", null, "Loading");
    }

    function App({ value }: { value: Promise<string> | null }) {
      return createElement(
        Suspense,
        { fallback: createElement(Fallback, null) },
        createElement(Primary, { value }),
      );
    }

    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);

    root.render(createElement(App, { value: null }));
    await delay();
    expect(container.textContent).toBe("Primary");
    expect(calls).toEqual(["primary:run"]);

    root.render(createElement(App, { value: pending.promise }));
    await delay();
    expect(container.textContent).toBe("Loading");
    expect(calls).toEqual(["primary:run", "primary:abort", "fallback:run"]);

    pending.resolve("Primary loaded");
    await delay();

    expect(container.textContent).toBe("Primary loaded");
    expect(calls).toEqual([
      "primary:run",
      "primary:abort",
      "fallback:run",
      "fallback:abort",
      "primary:run",
    ]);
  });

  it("batches updates until the outer callback exits", async () => {
    let renders = 0;
    let setCount: ((updater: (count: number) => number) => void) | null = null;

    function Counter() {
      renders += 1;
      const [count, set] = useState(0);
      setCount = set;
      return createElement("span", null, count);
    }

    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);

    flushSync(() => root.render(createElement(Counter, null)));
    expect(renders).toBe(1);

    batchedUpdates(() => {
      setCount?.((count) => count + 1);
      setCount?.((count) => count + 1);
      expect(container.textContent).toBe("0");
    });

    await delay();
    expect(container.textContent).toBe("2");
    expect(renders).toBe(2);
  });

  it("batches updates inside DOM event handlers", async () => {
    let renders = 0;

    function Counter() {
      renders += 1;
      const [count, setCount] = useState(0);
      return createElement(
        "button",
        {
          events: [
            on("click", () => {
              setCount((value) => value + 1);
              setCount((value) => value + 1);
              expect(container.textContent).toBe("0");
            }),
          ],
        },
        count,
      );
    }

    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);

    flushSync(() => root.render(createElement(Counter, null)));

    const button = container.childNodes[0] as FakeElement;
    button.dispatch("click");

    expect(renders).toBe(1);

    await delay();
    expect(container.textContent).toBe("2");
    expect(renders).toBe(2);
  });

  it("binds host nodes through normal component props", () => {
    const calls: string[] = [];
    const signals: AbortSignal[] = [];
    const container = new FakeElement("root");

    function TextField({ bind }: { bind?: Bind<HTMLInputElement> }) {
      return createElement("input", { bind });
    }

    flushSync(() =>
      render(
        createElement(TextField, {
          bind: (node, signal) => {
            calls.push((node as unknown as FakeElement).tagName);
            signals.push(signal);
          },
        }),
        container as unknown as Element,
      ),
    );

    const input = container.childNodes[0] as FakeElement;

    expect(calls).toEqual(["input"]);
    expect(signals[0].aborted).toBe(false);
    expect(input.attributes.bind).toBeUndefined();
  });

  it("updates bind callbacks without duplicate setup", () => {
    const calls: string[] = [];
    const signals: AbortSignal[] = [];
    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);
    const first: Bind = (_node, signal) => {
      calls.push("first");
      signals.push(signal);
    };
    const second: Bind = (_node, signal) => {
      calls.push("second");
      signals.push(signal);
    };

    flushSync(() => root.render(createElement("button", { bind: first })));
    flushSync(() => root.render(createElement("button", { bind: first })));

    expect(calls).toEqual(["first"]);
    expect(signals[0].aborted).toBe(false);

    flushSync(() => root.render(createElement("button", { bind: second })));

    expect(calls).toEqual(["first", "second"]);
    expect(signals[0].aborted).toBe(true);
    expect(signals[1].aborted).toBe(false);

    flushSync(() => root.render(createElement("button", null)));

    expect(signals[1].aborted).toBe(true);
  });

  it("aborts bind signals when bound nodes are removed", () => {
    const signals: AbortSignal[] = [];
    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);

    function App({ show }: { show: boolean }) {
      return createElement(
        "main",
        null,
        show
          ? createElement("button", {
              bind: (_node: Element, signal: AbortSignal) => {
                signals.push(signal);
              },
            })
          : null,
      );
    }

    flushSync(() => root.render(createElement(App, { show: true })));
    expect(signals[0].aborted).toBe(false);

    flushSync(() => root.render(createElement(App, { show: false })));
    expect(signals[0].aborted).toBe(true);
  });

  it("runs bind before before-paint effects", () => {
    const calls: string[] = [];
    const container = new FakeElement("root");

    function App() {
      useBeforePaint(() => {
        calls.push("before-paint");
      });

      return createElement("button", {
        bind: () => calls.push("bind"),
      });
    }

    flushSync(() =>
      render(createElement(App, null), container as unknown as Element),
    );

    expect(calls).toEqual(["bind", "before-paint"]);
  });

  it("runs DOM event handlers with event priority", () => {
    const lanes: number[] = [];
    const container = new FakeElement("root");

    flushSync(() =>
      render(
        createElement("button", {
          events: [
            on("click", () => lanes.push(requestUpdateLane())),
            on("mousemove", () => lanes.push(requestUpdateLane())),
            on("load", () => lanes.push(requestUpdateLane())),
          ],
        }),
        container as unknown as Element,
      ),
    );

    const button = container.childNodes[0] as FakeElement;
    button.dispatch("click");
    button.dispatch("mousemove");
    button.dispatch("load");

    expect(lanes).toEqual([SyncLane, InputContinuousLane, DefaultLane]);
  });

  it("delegates events from the root with element currentTarget", () => {
    const calls: string[] = [];
    const container = new FakeElement("root");

    flushSync(() =>
      render(
        createElement(
          "main",
          {
            events: [
              on("click", (event) => {
                calls.push(
                  `main:${(event.currentTarget as unknown as FakeElement).tagName}`,
                );
              }),
            ],
          },
          createElement("button", {
            events: [
              on("click", (event) => {
                calls.push(
                  `button:${(event.currentTarget as unknown as FakeElement).tagName}`,
                );
              }),
            ],
          }),
        ),
        container as unknown as Element,
      ),
    );

    const main = container.childNodes[0] as FakeElement;
    const button = main.childNodes[0] as FakeElement;

    expect(container.listenerSets.click).toHaveLength(1);
    expect(button.listenerSets.click).toBeUndefined();

    button.dispatch("click");

    expect(calls).toEqual(["button:button", "main:main"]);
  });

  it("updates event descriptors without duplicating handlers", () => {
    const calls: string[] = [];
    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);

    function Button({ label }: { label: string }) {
      return createElement("button", {
        events: [
          on("click", () => calls.push(`first:${label}`)),
          on("click", () => calls.push(`second:${label}`)),
        ],
      });
    }

    flushSync(() => root.render(createElement(Button, { label: "one" })));

    const button = container.childNodes[0] as FakeElement;
    button.dispatch("click");

    flushSync(() => root.render(createElement(Button, { label: "two" })));

    expect(container.listenerSets.click).toHaveLength(1);
    expect(button.listenerSets.click).toBeUndefined();
    button.dispatch("click");

    expect(calls).toEqual([
      "first:one",
      "second:one",
      "first:two",
      "second:two",
    ]);
  });

  it("dispatches capture and bubble events in order", () => {
    const calls: string[] = [];
    const container = new FakeElement("root");

    flushSync(() =>
      render(
        createElement(
          "main",
          {
            events: [
              on("click", () => calls.push("parent:capture"), {
                capture: true,
              }),
              on("click", () => calls.push("parent:bubble")),
            ],
          },
          createElement("button", {
            events: [
              on("click", () => calls.push("child:capture"), {
                capture: true,
              }),
              on("click", () => calls.push("child:bubble")),
            ],
          }),
        ),
        container as unknown as Element,
      ),
    );

    const main = container.childNodes[0] as FakeElement;
    const button = main.childNodes[0] as FakeElement;

    expect(container.listenerSets.click).toHaveLength(2);
    button.dispatch("click");

    expect(calls).toEqual([
      "parent:capture",
      "child:capture",
      "child:bubble",
      "parent:bubble",
    ]);
  });

  it("stops delegated propagation", () => {
    const calls: string[] = [];
    const container = new FakeElement("root");

    flushSync(() =>
      render(
        createElement(
          "main",
          {
            events: [on("click", () => calls.push("parent"))],
          },
          createElement("button", {
            events: [
              on("click", (event) => {
                calls.push("child");
                event.stopPropagation();
              }),
            ],
          }),
        ),
        container as unknown as Element,
      ),
    );

    const main = container.childNodes[0] as FakeElement;
    const button = main.childNodes[0] as FakeElement;

    button.dispatch("click");

    expect(calls).toEqual(["child"]);
  });

  it("continues same-target delegated handlers after stopPropagation", () => {
    const calls: string[] = [];
    const container = new FakeElement("root");

    flushSync(() =>
      render(
        createElement(
          "main",
          {
            events: [on("click", () => calls.push("parent"))],
          },
          createElement("button", {
            events: [
              on("click", (event) => {
                calls.push("child:first");
                event.stopPropagation();
              }),
              on("click", () => calls.push("child:second")),
            ],
          }),
        ),
        container as unknown as Element,
      ),
    );

    const main = container.childNodes[0] as FakeElement;
    const button = main.childNodes[0] as FakeElement;

    button.dispatch("click");

    expect(calls).toEqual(["child:first", "child:second"]);
  });

  it("delegates focus-like events through capture with Fig bubble semantics", () => {
    for (const type of ["focus", "blur"]) {
      const calls: string[] = [];
      const container = new FakeElement("root");

      flushSync(() =>
        render(
          createElement(
            "main",
            {
              events: [
                on(type, () => calls.push("parent:capture"), {
                  capture: true,
                }),
                on(type, () => calls.push("parent:bubble")),
              ],
            },
            createElement("button", {
              events: [on(type, () => calls.push("child:bubble"))],
            }),
          ),
          container as unknown as Element,
        ),
      );

      const main = container.childNodes[0] as FakeElement;
      const button = main.childNodes[0] as FakeElement;

      expect(container.listenerSets[type]).toHaveLength(1);
      expect(button.listenerSets[type]).toBeUndefined();

      button.dispatch(type);

      expect(calls).toEqual([
        "parent:capture",
        "child:bubble",
        "parent:bubble",
      ]);
    }
  });

  it("uses direct listeners for non-bubbling scroll and enter/leave events", () => {
    for (const type of ["scroll", "mouseenter", "mouseleave"]) {
      const calls: string[] = [];
      const container = new FakeElement("root");

      flushSync(() =>
        render(
          createElement(
            "main",
            {
              events: [on(type, () => calls.push("parent"))],
            },
            createElement("button", {
              events: [on(type, () => calls.push("child"))],
            }),
          ),
          container as unknown as Element,
        ),
      );

      const main = container.childNodes[0] as FakeElement;
      const button = main.childNodes[0] as FakeElement;

      expect(container.listenerSets[type]).toBeUndefined();
      expect(main.listenerSets[type]).toHaveLength(1);
      expect(button.listenerSets[type]).toHaveLength(1);

      button.dispatch(type);

      expect(calls).toEqual(["child"]);
    }
  });

  it("cleans up once event listeners after dispatch", () => {
    const calls: string[] = [];
    const signals: AbortSignal[] = [];
    const container = new FakeElement("root");

    flushSync(() =>
      render(
        createElement("button", {
          events: [
            on(
              "click",
              (_event, signal) => {
                calls.push("click");
                signals.push(signal);
              },
              { once: true },
            ),
          ],
        }),
        container as unknown as Element,
      ),
    );

    const button = container.childNodes[0] as FakeElement;

    button.dispatch("click");
    button.dispatch("click");

    expect(calls).toEqual(["click"]);
    expect(signals[0].aborted).toBe(true);
    expect(container.listeners.click).toBeUndefined();
  });

  it("cleans up delegated once listeners when callbacks throw", () => {
    let calls = 0;
    const container = new FakeElement("root");

    flushSync(() =>
      render(
        createElement("button", {
          events: [
            on(
              "click",
              () => {
                calls += 1;
                throw new Error("boom");
              },
              { once: true },
            ),
          ],
        }),
        container as unknown as Element,
      ),
    );

    const button = container.childNodes[0] as FakeElement;

    expect(() => button.dispatch("click")).toThrow("boom");
    expect(calls).toBe(1);
    expect(container.listeners.click).toBeUndefined();

    expect(() => button.dispatch("click")).not.toThrow();
    expect(calls).toBe(1);
  });

  it("keeps delegated root listeners while sibling handlers remain", () => {
    const calls: string[] = [];
    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);

    function App({ showFirst }: { showFirst: boolean }) {
      return createElement(
        "main",
        null,
        showFirst
          ? createElement("button", {
              key: "first",
              events: [on("click", () => calls.push("first"))],
            })
          : null,
        createElement("button", {
          key: "second",
          events: [on("click", () => calls.push("second"))],
        }),
      );
    }

    flushSync(() => root.render(createElement(App, { showFirst: true })));

    const main = container.childNodes[0] as FakeElement;
    const second = main.childNodes[1] as FakeElement;

    expect(container.listenerSets.click).toHaveLength(1);

    flushSync(() => root.render(createElement(App, { showFirst: false })));

    expect(container.listenerSets.click).toHaveLength(1);
    second.dispatch("click");

    expect(calls).toEqual(["second"]);
  });

  it("aborts event signals on re-entry and listener removal", () => {
    const signals: AbortSignal[] = [];
    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);

    function Button({ label }: { label: string }) {
      return createElement("button", {
        events: [
          on("click", (_event, signal) => {
            signals.push(signal);
            calls.push(label);
          }),
        ],
      });
    }

    const calls: string[] = [];

    flushSync(() => root.render(createElement(Button, { label: "one" })));

    const button = container.childNodes[0] as FakeElement;
    button.dispatch("click");
    expect(signals[0].aborted).toBe(false);

    flushSync(() => root.render(createElement(Button, { label: "two" })));

    expect(signals[0].aborted).toBe(false);
    button.dispatch("click");

    expect(signals[0].aborted).toBe(true);
    expect(signals[1].aborted).toBe(false);
    expect(calls).toEqual(["one", "two"]);

    flushSync(() => root.render(createElement("button", null)));

    expect(signals[1].aborted).toBe(true);
    expect(container.listeners.click).toBeUndefined();
  });

  it("rebases skipped lower-priority state updates", async () => {
    let setCount: ((updater: (count: number) => number) => void) | null = null;

    function Counter() {
      const [count, set] = useState(0);
      setCount = set;
      return createElement("span", null, count);
    }

    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);

    flushSync(() => root.render(createElement(Counter, null)));
    expect(container.textContent).toBe("0");

    runWithPriority(DefaultLane, () => {
      setCount?.((count) => count + 10);
    });
    flushSync(() => {
      setCount?.((count) => count + 1);
    });

    expect(container.textContent).toBe("1");

    await delay();
    expect(container.textContent).toBe("11");
  });

  it("clears processed lanes so stable siblings can bail out", () => {
    let setLeft: ((updater: (count: number) => number) => void) | null = null;
    let setRight: ((updater: (count: number) => number) => void) | null = null;
    let leftRenders = 0;
    let rightRenders = 0;

    function Left() {
      leftRenders += 1;
      const [, set] = useState(0);
      setLeft = set;
      return createElement("span", null, "L");
    }

    function Right() {
      rightRenders += 1;
      const [, set] = useState(0);
      setRight = set;
      return createElement("span", null, "R");
    }

    const left = createElement(Left, null);
    const right = createElement(Right, null);

    function App() {
      return createElement("main", null, left, right);
    }

    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);

    flushSync(() => root.render(createElement(App, null)));
    expect([leftRenders, rightRenders]).toEqual([1, 1]);

    flushSync(() => setLeft?.((count) => count + 1));
    expect([leftRenders, rightRenders]).toEqual([2, 1]);

    flushSync(() => setRight?.((count) => count + 1));
    expect([leftRenders, rightRenders]).toEqual([2, 2]);
  });

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
    expect(calls).toEqual(["before-layout:", "before-paint:Committed"]);

    await delay();
    expect(calls).toEqual([
      "before-layout:",
      "before-paint:Committed",
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
    expect(calls).toEqual(["run:1"]);

    root.render(createElement(App, { value: 1 }));
    await delay();
    expect(calls).toEqual(["run:1"]);

    root.render(createElement(App, { value: 2 }));
    await delay();
    expect(calls).toEqual(["run:1", "abort:1", "run:2"]);

    root.unmount();
    await delay();
    expect(calls).toEqual(["run:1", "abort:1", "run:2", "abort:2"]);
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

    expect(calls).toEqual(["run:1", "abort:1", "run:2"]);
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
      "paint:1",
      "abort-layout:1",
      "layout:2",
      "abort-paint:1",
      "paint:2",
      "abort-layout:2",
      "abort-paint:2",
    ]);
  });

  it("runs useOnMount only once", async () => {
    const calls: string[] = [];
    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);

    function App({ value }: { value: number }) {
      useOnMount((signal) => {
        calls.push(`mount:${value}`);
        signal.addEventListener("abort", () => calls.push(`abort:${value}`), {
          once: true,
        });
      });

      return createElement("main", null, value);
    }

    root.render(createElement(App, { value: 1 }));
    await delay();
    root.render(createElement(App, { value: 2 }));
    await delay();

    expect(calls).toEqual(["mount:1"]);

    root.unmount();
    await delay();
    expect(calls).toEqual(["mount:1", "abort:1"]);
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

    root.render(createElement(App, { showChild: true }));
    await delay();
    expect(calls).toEqual(["parent:run", "child:run"]);

    root.render(createElement(App, { showChild: false }));
    await delay();
    expect(calls).toEqual(["parent:run", "child:run", "child:abort"]);

    root.unmount();
    await delay();
    expect(calls).toEqual([
      "parent:run",
      "child:run",
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

    expect(calls).toEqual(["a:1", "b:1", "abort-a:1", "a:2"]);
  });

  it("moves keyed children during reconciliation", async () => {
    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);
    const first = createElement(
      "div",
      null,
      createElement("span", { key: "a" }, "A"),
      createElement("span", { key: "b" }, "B"),
    );
    const second = createElement(
      "div",
      null,
      createElement("span", { key: "b" }, "B"),
      createElement("span", { key: "a" }, "A"),
    );

    root.render(first);
    await delay();
    expect(container.textContent).toBe("AB");

    root.render(second);
    await delay();
    expect(container.textContent).toBe("BA");
  });

  it("inserts new children before stable siblings", async () => {
    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);

    root.render(
      createElement(
        "div",
        null,
        createElement("span", { key: "a" }, "A"),
        createElement("span", { key: "c" }, "C"),
      ),
    );
    await delay();
    expect(container.textContent).toBe("AC");

    root.render(
      createElement(
        "div",
        null,
        createElement("span", { key: "a" }, "A"),
        createElement("span", { key: "b" }, "B"),
        createElement("span", { key: "c" }, "C"),
      ),
    );
    await delay();
    expect(container.textContent).toBe("ABC");
  });

  it("replaces text, elements, and empty children at the same position", () => {
    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);

    flushSync(() => root.render(createElement("div", null, "A")));
    expect(container.textContent).toBe("A");

    flushSync(() =>
      root.render(createElement("div", null, createElement("span", null, "B"))),
    );
    expect(container.textContent).toBe("B");
    expect(
      (container.childNodes[0] as FakeElement).childNodes[0],
    ).toBeInstanceOf(FakeElement);

    flushSync(() => root.render(createElement("div", null, null, false, "C")));
    expect(container.textContent).toBe("C");
    expect((container.childNodes[0] as FakeElement).childNodes).toHaveLength(1);
  });

  it("does not collide numeric explicit keys with implicit index keys", () => {
    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);

    flushSync(() =>
      root.render(
        createElement(
          "div",
          null,
          createElement("span", { key: 1 }, "A"),
          createElement("span", null, "B"),
        ),
      ),
    );

    expect(container.textContent).toBe("AB");

    flushSync(() =>
      root.render(createElement("div", null, createElement("span", null, "B"))),
    );

    expect(container.textContent).toBe("B");
    expect((container.childNodes[0] as FakeElement).childNodes).toHaveLength(1);
  });

  it("moves keyed fragments and component subtrees through host siblings", () => {
    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);

    function Item({ value }: { value: string }) {
      return createElement("span", null, value);
    }

    const fragment = createElement(
      Fragment,
      { key: "fragment" },
      createElement("span", null, "A"),
      createElement("span", null, "B"),
    );
    const item = createElement(Item, { key: "item", value: "I" });
    const stable = createElement("span", { key: "stable" }, "S");

    flushSync(() =>
      root.render(createElement("div", null, fragment, item, stable)),
    );
    expect(container.textContent).toBe("ABIS");

    flushSync(() =>
      root.render(createElement("div", null, item, fragment, stable)),
    );
    expect(container.textContent).toBe("IABS");

    flushSync(() =>
      root.render(createElement("div", null, fragment, item, stable)),
    );
    expect(container.textContent).toBe("ABIS");
  });

  it("removes fragment children without leaving host wrappers", () => {
    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);

    function Pair({ show }: { show: boolean }) {
      return createElement(
        "main",
        null,
        show
          ? createElement(
              Fragment,
              null,
              createElement("span", null, "A"),
              createElement("span", null, "B"),
            )
          : null,
        createElement("span", null, "C"),
      );
    }

    flushSync(() => root.render(createElement(Pair, { show: true })));

    const main = container.childNodes[0] as FakeElement;
    expect(main.childNodes).toHaveLength(3);
    expect(main.textContent).toBe("ABC");

    flushSync(() => root.render(createElement(Pair, { show: false })));

    expect(main.childNodes).toHaveLength(1);
    expect(main.textContent).toBe("C");
  });

  it("updates DOM props without leaking stale attributes or listeners", () => {
    const calls: string[] = [];
    const firstClick = () => calls.push("first");
    const secondClick = () => calls.push("second");
    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);

    flushSync(() =>
      root.render(
        createElement("button", {
          className: "primary",
          disabled: true,
          events: [on("click", firstClick)],
          style: { color: "red", fontWeight: "bold" },
        }),
      ),
    );

    const button = container.childNodes[0] as FakeElement;
    expect(button.attributes).toEqual({ class: "primary", disabled: "true" });
    expect(button.style.color).toBe("red");
    expect(button.style.fontWeight).toBe("bold");
    button.dispatch("click");
    expect(calls).toEqual(["first"]);

    flushSync(() =>
      root.render(
        createElement("button", {
          disabled: false,
          events: [on("click", secondClick)],
          style: { color: "blue" },
        }),
      ),
    );

    expect(button.attributes).toEqual({});
    expect(button.style.color).toBe("blue");
    expect(button.style.fontWeight).toBe("");
    button.dispatch("click");
    expect(calls).toEqual(["first", "second"]);

    flushSync(() => root.render(createElement("button", null)));

    expect(container.listeners.click).toBeUndefined();
    expect(button.style.color).toBe("");
  });
});
