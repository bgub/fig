import {
  Activity,
  createElement,
  readPromise,
  Suspense,
  useReactive,
  useState,
} from "@bgub/fig";
import { describe, expect, it } from "vite-plus/test";
import { createPortal, createRoot, flushSync, hydrateRoot } from "./index.ts";
import {
  deferred,
  delay,
  FakeElement,
  FakeText,
  installFakeDocument,
} from "./test-utils.ts";

installFakeDocument();

function display(node: FakeElement): string {
  return node.style.display ?? "";
}

describe("@bgub/fig-dom activity", () => {
  it("hides and reveals host nodes while preserving state", async () => {
    const calls: string[] = [];
    let setCount: ((updater: (count: number) => number) => void) | null = null;
    let setMode: ((mode: "visible" | "hidden") => void) | null = null;

    function Counter() {
      const [count, set] = useState(0);
      setCount = set;
      useReactive((signal) => {
        calls.push(`run:${count}`);
        signal.addEventListener("abort", () => calls.push(`abort:${count}`), {
          once: true,
        });
      }, []);
      return createElement("span", null, count);
    }

    function App() {
      const [mode, set] = useState<"visible" | "hidden">("visible");
      setMode = set;
      return createElement(Activity, { mode }, createElement(Counter, null));
    }

    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);
    root.render(createElement(App, null));
    await delay();

    const span = container.childNodes[0] as FakeElement;
    expect(container.textContent).toBe("0");
    expect(display(span)).toBe("");
    // First-time effects strict-run twice in development.
    expect(calls).toEqual(["run:0", "abort:0", "run:0"]);

    // Update state, then hide: the effect aborts and the DOM hides.
    flushSync(() => setCount?.((count) => count + 1));
    flushSync(() => setMode?.("hidden"));
    await delay();
    expect(display(span)).toBe("none");
    expect(calls).toEqual(["run:0", "abort:0", "run:0", "abort:0"]);

    // Reveal: state survived, the DOM unhides, the effect re-runs once.
    flushSync(() => setMode?.("visible"));
    await delay();
    expect(display(span)).toBe("");
    expect(container.textContent).toBe("1");
    expect(calls).toEqual(["run:0", "abort:0", "run:0", "abort:0", "run:1"]);
  });

  it("defers effects for trees that mount hidden until reveal", async () => {
    const calls: string[] = [];
    let setMode: ((mode: "visible" | "hidden") => void) | null = null;

    function Child() {
      useReactive((signal) => {
        calls.push("run");
        signal.addEventListener("abort", () => calls.push("abort"), {
          once: true,
        });
      }, []);
      return createElement("span", null, "child");
    }

    function App() {
      const [mode, set] = useState<"visible" | "hidden">("hidden");
      setMode = set;
      return createElement(Activity, { mode }, createElement(Child, null));
    }

    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);
    root.render(createElement(App, null));
    await delay();

    const span = container.childNodes[0] as FakeElement;
    expect(display(span)).toBe("none");
    expect(calls).toEqual([]);

    flushSync(() => setMode?.("visible"));
    await delay();
    expect(display(span)).toBe("");
    // The deferred first run strict-cycles on reveal.
    expect(calls).toEqual(["run", "abort", "run"]);
  });

  it("aborts binds on hide and re-attaches them on reveal", () => {
    const signals: AbortSignal[] = [];
    let setMode: ((mode: "visible" | "hidden") => void) | null = null;

    const record = (_node: Element, signal: AbortSignal) => {
      signals.push(signal);
    };

    function App() {
      const [mode, set] = useState<"visible" | "hidden">("visible");
      setMode = set;
      return createElement(
        Activity,
        { mode },
        createElement("input", { bind: record }),
      );
    }

    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);
    flushSync(() => root.render(createElement(App, null)));

    // First-time binds strict-run twice in development.
    expect(signals).toHaveLength(2);
    expect(signals[1]?.aborted).toBe(false);

    flushSync(() => setMode?.("hidden"));
    expect(signals).toHaveLength(2);
    expect(signals[1]?.aborted).toBe(true);

    flushSync(() => setMode?.("visible"));
    expect(signals).toHaveLength(3);
    expect(signals[2]?.aborted).toBe(false);
  });

  it("commits updates inside hidden trees without revealing them", async () => {
    let setCount: ((updater: (count: number) => number) => void) | null = null;
    let setMode: ((mode: "visible" | "hidden") => void) | null = null;

    function Counter() {
      const [count, set] = useState(0);
      setCount = set;
      return createElement("span", null, count);
    }

    function App() {
      const [mode, set] = useState<"visible" | "hidden">("visible");
      setMode = set;
      return createElement(Activity, { mode }, createElement(Counter, null));
    }

    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);
    flushSync(() => root.render(createElement(App, null)));
    flushSync(() => setMode?.("hidden"));

    const span = container.childNodes[0] as FakeElement;
    expect(display(span)).toBe("none");

    flushSync(() => setCount?.((count) => count + 1));
    expect(container.textContent).toBe("1");
    expect(display(span)).toBe("none");
  });

  it("prerenders updates queued while hidden without revealing them", async () => {
    let setCount: ((updater: (count: number) => number) => void) | null = null;
    let setMode: ((mode: "visible" | "hidden") => void) | null = null;

    function Counter() {
      const [count, set] = useState(0);
      setCount = set;
      return createElement("span", null, count);
    }

    function App() {
      const [mode, set] = useState<"visible" | "hidden">("visible");
      setMode = set;
      return createElement(Activity, { mode }, createElement(Counter, null));
    }

    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);
    flushSync(() => root.render(createElement(App, null)));
    flushSync(() => setMode?.("hidden"));

    const span = container.childNodes[0] as FakeElement;
    const queueHidden = setCount as unknown as (
      updater: (count: number) => number,
    ) => void;
    queueHidden((count) => count + 1);
    await delay();

    expect(container.textContent).toBe("1");
    expect(display(span)).toBe("none");
  });

  it("keeps structural prerender changes hidden", async () => {
    let setItems: ((updater: (items: string[]) => string[]) => void) | null =
      null;
    let setMode: ((mode: "visible" | "hidden") => void) | null = null;

    function List() {
      const [items, set] = useState(["a"]);
      setItems = set;
      return items.map((item) => createElement("span", { key: item }, item));
    }

    function App() {
      const [mode, set] = useState<"visible" | "hidden">("visible");
      setMode = set;
      return createElement(Activity, { mode }, createElement(List, null));
    }

    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);
    flushSync(() => root.render(createElement(App, null)));
    flushSync(() => setMode?.("hidden"));

    // Prerender inserts a new top-level node while hidden.
    const grow = setItems as unknown as (
      updater: (items: string[]) => string[],
    ) => void;
    grow((items) => [...items, "b"]);
    await delay();

    const first = container.childNodes[0] as FakeElement;
    const second = container.childNodes[1] as FakeElement;
    expect(container.textContent).toBe("ab");
    expect(display(first)).toBe("none");
    expect(display(second)).toBe("none");

    flushSync(() => setMode?.("visible"));
    expect(display(first)).toBe("");
    expect(display(second)).toBe("");
  });

  it("reveals atomically with updates queued while hidden", async () => {
    let counterRenders = 0;
    let setCount: ((updater: (count: number) => number) => void) | null = null;
    let setMode: ((mode: "visible" | "hidden") => void) | null = null;

    function Counter() {
      counterRenders += 1;
      const [count, set] = useState(0);
      setCount = set;
      return createElement("span", null, count);
    }

    function App() {
      const [mode, set] = useState<"visible" | "hidden">("visible");
      setMode = set;
      return createElement(Activity, { mode }, createElement(Counter, null));
    }

    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);
    flushSync(() => root.render(createElement(App, null)));
    flushSync(() => setMode?.("hidden"));

    // Queue hidden work, then reveal before the idle prerender runs.
    const queueHidden = setCount as unknown as (
      updater: (count: number) => number,
    ) => void;
    queueHidden((count) => count + 1);
    const rendersBeforeReveal = counterRenders;
    flushSync(() => setMode?.("visible"));

    // The reveal render itself processes the pending hidden update: fresh
    // content in the reveal commit, in a single render pass (strict-doubled).
    const span = container.childNodes[0] as FakeElement;
    expect(container.textContent).toBe("1");
    expect(display(span)).toBe("");
    expect(counterRenders).toBe(rendersBeforeReveal + 2);

    await delay();
    expect(counterRenders).toBe(rendersBeforeReveal + 2);
  });

  it("hides and restores bare text children", () => {
    let setMode: ((mode: "visible" | "hidden") => void) | null = null;

    function App() {
      const [mode, set] = useState<"visible" | "hidden">("visible");
      setMode = set;
      return createElement(Activity, { mode }, "plain text");
    }

    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);
    flushSync(() => root.render(createElement(App, null)));
    expect(container.textContent).toBe("plain text");

    flushSync(() => setMode?.("hidden"));
    expect(container.textContent).toBe("");

    flushSync(() => setMode?.("visible"));
    expect(container.textContent).toBe("plain text");
  });

  it("hides portal content inside hidden activities", () => {
    let setMode: ((mode: "visible" | "hidden") => void) | null = null;
    const target = new FakeElement("portal-root");

    function App() {
      const [mode, set] = useState<"visible" | "hidden">("visible");
      setMode = set;
      return createElement(
        Activity,
        { mode },
        createElement(
          "section",
          null,
          createPortal(
            createElement("aside", null, "Portal"),
            target as unknown as Element,
          ),
        ),
      );
    }

    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);
    flushSync(() => root.render(createElement(App, null)));

    const aside = target.childNodes[0] as FakeElement;
    expect(target.textContent).toBe("Portal");
    expect(display(aside)).toBe("");

    flushSync(() => setMode?.("hidden"));
    expect(display(aside)).toBe("none");

    flushSync(() => setMode?.("visible"));
    expect(display(aside)).toBe("");
  });

  it("hydrates server-hidden Activity content and keeps it hidden", async () => {
    const calls: string[] = [];
    let setMode: ((mode: "visible" | "hidden") => void) | null = null;

    function Child() {
      useReactive((signal) => {
        calls.push("run");
        signal.addEventListener("abort", () => calls.push("abort"), {
          once: true,
        });
      }, []);
      return createElement("span", null, "hidden child");
    }

    function App() {
      const [mode, set] = useState<"visible" | "hidden">("hidden");
      setMode = set;
      return createElement(Activity, { mode }, createElement(Child, null));
    }

    // Server-rendered DOM: the span streamed with display:none.
    const container = new FakeElement("root");
    const span = new FakeElement("span");
    span.setAttribute("style", "display:none");
    span.appendChild(new FakeText("hidden child"));
    container.appendChild(span);

    flushSync(() =>
      hydrateRoot(container as unknown as Element, createElement(App, null)),
    );
    await delay();

    // The server node was adopted, stays hidden, and effects are deferred.
    expect(container.childNodes[0]).toBe(span);
    expect(display(span)).toBe("none");
    expect(calls).toEqual([]);

    flushSync(() => setMode?.("visible"));
    await delay();
    expect(display(span)).toBe("");
    expect(container.textContent).toBe("hidden child");
    expect(calls).toEqual(["run", "abort", "run"]);
  });

  it("keeps Suspense content hidden when it resolves inside a hidden tree", async () => {
    const pending = deferred<string>();
    let setMode: ((mode: "visible" | "hidden") => void) | null = null;

    function Message() {
      return createElement("span", null, readPromise(pending.promise));
    }

    function App() {
      const [mode, set] = useState<"visible" | "hidden">("visible");
      setMode = set;
      return createElement(
        Activity,
        { mode },
        createElement(
          Suspense,
          { fallback: createElement("em", null, "Loading") },
          createElement(Message, null),
        ),
      );
    }

    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);
    root.render(createElement(App, null));
    await delay();
    expect(container.textContent).toBe("Loading");

    // Hide while pending, then resolve: the restored primary is placed
    // inside the hidden tree and must stay hidden.
    flushSync(() => setMode?.("hidden"));
    pending.resolve("Ready");
    await delay();

    const span = container.childNodes[0] as FakeElement;
    expect(container.textContent).toBe("Ready");
    expect(span.tagName).toBe("span");
    expect(display(span)).toBe("none");

    flushSync(() => setMode?.("visible"));
    expect(display(span)).toBe("");
    expect(container.textContent).toBe("Ready");
  });

  it("keeps nested hidden activities hidden when the outer reveals", () => {
    let setOuter: ((mode: "visible" | "hidden") => void) | null = null;

    function App() {
      const [outer, set] = useState<"visible" | "hidden">("visible");
      setOuter = set;
      return createElement(
        Activity,
        { mode: outer },
        createElement("section", null, "outer"),
        createElement(
          Activity,
          { mode: "hidden" },
          createElement("aside", null, "inner"),
        ),
      );
    }

    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);
    flushSync(() => root.render(createElement(App, null)));

    const section = container.childNodes[0] as FakeElement;
    const aside = container.childNodes[1] as FakeElement;
    expect(display(section)).toBe("");
    expect(display(aside)).toBe("none");

    flushSync(() => setOuter?.("hidden"));
    expect(display(section)).toBe("none");
    expect(display(aside)).toBe("none");

    flushSync(() => setOuter?.("visible"));
    expect(display(section)).toBe("");
    expect(display(aside)).toBe("none");
  });
});
