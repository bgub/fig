import {
  Activity,
  createElement,
  readPromise,
  Suspense,
  useSyncExternalStore,
  useReactive,
  useState,
} from "@bgub/fig";
import { describe, expect, it } from "vite-plus/test";
import {
  createPortal,
  createRoot,
  flushSync,
  hydrateRoot,
  on,
} from "./index.ts";
import {
  deferred,
  delay,
  FakeComment,
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

  it("removes Activity display override when original display style is invalid", async () => {
    let setMode: ((mode: "visible" | "hidden") => void) | null = null;

    function Child() {
      const props: Record<string, unknown> = {
        style: { display: 5 },
      };
      return createElement("span", props, "child");
    }

    function App() {
      const [mode, set] = useState<"visible" | "hidden">("visible");
      setMode = set;
      return createElement(Activity, { mode }, createElement(Child, null));
    }

    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);
    root.render(createElement(App, null));
    await delay();

    const span = container.childNodes[0] as FakeElement;
    expect(display(span)).toBe("");

    flushSync(() => setMode?.("hidden"));
    expect(display(span)).toBe("none");

    flushSync(() => setMode?.("visible"));
    expect(display(span)).toBe("");
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

  it("runs deferred effects under adopted children on reveal", async () => {
    const calls: string[] = [];
    let setMode: ((mode: "visible" | "hidden") => void) | null = null;

    function Leaf() {
      useReactive((signal) => {
        calls.push("run");
        signal.addEventListener("abort", () => calls.push("abort"), {
          once: true,
        });
      }, []);
      return createElement("span", null, "leaf");
    }

    function StableWrapper() {
      return createElement(Leaf, null);
    }

    const stableChild = createElement(StableWrapper, null);

    function App() {
      const [mode, set] = useState<"visible" | "hidden">("hidden");
      setMode = set;
      return createElement(Activity, { mode }, stableChild);
    }

    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);
    root.render(createElement(App, null));
    await delay();

    expect(calls).toEqual([]);

    flushSync(() => setMode?.("visible"));
    await delay();

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

  it("never runs binds for trees that mount hidden until reveal", () => {
    const signals: AbortSignal[] = [];
    let setMode: ((mode: "visible" | "hidden") => void) | null = null;

    const record = (_node: Element, signal: AbortSignal) => {
      signals.push(signal);
    };

    function App() {
      const [mode, set] = useState<"visible" | "hidden">("hidden");
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

    // Mounted hidden: the bind must not run (not even the dev strict
    // cycle), mirroring deferred effects.
    expect(signals).toHaveLength(0);

    flushSync(() => setMode?.("visible"));

    // The reveal runs the deferred first attach, including the strict cycle.
    expect(signals).toHaveLength(2);
    expect(signals[0]?.aborted).toBe(true);
    expect(signals[1]?.aborted).toBe(false);
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

  it("keeps server-hidden content dehydrated until reveal", async () => {
    const calls: string[] = [];
    let childRenders = 0;
    let setMode: ((mode: "visible" | "hidden") => void) | null = null;

    function Child() {
      childRenders += 1;
      useReactive((signal) => {
        calls.push("run");
        signal.addEventListener("abort", () => calls.push("abort"), {
          once: true,
        });
      }, []);
      return createElement("span", null, "secret tab");
    }

    function App() {
      const [mode, set] = useState<"visible" | "hidden">("hidden");
      setMode = set;
      return createElement(Activity, { mode }, createElement(Child, null));
    }

    // Server-rendered DOM: hidden content streams inside an inert template.
    const container = new FakeElement("root");
    const template = new FakeElement("template");
    template.setAttribute("data-fig-activity", "");
    const span = new FakeElement("span");
    span.appendChild(new FakeText("secret tab"));
    template.appendChild(span);
    container.appendChild(template);

    flushSync(() =>
      hydrateRoot(container as unknown as Element, createElement(App, null)),
    );
    await delay();

    // Dehydrated: the template is untouched and no content work happened.
    expect(container.childNodes[0]).toBe(template);
    expect(childRenders).toBe(0);
    expect(calls).toEqual([]);

    // Reveal: content hydrates against the template, adopting its nodes,
    // and the template unpacks into the live DOM.
    flushSync(() => setMode?.("visible"));
    await delay();
    expect(container.childNodes[0]).toBe(span);
    expect(container.textContent).toBe("secret tab");
    expect(childRenders).toBe(2);
    expect(calls).toEqual(["run", "abort", "run"]);
  });

  it("hydrates server-hidden content through when the client mode is visible", async () => {
    function App() {
      return createElement(
        Activity,
        { mode: "visible" },
        createElement("span", null, "tab"),
      );
    }

    // The server hid the content but the client renders it visible.
    const container = new FakeElement("root");
    const template = new FakeElement("template");
    template.setAttribute("data-fig-activity", "");
    const span = new FakeElement("span");
    span.appendChild(new FakeText("tab"));
    template.appendChild(span);
    container.appendChild(template);

    flushSync(() =>
      hydrateRoot(container as unknown as Element, createElement(App, null)),
    );
    await delay();

    expect(container.childNodes[0]).toBe(span);
    expect(container.textContent).toBe("tab");
  });

  it("client-renders after a mismatch inside a dehydrated Activity", async () => {
    const recovered: string[] = [];
    let setMode: ((mode: "visible" | "hidden") => void) | null = null;

    function App() {
      const [mode, set] = useState<"visible" | "hidden">("hidden");
      setMode = set;
      return createElement(
        Activity,
        { mode },
        createElement("div", null, "client text"),
      );
    }

    const container = new FakeElement("root");
    const template = new FakeElement("template");
    template.setAttribute("data-fig-activity", "");
    const span = new FakeElement("span");
    span.appendChild(new FakeText("server text"));
    template.appendChild(span);
    container.appendChild(template);

    flushSync(() =>
      hydrateRoot(container as unknown as Element, createElement(App, null), {
        onRecoverableError: (error) =>
          recovered.push(
            error instanceof Error ? error.message : String(error),
          ),
      }),
    );
    await delay();

    expect(() => flushSync(() => setMode?.("visible"))).not.toThrow();
    await delay();

    expect(container.textContent).toBe("client text");
    expect(
      recovered.some((message) => message.includes("Hydration mismatch")),
    ).toBe(true);
  });

  it("unpacks real template content before binding hydrated children", async () => {
    let childRenders = 0;
    let clicks = 0;
    const bindParents: string[] = [];
    let setMode: ((mode: "visible" | "hidden") => void) | null = null;

    function Child() {
      childRenders += 1;
      return createElement(
        "button",
        {
          bind: (node: Element) => {
            bindParents.push(
              (node.parentNode as FakeElement | null)?.tagName ?? "none",
            );
          },
          events: [
            on("click", () => {
              clicks += 1;
            }),
          ],
        },
        "Open",
      );
    }

    function App() {
      const [mode, set] = useState<"visible" | "hidden">("hidden");
      setMode = set;
      return createElement(Activity, { mode }, createElement(Child, null));
    }

    const container = new FakeElement("root");
    const template = new FakeElement("template");
    template.setAttribute("data-fig-activity", "");
    const content = new FakeElement("fragment");
    (template as FakeElement & { content: FakeElement }).content = content;
    const button = new FakeElement("button");
    button.appendChild(new FakeText("Open"));
    content.appendChild(button);
    container.appendChild(template);

    flushSync(() =>
      hydrateRoot(container as unknown as Element, createElement(App, null)),
    );
    await delay();

    expect(container.childNodes[0]).toBe(template);
    expect(childRenders).toBe(0);
    expect(bindParents).toEqual([]);

    flushSync(() => setMode?.("visible"));
    await delay();

    expect(container.childNodes[0]).toBe(button);
    expect(childRenders).toBe(2);
    expect(bindParents).toEqual(["root", "root"]);

    button.dispatch("click");
    expect(clicks).toBe(1);
  });

  it("hydrates a completed Suspense boundary filled into a hidden Activity template on reveal", async () => {
    // Simulates the post-fill DOM: the server streamed the inner Suspense
    // completion into the hidden Activity's inert template content (via the `ac`
    // runtime op), so the template content holds a COMPLETED boundary. On reveal
    // the client must hydrate that server content — preserving node identity and
    // never showing the fallback — instead of client-rendering it.
    const pending = deferred<string>();
    let setMode: ((mode: "visible" | "hidden") => void) | null = null;

    function Message() {
      return createElement("span", null, readPromise(pending.promise));
    }

    function App() {
      const [mode, set] = useState<"visible" | "hidden">("hidden");
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
    const template = new FakeElement("template");
    template.setAttribute("data-fig-activity", "");
    const content = new FakeElement("fragment");
    (template as FakeElement & { content: FakeElement }).content = content;
    const start = new FakeComment("fig:suspense:completed");
    const serverSpan = new FakeElement("span");
    serverSpan.appendChild(new FakeText("Ready"));
    const end = new FakeComment("/fig:suspense");
    content.appendChild(start);
    content.appendChild(serverSpan);
    content.appendChild(end);
    container.appendChild(template);

    flushSync(() =>
      hydrateRoot(container as unknown as Element, createElement(App, null)),
    );
    await delay();

    // Dehydrated while hidden: the template is untouched, no fallback rendered.
    expect(container.childNodes[0]).toBe(template);
    expect(container.textContent).not.toContain("Loading");

    // The client promise resolves (the data the server already had).
    pending.resolve("Ready");

    flushSync(() => setMode?.("visible"));
    await delay();

    // Server content is preserved with node identity, never client-rendered to a
    // fresh node, and the fallback never appeared.
    expect(container.childNodes[0]).toBe(serverSpan);
    expect(container.textContent).toBe("Ready");
  });

  it("client-renders a failed Suspense marked client inside a hidden Activity template on reveal", async () => {
    // Simulates the post-`ax` DOM: a Suspense boundary inside the hidden Activity
    // failed on the server, so its marker was flipped to client-render inside the
    // template content. On reveal the client must discard the server fallback and
    // render the boundary fresh.
    const recovered: string[] = [];
    let setMode: ((mode: "visible" | "hidden") => void) | null = null;

    function Message() {
      return createElement("span", null, "client content");
    }

    function App() {
      const [mode, set] = useState<"visible" | "hidden">("hidden");
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
    const template = new FakeElement("template");
    template.setAttribute("data-fig-activity", "");
    const content = new FakeElement("fragment");
    (template as FakeElement & { content: FakeElement }).content = content;
    const start = new FakeComment("fig:suspense:client");
    const placeholder = new FakeElement("template");
    placeholder.dataset.dgst = "hidden-digest";
    placeholder.dataset.msg = "hidden activity server error";
    const serverFallback = new FakeElement("em");
    serverFallback.appendChild(new FakeText("Loading"));
    const end = new FakeComment("/fig:suspense");
    content.appendChild(start);
    content.appendChild(placeholder);
    content.appendChild(serverFallback);
    content.appendChild(end);
    container.appendChild(template);

    flushSync(() =>
      hydrateRoot(container as unknown as Element, createElement(App, null), {
        onRecoverableError: (error) =>
          recovered.push(
            error instanceof Error ? error.message : String(error),
          ),
      }),
    );
    await delay();

    expect(container.childNodes[0]).toBe(template);

    flushSync(() => setMode?.("visible"));
    await delay();

    // The boundary recovers on the client: fresh content, not the server
    // fallback, and the failure surfaces through onRecoverableError.
    expect(container.textContent).toBe("client content");
    expect(recovered).toContain("hidden activity server error");
  });

  it("recovers a client-render sibling when an earlier hidden-Activity boundary stays suspended on reveal", async () => {
    // Mirrors the e2e: one boundary's server content is preserved but its client
    // promise never resolves (so its hydration suspends and abandons), and a
    // sibling boundary was marked client-render. The suspended sibling must not
    // prevent the client-render sibling from recovering.
    const recovered: string[] = [];
    const neverResolves = new Promise<string>(() => {});
    let setMode: ((mode: "visible" | "hidden") => void) | null = null;

    function Preserved() {
      return createElement("span", null, readPromise(neverResolves));
    }

    function Recovered() {
      return createElement("span", null, "recovered content");
    }

    function App() {
      const [mode, set] = useState<"visible" | "hidden">("hidden");
      setMode = set;
      return createElement(
        Activity,
        { mode },
        createElement(
          Suspense,
          { fallback: createElement("em", null, "L0") },
          createElement(Preserved, null),
        ),
        createElement(
          Suspense,
          { fallback: createElement("em", null, "L1") },
          createElement(Recovered, null),
        ),
      );
    }

    const container = new FakeElement("root");
    const template = new FakeElement("template");
    template.setAttribute("data-fig-activity", "");
    const content = new FakeElement("fragment");
    (template as FakeElement & { content: FakeElement }).content = content;

    // Boundary 0: completed, server content preserved.
    const start0 = new FakeComment("fig:suspense:completed");
    const preservedSpan = new FakeElement("span");
    preservedSpan.appendChild(new FakeText("server preserved"));
    const end0 = new FakeComment("/fig:suspense");
    // Boundary 1: client-render marker.
    const start1 = new FakeComment("fig:suspense:client");
    const placeholder1 = new FakeElement("template");
    placeholder1.dataset.dgst = "d";
    placeholder1.dataset.msg = "boundary failed";
    const fallback1 = new FakeElement("em");
    fallback1.appendChild(new FakeText("L1"));
    const end1 = new FakeComment("/fig:suspense");
    for (const node of [
      start0,
      preservedSpan,
      end0,
      start1,
      placeholder1,
      fallback1,
      end1,
    ]) {
      content.appendChild(node);
    }
    container.appendChild(template);

    flushSync(() =>
      hydrateRoot(container as unknown as Element, createElement(App, null), {
        onRecoverableError: (error) =>
          recovered.push(
            error instanceof Error ? error.message : String(error),
          ),
      }),
    );
    await delay();

    flushSync(() => setMode?.("visible"));
    await delay();

    // The suspended boundary keeps its preserved server content; the sibling
    // recovers on the client.
    expect(container.textContent).toContain("server preserved");
    expect(container.textContent).toContain("recovered content");
    expect(recovered).toContain("boundary failed");
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

  it("keeps Suspense work hidden while its parent Activity is hidden", async () => {
    const first = deferred<string>();
    let setGate: ((value: Promise<string>) => void) | null = null;
    let setMode: ((mode: "visible" | "hidden") => void) | null = null;

    function Slow({ gate }: { gate: Promise<string> }) {
      return createElement("span", null, readPromise(gate));
    }

    function App({ initial }: { initial: Promise<string> }) {
      const [gate, setGateState] = useState(initial);
      const [mode, setModeState] = useState<"visible" | "hidden">("visible");
      setGate = setGateState;
      setMode = setModeState;
      return createElement(
        Activity,
        { mode },
        createElement(
          Suspense,
          { fallback: createElement("em", null, "Loading") },
          createElement(
            "div",
            null,
            createElement("span", null, "P"),
            createElement(Slow, { gate }),
          ),
        ),
      );
    }

    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);
    root.render(createElement(App, { initial: first.promise }));
    first.resolve("ONE");
    await delay();

    const div = container.childNodes[0] as FakeElement;
    expect(container.textContent).toBe("PONE");
    expect(display(div)).toBe("");

    flushSync(() => setMode?.("hidden"));
    expect(display(div)).toBe("none");

    const second = deferred<string>();
    flushSync(() => setGate?.(second.promise));
    const fallback = container.childNodes[1] as FakeElement;
    expect(display(div)).toBe("none");
    expect(display(fallback)).toBe("none");
    expect(fallback.textContent).toBe("Loading");

    second.resolve("TWO");
    await delay();
    expect(container.textContent).toBe("PTWO");
    expect(display(div)).toBe("none");

    flushSync(() => setMode?.("visible"));
    expect(display(div)).toBe("");
  });

  it("keeps nested Activity hidden when parent Suspense re-suspends and reveals", async () => {
    const first = deferred<string>();
    let setGate: ((value: Promise<string>) => void) | null = null;
    let setMode: ((mode: "visible" | "hidden") => void) | null = null;

    function Slow({ gate }: { gate: Promise<string> }) {
      return createElement("span", null, readPromise(gate));
    }

    function App({ initial }: { initial: Promise<string> }) {
      const [gate, setGateState] = useState(initial);
      const [mode, setModeState] = useState<"visible" | "hidden">("visible");
      setGate = setGateState;
      setMode = setModeState;
      return createElement(
        Suspense,
        { fallback: createElement("em", null, "Loading") },
        createElement(
          Activity,
          { mode },
          createElement(
            "section",
            null,
            createElement("span", null, "P"),
            createElement(Slow, { gate }),
          ),
        ),
      );
    }

    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);
    root.render(createElement(App, { initial: first.promise }));
    first.resolve("ONE");
    await delay();

    const section = container.childNodes[0] as FakeElement;
    expect(container.textContent).toBe("PONE");
    expect(display(section)).toBe("");

    flushSync(() => setMode?.("hidden"));
    expect(display(section)).toBe("none");

    const second = deferred<string>();
    flushSync(() => setGate?.(second.promise));
    const fallback = container.childNodes[1] as FakeElement;
    expect(display(section)).toBe("none");
    expect(display(fallback)).toBe("");
    expect(fallback.textContent).toBe("Loading");

    second.resolve("TWO");
    await delay();
    expect(container.textContent).toBe("PTWO");
    expect(display(section)).toBe("none");

    flushSync(() => setMode?.("visible"));
    expect(display(section)).toBe("");
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

  it("does not busy-loop when a hidden subtree with queued offscreen work unmounts before reveal", async () => {
    let appRenders = 0;
    let setCount: ((updater: (count: number) => number) => void) | null = null;
    let setShow: ((show: boolean) => void) | null = null;
    let setOuter: ((value: number) => void) | null = null;

    function Counter() {
      const [count, set] = useState(0);
      setCount = set;
      return createElement("span", null, count);
    }

    function App() {
      appRenders += 1;
      const [show, setShowState] = useState(true);
      const [outer, setOuterState] = useState(0);
      setShow = setShowState;
      setOuter = setOuterState;
      return createElement(
        "main",
        null,
        createElement("i", null, `o${outer}`),
        show
          ? createElement(
              Activity,
              { mode: "hidden" },
              createElement(Counter, null),
            )
          : null,
      );
    }

    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);
    flushSync(() => root.render(createElement(App, null)));

    // Queue an update into the hidden subtree: it is downgraded to the
    // offscreen lane, so the root now has pending offscreen work that can only
    // make progress after a reveal.
    const queueHidden = setCount as unknown as (
      updater: (count: number) => number,
    ) => void;
    queueHidden((count) => count + 1);

    // Unmount the hidden Activity before the idle offscreen prerender runs:
    // the fiber carrying the offscreen lane is deleted while still pending.
    flushSync(() => setShow?.(false));
    const rendersAfterUnmount = appRenders;

    // The orphaned offscreen lane must not keep waking the scheduler.
    await delay();
    await delay();
    expect(appRenders).toBe(rendersAfterUnmount);

    // The scheduler is still healthy: a normal update still commits.
    flushSync(() => setOuter?.(5));
    expect(container.textContent).toBe("o5");
  });

  it("still defers updates for a hidden boundary mounted after all others unmount", async () => {
    let setCount: ((updater: (count: number) => number) => void) | null = null;
    let setPhase: ((phase: "first" | "none" | "second") => void) | null = null;

    function Counter() {
      const [count, set] = useState(0);
      setCount = set;
      return createElement("span", null, count);
    }

    function App() {
      const [phase, set] = useState<"first" | "none" | "second">("first");
      setPhase = set;
      if (phase === "none") return createElement("p", null, "idle");
      return createElement(
        Activity,
        { mode: "hidden" },
        createElement(Counter, null),
      );
    }

    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);
    flushSync(() => root.render(createElement(App, null)));

    // Remove every hidden boundary: the internal latch can now reset to false.
    flushSync(() => setPhase?.("none"));
    expect(container.textContent).toBe("idle");

    // Mount a fresh hidden boundary. Its update must still be downgraded to the
    // offscreen lane (committed hidden, not revealed), proving the latch re-arms.
    flushSync(() => setPhase?.("second"));
    const span = container.childNodes[0] as FakeElement;
    expect(display(span)).toBe("none");

    flushSync(() => setCount?.((count) => count + 1));
    expect(container.textContent).toBe("1");
    expect(display(span)).toBe("none");
  });

  it("reveals the latest external store value after it changes while hidden", async () => {
    let value = "a";
    const listeners = new Set<() => void>();
    const store = {
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      getSnapshot: () => value,
      emit: (next: string) => {
        value = next;
        for (const listener of listeners) listener();
      },
    };

    let setMode: ((mode: "visible" | "hidden") => void) | null = null;

    function Display() {
      const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
      return createElement("span", null, snapshot);
    }

    function App() {
      const [mode, set] = useState<"visible" | "hidden">("visible");
      setMode = set;
      return createElement(Activity, { mode }, createElement(Display, null));
    }

    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);
    flushSync(() => root.render(createElement(App, null)));
    expect(container.textContent).toBe("a");
    // Subscription is live while visible.
    expect(listeners.size).toBeGreaterThan(0);

    // Hide: the subscription is torn down so changes do not schedule work.
    flushSync(() => setMode?.("hidden"));
    expect(listeners.size).toBe(0);

    // The store changes while the boundary is hidden and unsubscribed.
    store.emit("b");
    await delay();

    // Reveal: the boundary must show the current store value, not the stale
    // snapshot captured before hiding, and re-subscribe for future changes.
    flushSync(() => setMode?.("visible"));
    expect(container.textContent).toBe("b");
    expect(listeners.size).toBeGreaterThan(0);

    // A post-reveal change schedules normally again.
    store.emit("c");
    await delay();
    expect(container.textContent).toBe("c");
  });
});
