import {
  createElement,
  readPromise,
  Suspense,
  useSyncExternalStore,
  useId,
  useState,
  ViewTransition,
} from "@bgub/fig";
import { prerender, renderToHtml } from "@bgub/fig-server";
import type { DehydratedSuspenseBoundary } from "@bgub/fig-reconciler";
import { describe, expect, it } from "vitest";
import { type Bind, createRoot, flushSync, hydrateRoot, on } from "./index.ts";
import {
  enclosingSuspenseBoundaryStart,
  isWithinSuspenseBoundary,
} from "./suspense-markers.ts";
import {
  deferred,
  waitForHostTurns,
  FakeComment,
  FakeElement,
  FakeText,
  installFakeDocument,
} from "./test-utils.ts";
import { requestPaint } from "../../fig-reconciler/src/scheduler.ts";

installFakeDocument();

function display(node: FakeElement): string {
  return node.style.display ?? "";
}

describe("@bgub/fig-dom hydration", () => {
  it("removes hydration listeners when the root has no dehydrated Suspense boundaries", () => {
    const container = new FakeElement("root");
    const span = new FakeElement("span");
    span.appendChild(new FakeText("Client"));
    container.appendChild(span);

    flushSync(() =>
      hydrateRoot(
        container as unknown as Element,
        createElement("span", null, "Client"),
      ),
    );

    expect(Object.keys(container.listenerSets)).toEqual([]);
  });

  it("hydrates existing host elements without duplicating nodes", () => {
    const container = new FakeElement("root");
    const button = new FakeElement("button");
    button.setAttribute("id", "server");
    button.setAttribute("data-server", "preserve");
    button.style.color = "red";
    button.style.fontWeight = "bold";
    button.appendChild(new FakeText("Client"));
    container.appendChild(button);
    const calls: string[] = [];

    flushSync(() =>
      hydrateRoot(
        container as unknown as Element,
        createElement(
          "button",
          {
            events: [on("click", () => calls.push("click"))],
            id: "client",
          },
          "Client",
        ),
      ),
    );

    expect(container.childNodes).toEqual([button]);
    expect(button.textContent).toBe("Client");
    expect(button.attributes).toEqual({
      "data-server": "preserve",
      id: "client",
    });
    expect(button.style.color).toBe("red");
    expect(button.style.fontWeight).toBe("bold");

    button.dispatch("click");
    expect(calls).toEqual(["click"]);
  });

  it("hydrates trees that render hoisted asset resources", () => {
    const container = new FakeElement("root");
    const div = new FakeElement("div");
    div.appendChild(new FakeText("Hello"));
    container.appendChild(div);

    flushSync(() =>
      hydrateRoot(
        container as unknown as Element,
        createElement(
          "div",
          null,
          createElement("link", {
            href: "/x.css",
            precedence: "app",
            rel: "stylesheet",
          }),
          "Hello",
        ),
      ),
    );

    // The resource fiber must not consume the hydration cursor: the server
    // emitted nothing at its position, so a match attempt would mismatch the
    // root into a client render and replace the server nodes.
    expect(container.childNodes[0]).toBe(div);
    expect(div.textContent).toBe("Hello");
  });

  it("hydrates an SVG title as an in-tree SVG element", () => {
    const container = new FakeElement("root");
    const svg = new FakeElement("svg", "http://www.w3.org/2000/svg");
    const title = new FakeElement("title", "http://www.w3.org/2000/svg");
    title.appendChild(new FakeText("Accessible icon"));
    svg.appendChild(title);
    container.appendChild(svg);
    const head = document.head as unknown as FakeElement;
    const previousHeadChildren = head.childNodes.length;

    flushSync(() =>
      hydrateRoot(
        container as unknown as Element,
        createElement(
          "svg",
          null,
          createElement("title", null, "Accessible icon"),
        ),
      ),
    );

    expect(container.childNodes).toEqual([svg]);
    expect(svg.childNodes).toEqual([title]);
    expect(title.namespaceURI).toBe("http://www.w3.org/2000/svg");
    expect(head.childNodes).toHaveLength(previousHeadChildren);
  });

  it("hydrates around hoisted resources with fresh children", () => {
    const container = new FakeElement("root");
    const div = new FakeElement("div");
    div.appendChild(new FakeText("Hello"));
    container.appendChild(div);

    flushSync(() =>
      hydrateRoot(
        container as unknown as Element,
        createElement(
          "div",
          null,
          createElement("title", null, "Page"),
          "Hello",
        ),
      ),
    );

    // The title's text child renders fresh into the adopted element instead
    // of claiming the server's "Hello" text node.
    expect(container.childNodes[0]).toBe(div);
    expect(div.textContent).toBe("Hello");
  });

  it("preserves pre-hydration select changes for uncontrolled selects", () => {
    const container = new FakeElement("root");
    const select = new FakeElement("select");
    const optionA = new FakeElement("option");
    optionA.setAttribute("value", "a");
    const optionB = new FakeElement("option");
    optionB.setAttribute("value", "b");
    select.appendChild(optionA);
    select.appendChild(optionB);
    container.appendChild(select);

    // The server rendered defaultValue "a", but the user changed the
    // selection to "b" before hydration (selects work without JS).
    optionB.selected = true;

    flushSync(() =>
      hydrateRoot(
        container as unknown as Element,
        createElement(
          "select",
          { defaultValue: "a" },
          createElement("option", { value: "a" }),
          createElement("option", { value: "b" }),
        ),
      ),
    );

    expect(optionA.selected).toBe(false);
    expect(optionB.selected).toBe(true);
  });

  it("warns about server-only attributes preserved during hydration", () => {
    const container = new FakeElement("root");
    const button = new FakeElement("button");
    button.setAttribute("data-server", "extra");
    button.setAttribute("data-fig-resource-key", "internal");
    container.appendChild(button);

    const errors: string[] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => {
      errors.push(args.map(String).join(" "));
    };

    try {
      flushSync(() =>
        hydrateRoot(
          container as unknown as Element,
          createElement("button", { id: "client" }),
        ),
      );
    } finally {
      console.error = originalError;
    }

    expect(errors).toEqual([
      "Hydration preserved extra server attributes or styles on <button>: " +
        "data-server. They were preserved, so this element now differs " +
        "from a pure client render.",
    ]);
  });

  it("suppresses one-level hydration warnings on host elements", () => {
    const container = new FakeElement("root");
    const button = new FakeElement("button");
    button.setAttribute("data-server", "extra");
    container.appendChild(button);

    const errors: string[] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => {
      errors.push(args.map(String).join(" "));
    };

    try {
      flushSync(() =>
        hydrateRoot(
          container as unknown as Element,
          createElement("button", {
            id: "client",
            suppressHydrationWarning: true,
          }),
        ),
      );
    } finally {
      console.error = originalError;
    }

    expect(button.attributes["data-server"]).toBe("extra");
    expect(button.attributes.suppressHydrationWarning).toBeUndefined();
    expect(errors).toEqual([]);
  });

  it("does not suppress hydration warnings on descendants", () => {
    const container = new FakeElement("root");
    const div = new FakeElement("div");
    const span = new FakeElement("span");
    span.setAttribute("data-server", "extra");
    div.appendChild(span);
    container.appendChild(div);

    const errors: string[] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => {
      errors.push(args.map(String).join(" "));
    };

    try {
      flushSync(() =>
        hydrateRoot(
          container as unknown as Element,
          createElement(
            "div",
            { suppressHydrationWarning: true },
            createElement("span", { id: "client" }),
          ),
        ),
      );
    } finally {
      console.error = originalError;
    }

    expect(errors).toEqual([
      "Hydration preserved extra server attributes or styles on <span>: " +
        "data-server. They were preserved, so this element now differs " +
        "from a pure client render.",
    ]);
  });

  it("does not warn about attributes set by a bind during hydration", () => {
    const container = new FakeElement("root");
    const button = new FakeElement("button");
    container.appendChild(button);

    const errors: string[] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => {
      errors.push(args.map(String).join(" "));
    };

    const bind: Bind = (node, signal) => {
      node.setAttribute("data-bound", "true");
      signal.addEventListener(
        "abort",
        () => node.removeAttribute("data-bound"),
        { once: true },
      );
    };

    try {
      flushSync(() =>
        hydrateRoot(
          container as unknown as Element,
          createElement("button", { bind }),
        ),
      );
    } finally {
      console.error = originalError;
    }

    expect(button.attributes["data-bound"]).toBe("true");
    expect(errors).toEqual([]);
  });

  it("patches hydrated styles without deleting server-only styles", () => {
    const container = new FakeElement("root");
    const button = new FakeElement("button");
    button.style.color = "red";
    button.style.fontWeight = "bold";
    container.appendChild(button);
    const errors: string[] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => {
      errors.push(args.map(String).join(" "));
    };

    try {
      flushSync(() =>
        hydrateRoot(
          container as unknown as Element,
          createElement("button", {
            style: { color: "blue" },
          }),
        ),
      );
    } finally {
      console.error = originalError;
    }

    expect(container.childNodes).toEqual([button]);
    expect(button.style.color).toBe("blue");
    expect(button.style.fontWeight).toBe("bold");
    expect(errors).toEqual([
      "Hydration preserved extra server attributes or styles on <button>: " +
        "style.fontWeight. They were preserved, so this element now differs " +
        "from a pure client render.",
    ]);
  });

  it("keeps hydrated host text content after a same-value update", () => {
    const container = new FakeElement("root");
    const span = new FakeElement("span");
    span.appendChild(new FakeText("Hello"));
    container.appendChild(span);
    let root: ReturnType<typeof hydrateRoot> | undefined;

    flushSync(() => {
      root = hydrateRoot(
        container as unknown as Element,
        createElement("span", null, "Hello"),
      );
    });
    flushSync(() => root?.render(createElement("span", null, "Hello")));

    expect(container.childNodes).toEqual([span]);
    expect(span.textContent).toBe("Hello");
    expect(span.childNodes).toHaveLength(1);
  });

  it("uses server external-store snapshots during hydration", async () => {
    const container = new FakeElement("root");
    const span = new FakeElement("span");
    span.appendChild(new FakeText("Server"));
    container.appendChild(span);
    const listeners = new Set<() => void>();
    const value = "Client";

    const subscribe = (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    };

    function App() {
      const snapshot = useSyncExternalStore(
        subscribe,
        () => value,
        () => "Server",
      );
      return createElement("span", null, snapshot);
    }

    flushSync(() =>
      hydrateRoot(container as unknown as Element, createElement(App, null)),
    );

    expect(container.childNodes).toEqual([span]);
    expect(span.textContent).toBe("Server");

    await waitForHostTurns();

    expect(container.childNodes).toEqual([span]);
    expect(span.textContent).toBe("Client");
  });

  it("generates matching ids during hydration", () => {
    const container = new FakeElement("root");
    const label = new FakeElement("label");
    const input = new FakeElement("input");
    label.setAttribute("for", "hydr-fig-0-0");
    input.setAttribute("id", "hydr-fig-0-0");
    label.appendChild(new FakeText("Name"));
    label.appendChild(input);
    container.appendChild(label);

    function Field() {
      const id = useId();

      return createElement(
        "label",
        { for: id },
        "Name",
        createElement("input", { id }),
      );
    }

    flushSync(() =>
      hydrateRoot(container as unknown as Element, createElement(Field, null), {
        identifierPrefix: "hydr-",
      }),
    );

    expect(container.childNodes).toEqual([label]);
    expect(label.attributes.for).toBe("hydr-fig-0-0");
    expect(input.attributes.id).toBe("hydr-fig-0-0");
  });

  it("runs binds for hydrated host elements", () => {
    const container = new FakeElement("root");
    const input = new FakeElement("input");
    const calls: Array<[FakeElement, AbortSignal]> = [];
    const bind: Bind = (node, signal) => {
      calls.push([node as unknown as FakeElement, signal]);
    };
    container.appendChild(input);

    flushSync(() =>
      hydrateRoot(
        container as unknown as Element,
        createElement("input", {
          bind,
        }),
      ),
    );

    expect(container.childNodes).toEqual([input]);
    // First-time binds strict-run twice in development.
    expect(calls).toHaveLength(2);
    expect(calls[0][0]).toBe(input);
    expect(calls[0][1].aborted).toBe(true);
    expect(calls[1][0]).toBe(input);
    expect(calls[1][1].aborted).toBe(false);
  });

  // These cases build the container by PARSING real server output, so the
  // browser's text-node merging is exercised: adjacent text from different
  // fibers reads back as one DOM text node unless the server separates it.

  it("hydrates parsed server output where text meets component text", async () => {
    function Name() {
      return "Ben";
    }

    const app = createElement("div", null, "Hi ", createElement(Name, null));
    const container = containerFromHtml(await renderToHtml(app));
    const server = container.childNodes[0];
    const recoverable = captureRecoverableErrors();

    flushSync(() =>
      hydrateRoot(container as unknown as Element, app, {
        onRecoverableError: recoverable.capture,
      }),
    );

    expect(recoverable.errors).toEqual([]);
    // The server DOM was claimed, not wiped and client re-rendered.
    expect(container.childNodes[0]).toBe(server);
    expect(container.textContent).toBe("Hi Ben");
  });

  it("hydrates parsed server output around a component that renders nothing", async () => {
    function Nothing() {
      return null;
    }

    const app = createElement(
      "div",
      null,
      "a",
      createElement(Nothing, null),
      "b",
    );
    const container = containerFromHtml(await renderToHtml(app));
    const server = container.childNodes[0];
    const recoverable = captureRecoverableErrors();

    flushSync(() =>
      hydrateRoot(container as unknown as Element, app, {
        onRecoverableError: recoverable.capture,
      }),
    );

    expect(recoverable.errors).toEqual([]);
    expect(container.childNodes[0]).toBe(server);
    expect(container.textContent).toBe("ab");
  });

  it("hydrates text seams around a resolved promise child", async () => {
    const pending = deferred<string>();
    const app = createElement(
      "div",
      null,
      "Before ",
      pending.promise,
      " after",
    );
    const rendering = prerender(app);
    await Promise.resolve();
    pending.resolve("middle");

    const { html } = await rendering;
    const container = containerFromHtml(html);
    const server = container.childNodes[0];
    const recoverable = captureRecoverableErrors();

    flushSync(() =>
      hydrateRoot(container as unknown as Element, app, {
        onRecoverableError: recoverable.capture,
      }),
    );

    expect(recoverable.errors).toEqual([]);
    expect(container.childNodes[0]).toBe(server);
    expect(container.textContent).toBe("Before middle after");
  });

  it("keeps useId paths stable after an empty promise child", async () => {
    const pending = deferred<null>();
    const ids: string[] = [];

    function IdentifiedChild() {
      const id = useId();
      ids.push(id);
      return createElement("span", { id }, "child");
    }

    const app = createElement(
      "div",
      null,
      pending.promise,
      createElement(IdentifiedChild, null),
    );
    const rendering = prerender(app);
    await Promise.resolve();
    pending.resolve(null);

    const { html } = await rendering;
    const container = containerFromHtml(html);
    const serverId = (
      (container.childNodes[0] as FakeElement).childNodes[0] as FakeElement
    ).attributes.id;
    ids.length = 0;
    const recoverable = captureRecoverableErrors();

    flushSync(() =>
      hydrateRoot(container as unknown as Element, app, {
        onRecoverableError: recoverable.capture,
      }),
    );

    expect(recoverable.errors).toEqual([]);
    expect(ids).not.toHaveLength(0);
    expect(ids.every((id) => id === serverId)).toBe(true);
  });

  it("hydrates parsed server output with text seams beside Suspense", async () => {
    function Name() {
      return "Ben";
    }

    const app = [
      "Hi ",
      createElement(Name, null),
      createElement(
        Suspense,
        { fallback: "Loading" },
        createElement("p", null, "Content"),
      ),
      "After",
    ];
    const { html } = await prerender(app);
    const container = containerFromHtml(html);
    const recoverable = captureRecoverableErrors();

    flushSync(() =>
      hydrateRoot(container as unknown as Element, app, {
        onRecoverableError: recoverable.capture,
      }),
    );
    // Cursor skipping must not swallow the boundary's own marker comments.
    await waitForHostTurns();

    expect(recoverable.errors).toEqual([]);
    expect(container.textContent).toBe("Hi BenContentAfter");
  });

  it("hydrates parsed single-text content without separators", async () => {
    const app = createElement("div", null, "only");
    const html = await renderToHtml(app);
    expect(html).toBe("<div>only</div>");

    const container = containerFromHtml(html);
    const server = container.childNodes[0];
    const recoverable = captureRecoverableErrors();

    flushSync(() =>
      hydrateRoot(container as unknown as Element, app, {
        onRecoverableError: recoverable.capture,
      }),
    );

    expect(recoverable.errors).toEqual([]);
    expect(container.childNodes[0]).toBe(server);
    expect(container.textContent).toBe("only");
  });

  it("hydrates component children followed by host siblings", () => {
    const container = new FakeElement("root");
    const span = new FakeElement("span");
    const paragraph = new FakeElement("p");

    span.appendChild(new FakeText("Component"));
    paragraph.appendChild(new FakeText("Sibling"));
    container.appendChild(span);
    container.appendChild(paragraph);

    function Label() {
      return createElement("span", null, "Component");
    }

    flushSync(() =>
      hydrateRoot(container as unknown as Element, [
        createElement(Label, null),
        createElement("p", null, "Sibling"),
      ]),
    );

    expect(container.childNodes).toEqual([span, paragraph]);
    expect(container.textContent).toBe("ComponentSibling");
  });

  it("selectively hydrates completed Suspense boundaries on interaction", () => {
    const {
      container,
      content: button,
      end,
      start,
    } = suspenseDom("completed", "button", "Client");
    const calls: string[] = [];

    flushSync(() =>
      hydrateRoot(
        container as unknown as Element,
        createElement(
          Suspense,
          { fallback: createElement("span", null, "Loading") },
          createElement(
            "button",
            { events: [on("click", () => calls.push("click"))] },
            "Client",
          ),
        ),
      ),
    );

    expect(container.childNodes).toEqual([start, button, end]);
    expect(button.textContent).toBe("Client");

    button.dispatch("click");

    expect(container.childNodes).toEqual([button]);
    expect(button.textContent).toBe("Client");
    expect(calls).toEqual(["click"]);
  });

  it("hydrates completed Suspense boundaries in background work", async () => {
    const { container, content: button } = suspenseDom(
      "completed",
      "button",
      "Client",
    );
    const calls: string[] = [];

    flushSync(() =>
      hydrateRoot(
        container as unknown as Element,
        createElement(
          Suspense,
          { fallback: createElement("span", null, "Loading") },
          createElement(
            "button",
            { events: [on("click", () => calls.push("click"))] },
            "Client",
          ),
        ),
      ),
    );

    expect(container.listenerSets.mousemove).toHaveLength(1);

    await waitForHostTurns();

    expect(container.listenerSets.mousemove).toBeUndefined();
    expect(container.childNodes).toEqual([button]);
    expect(button.textContent).toBe("Client");

    button.dispatch("click");
    expect(calls).toEqual(["click"]);
  });

  it("restarts interrupted completed Suspense hydration without root DOM loss", async () => {
    const shell = element("span", "Shell 0");
    const {
      content: button,
      end,
      start,
    } = suspenseDom("completed", "button", "Client");
    const container = new FakeElement("root");
    const recoverable = captureRecoverableErrors();
    let setShell: ((updater: (count: number) => number) => void) | null = null;
    let shouldYield = false;
    let resolveFlushed: () => void = () => undefined;
    const flushed = new Promise<void>((resolve) => {
      resolveFlushed = resolve;
    });

    container.appendChild(shell);
    container.appendChild(start);
    container.appendChild(button);
    container.appendChild(end);

    function Yielding() {
      if (shouldYield) {
        shouldYield = false;
        requestPaint();
        queueMicrotask(() => {
          flushSync(() => setShell?.((count) => count + 1));
          resolveFlushed();
        });
      }
      return null;
    }

    function App() {
      const [count, setCount] = useState(0);
      setShell = setCount;
      return [
        createElement("span", null, `Shell ${count}`),
        createElement(
          Suspense,
          { fallback: createElement("span", null, "Loading") },
          createElement(
            "button",
            null,
            createElement(Yielding, null),
            "Client",
          ),
        ),
      ];
    }

    flushSync(() =>
      hydrateRoot(container as unknown as Element, createElement(App, null), {
        onRecoverableError: recoverable.capture,
      }),
    );

    shouldYield = true;
    await flushed;
    await waitForHostTurns();

    expect(container.textContent).toBe("Shell 1Client");
    expect(recoverable.messages()).toEqual([]);
  });

  it("preserves hydrated Suspense primary content across re-suspension", async () => {
    const { container, content: button } = suspenseDom(
      "completed",
      "button",
      "PONE",
    );
    button.textContent = "";
    button.appendChild(new FakeText("P"));
    button.appendChild(new FakeText("ONE"));
    let setGate: ((value: string | Promise<string>) => void) | null = null;

    function Slow({ value }: { value: string | Promise<string> }) {
      return typeof value === "string" ? value : readPromise(value);
    }

    function App() {
      const [gate, set] = useState<string | Promise<string>>("ONE");
      setGate = set;
      return createElement(
        Suspense,
        { fallback: createElement("span", null, "Loading") },
        createElement(
          "button",
          null,
          "P",
          createElement(Slow, { value: gate }),
        ),
      );
    }

    flushSync(() =>
      hydrateRoot(container as unknown as Element, createElement(App, null)),
    );

    await waitForHostTurns();
    expect(container.childNodes).toHaveLength(1);
    expect(container.childNodes[0]).toBe(button);
    expect(button.textContent).toBe("PONE");

    const second = deferred<string>();
    flushSync(() => setGate?.(second.promise));

    const fallback = container.childNodes[1] as FakeElement;
    expect(container.childNodes).toEqual([button, fallback]);
    expect(display(button)).toBe("none");
    expect(fallback.textContent).toBe("Loading");

    second.resolve("TWO");
    await waitForHostTurns();
    expect(container.childNodes).toHaveLength(1);
    expect(container.childNodes[0]).toBe(button);
    expect(display(button)).toBe("");
    expect(button.textContent).toBe("PTWO");
  });

  it("keeps completed Suspense boundaries dehydrated when hydration suspends", async () => {
    const { container, content, end, start } = suspenseDom(
      "completed",
      "button",
      "Server",
    );
    let resolve: (value: string) => void = () => undefined;
    const promise = new Promise<string>((done) => {
      resolve = done;
    });
    const errors: string[] = [];

    function Content() {
      return createElement("button", null, readPromise(promise));
    }

    flushSync(() =>
      hydrateRoot(
        container as unknown as Element,
        createElement(
          Suspense,
          { fallback: createElement("span", null, "Loading") },
          createElement(Content, null),
        ),
        {
          onRecoverableError(error) {
            errors.push((error as Error).message);
          },
        },
      ),
    );

    await waitForHostTurns();

    expect(container.childNodes).toEqual([start, content, end]);
    expect(content.textContent).toBe("Server");
    expect(errors).toEqual([]);

    resolve("Server");
    await waitForHostTurns();

    expect(container.childNodes).toEqual([content]);
    expect(content.textContent).toBe("Server");
    expect(errors).toEqual([]);
  });

  it("does not animate ViewTransition boundaries hydrated by a retry", async () => {
    const { container, content } = suspenseDom("completed", "button", "Server");
    let resolve: (value: string) => void = () => undefined;
    const promise = new Promise<string>((done) => {
      resolve = done;
    });
    let starts = 0;
    // Retries ride retry lanes, which are view-transition eligible so client
    // reveals animate — but a retry that finishes HYDRATION adopts pixels
    // that are already on screen and must not play an enter animation.
    (
      document as unknown as {
        startViewTransition?: (update: () => void) => {
          finished: Promise<unknown>;
          ready: Promise<unknown>;
        };
      }
    ).startViewTransition = (update) => {
      starts += 1;
      update();
      return { finished: Promise.resolve(), ready: Promise.resolve() };
    };

    function Content() {
      const value = readPromise(promise);
      return createElement(
        ViewTransition,
        { enter: "reveal", name: "card" },
        createElement("button", null, value),
      );
    }

    flushSync(() =>
      hydrateRoot(
        container as unknown as Element,
        createElement(
          Suspense,
          { fallback: createElement("span", null, "Loading") },
          createElement(Content, null),
        ),
      ),
    );

    await waitForHostTurns();
    resolve("Server");
    await waitForHostTurns();

    expect(container.textContent).toBe("Server");
    expect(content.textContent).toBe("Server");
    expect(starts).toBe(0);
  });

  it("keeps pending Suspense boundaries dehydrated when interaction selects them", () => {
    const {
      container,
      content: fallback,
      end,
      placeholder,
      start,
    } = suspenseDom("pending", "button", "Loading");

    flushSync(() =>
      hydrateRoot(
        container as unknown as Element,
        createElement(
          Suspense,
          { fallback: createElement("button", null, "Loading") },
          createElement("button", null, "Client"),
        ),
      ),
    );

    fallback.dispatch("click");

    expect(container.childNodes).toEqual([start, placeholder, fallback, end]);
    expect(container.textContent).toBe("Loading");
  });

  it("keeps pending Suspense boundaries dehydrated when continuous events select them", async () => {
    const {
      container,
      content: fallback,
      end,
      placeholder,
      start,
    } = suspenseDom("pending", "button", "Loading");

    flushSync(() =>
      hydrateRoot(
        container as unknown as Element,
        createElement(
          Suspense,
          { fallback: createElement("button", null, "Loading") },
          createElement("button", null, "Client"),
        ),
      ),
    );

    fallback.dispatch("mousemove");
    await waitForHostTurns();

    expect(container.listenerSets.mousemove).toHaveLength(1);
    expect(container.childNodes).toEqual([start, placeholder, fallback, end]);
    expect(container.textContent).toBe("Loading");
  });

  it("replays blocked clicks after pending Suspense boundaries hydrate", async () => {
    const boundary = suspenseDom("pending", "button", "Loading");
    const container = new FakeElement("root");
    const parent = new FakeElement("section");
    const calls: string[] = [];

    container.appendChild(parent);
    parent.appendChild(boundary.start);
    if (boundary.placeholder !== null) parent.appendChild(boundary.placeholder);
    parent.appendChild(boundary.content);
    parent.appendChild(boundary.end);

    flushSync(() =>
      hydrateRoot(
        container as unknown as Element,
        createElement(
          "section",
          { events: [on("click", () => calls.push("parent"))] },
          createElement(
            Suspense,
            { fallback: createElement("button", null, "Loading") },
            createElement(
              "button",
              {
                events: [
                  on("click", (event) => {
                    calls.push(
                      `child:${(event.currentTarget as unknown as FakeElement).tagName}`,
                    );
                    event.stopPropagation();
                  }),
                ],
              },
              "Client",
            ),
          ),
        ),
      ),
    );

    boundary.content.dispatch("click");
    expect(calls).toEqual([]);

    boundary.content.textContent = "Client";
    completePendingBoundary(parent, boundary);

    await waitForHostTurns();

    expect(parent.childNodes).toEqual([boundary.content]);
    expect(boundary.content.textContent).toBe("Client");
    expect(calls).toEqual(["child:button"]);
  });

  it("resolves the targeted boundary without scanning unrelated dehydrated boundaries", async () => {
    const first = suspenseDom("pending", "span", "First loading");
    const second = suspenseDom("pending", "button", "Second loading");
    second.start.data = "fig:suspense:pending:1";
    const container = new FakeElement("root");
    const parent = new FakeElement("section");
    const calls: string[] = [];

    container.appendChild(parent);
    for (const boundary of [first, second]) {
      parent.appendChild(boundary.start);
      if (boundary.placeholder !== null) {
        parent.appendChild(boundary.placeholder);
      }
      parent.appendChild(boundary.content);
      parent.appendChild(boundary.end);
    }

    flushSync(() =>
      hydrateRoot(
        container as unknown as Element,
        createElement(
          "section",
          null,
          createElement(
            Suspense,
            { fallback: createElement("span", null, "First loading") },
            createElement("span", null, "First done"),
          ),
          createElement(
            Suspense,
            { fallback: createElement("button", null, "Second loading") },
            createElement(
              "button",
              { events: [on("click", () => calls.push("second"))] },
              "Second done",
            ),
          ),
        ),
      ),
    );

    // Blocked-boundary lookup walks the markers around the target; reading
    // an unrelated boundary's children means it regressed to tree scanning.
    let firstContentReads = 0;
    const firstContentChildren = first.content.childNodes;
    Object.defineProperty(first.content, "childNodes", {
      configurable: true,
      get() {
        firstContentReads += 1;
        return firstContentChildren;
      },
    });

    second.content.dispatch("click");
    expect(calls).toEqual([]);

    second.content.textContent = "Second done";
    completePendingBoundary(parent, second);

    await waitForHostTurns();

    expect(calls).toEqual(["second"]);
    expect(firstContentReads).toBe(0);
    // The untargeted boundary is untouched and still dehydrated.
    expect(parent.childNodes.slice(0, 3)).toEqual([
      first.start,
      first.placeholder,
      first.content,
    ]);
  });

  it("replays blocked clicks when a completed pending boundary preserves the fallback target", async () => {
    const boundary = suspenseDom("pending", "button", "Pending target");
    const container = new FakeElement("root");
    const parent = new FakeElement("section");
    const calls: string[] = [];

    container.appendChild(parent);
    parent.appendChild(boundary.start);
    if (boundary.placeholder !== null) parent.appendChild(boundary.placeholder);
    parent.appendChild(boundary.content);
    parent.appendChild(boundary.end);

    flushSync(() =>
      hydrateRoot(
        container as unknown as Element,
        createElement(
          "section",
          { events: [on("click", () => calls.push("parent"))] },
          createElement(
            Suspense,
            { fallback: createElement("button", null, "Pending target") },
            createElement(
              "button",
              {
                events: [
                  on("click", (event) => {
                    calls.push("child");
                    event.stopPropagation();
                  }),
                ],
              },
              "Hydrated target",
            ),
          ),
        ),
      ),
    );

    boundary.content.dispatch("click");
    expect(calls).toEqual([]);

    completePendingBoundary(parent, boundary);

    await waitForHostTurns();

    expect(parent.childNodes).toEqual([boundary.content]);
    expect(boundary.content.textContent).toBe("Hydrated target");
    expect(calls).toEqual(["child"]);
  });

  it("resolves selective hydration per root for nested hydrated roots", async () => {
    const outerContainer = new FakeElement("root");
    const section = new FakeElement("section");
    section.appendChild(new FakeText("Outer"));
    outerContainer.appendChild(section);
    const calls: string[] = [];

    flushSync(() =>
      hydrateRoot(
        outerContainer as unknown as Element,
        createElement("section", null, "Outer"),
      ),
    );

    // A nested app hydrates later inside the outer root's DOM.
    const innerContainer = new FakeElement("div");
    const boundary = suspenseDom("pending", "button", "Loading");
    outerContainer.appendChild(innerContainer);
    innerContainer.appendChild(boundary.start);
    if (boundary.placeholder !== null) {
      innerContainer.appendChild(boundary.placeholder);
    }
    innerContainer.appendChild(boundary.content);
    innerContainer.appendChild(boundary.end);

    flushSync(() =>
      hydrateRoot(
        innerContainer as unknown as Element,
        createElement(
          Suspense,
          { fallback: createElement("button", null, "Loading") },
          createElement(
            "button",
            { events: [on("click", () => calls.push("inner"))] },
            "Client",
          ),
        ),
      ),
    );

    // The outer root's capture listener sees the click first and resolves
    // "none" against its own tree; that must not shadow the inner root's
    // "blocked" decision for the same native event.
    boundary.content.dispatch("click");
    expect(calls).toEqual([]);

    boundary.content.textContent = "Client";
    completePendingBoundary(innerContainer, boundary);
    await waitForHostTurns();

    expect(calls).toEqual(["inner"]);
  });

  it("tears down hydration listeners and queued events on unmount", () => {
    const boundary = suspenseDom("pending", "button", "Loading");
    const container = new FakeElement("root");
    const calls: string[] = [];

    container.appendChild(boundary.start);
    if (boundary.placeholder !== null) {
      container.appendChild(boundary.placeholder);
    }
    container.appendChild(boundary.content);
    container.appendChild(boundary.end);

    let root: ReturnType<typeof hydrateRoot> | undefined;
    flushSync(() => {
      root = hydrateRoot(
        container as unknown as Element,
        createElement(
          Suspense,
          { fallback: createElement("button", null, "Loading") },
          createElement(
            "button",
            { events: [on("click", () => calls.push("click"))] },
            "Client",
          ),
        ),
      );
    });

    expect(Object.keys(container.listenerSets)).not.toHaveLength(0);

    // Blocked by the pending boundary: the click queues for replay.
    boundary.content.dispatch("click");
    expect(calls).toEqual([]);

    boundary.content.textContent = "Client";
    root?.unmount();

    // Every root listener (hydration capture listeners and delegated slot
    // listeners) is removed with the root.
    expect(Object.keys(container.listenerSets)).toHaveLength(0);
  });

  it("replays queued events in input order within a root", async () => {
    const first = suspenseDom("pending", "button", "LoadingA");
    const second = suspenseDom("pending", "button", "LoadingB");
    second.start.data = "fig:suspense:pending:1";
    const container = new FakeElement("root");
    const calls: string[] = [];

    for (const boundary of [first, second]) {
      container.appendChild(boundary.start);
      if (boundary.placeholder !== null) {
        container.appendChild(boundary.placeholder);
      }
      container.appendChild(boundary.content);
      container.appendChild(boundary.end);
    }

    flushSync(() =>
      hydrateRoot(container as unknown as Element, [
        createElement(
          Suspense,
          { fallback: createElement("button", null, "LoadingA"), key: "a" },
          createElement(
            "button",
            { events: [on("keydown", () => calls.push("keydown"))] },
            "ClientA",
          ),
        ),
        createElement(
          Suspense,
          { fallback: createElement("button", null, "LoadingB"), key: "b" },
          createElement(
            "button",
            { events: [on("click", () => calls.push("click"))] },
            "Client",
          ),
        ),
      ]),
    );

    first.content.dispatch("keydown");
    second.content.dispatch("click");
    expect(calls).toEqual([]);

    // The second boundary completes first: its click must wait for the
    // still-blocked keydown so replayed input keeps its order.
    second.content.textContent = "Client";
    completePendingBoundary(container, second);
    await waitForHostTurns();
    expect(calls).toEqual([]);

    first.content.textContent = "ClientA";
    completePendingBoundary(container, first);
    await waitForHostTurns();
    expect(calls).toEqual(["keydown", "click"]);
  });

  it("replays events despite third-party propagation state", async () => {
    const boundary = suspenseDom("pending", "button", "Loading");
    const container = new FakeElement("root");
    const calls: string[] = [];

    container.appendChild(boundary.start);
    if (boundary.placeholder !== null) {
      container.appendChild(boundary.placeholder);
    }
    container.appendChild(boundary.content);
    container.appendChild(boundary.end);

    // A non-Fig listener stops propagation during the original (blocked)
    // dispatch, leaving cancelBubble set on the spent native event.
    boundary.content.addEventListener("click", (event) =>
      event.stopPropagation(),
    );

    flushSync(() =>
      hydrateRoot(
        container as unknown as Element,
        createElement(
          Suspense,
          { fallback: createElement("button", null, "Loading") },
          createElement(
            "button",
            {
              events: [
                on("click", (event) =>
                  calls.push(`replayed:${event.cancelBubble}`),
                ),
              ],
            },
            "Client",
          ),
        ),
      ),
    );

    boundary.content.dispatch("click");
    expect(calls).toEqual([]);

    boundary.content.textContent = "Client";
    completePendingBoundary(container, boundary);
    await waitForHostTurns();

    // The replay tracks its own propagation state: the stale cancelBubble
    // must not drop the replayed handlers, and handler-visible reads of
    // event.cancelBubble must reflect the replay, not the spent dispatch.
    expect(calls).toEqual(["replayed:false"]);
  });

  it("honors legacy cancelBubble assignment during replay", async () => {
    const boundary = suspenseDom("pending", "button", "Loading");
    const container = new FakeElement("root");
    const parent = new FakeElement("section");
    const calls: string[] = [];

    container.appendChild(parent);
    parent.appendChild(boundary.start);
    if (boundary.placeholder !== null) {
      parent.appendChild(boundary.placeholder);
    }
    parent.appendChild(boundary.content);
    parent.appendChild(boundary.end);

    // Stale propagation state from before the event was queued.
    boundary.content.addEventListener("click", (event) =>
      event.stopPropagation(),
    );

    flushSync(() =>
      hydrateRoot(
        container as unknown as Element,
        createElement(
          "section",
          { events: [on("click", () => calls.push("parent"))] },
          createElement(
            Suspense,
            { fallback: createElement("button", null, "Loading") },
            createElement(
              "button",
              {
                events: [
                  on("click", (event) => {
                    calls.push("child");
                    // Legacy property assignment must stop the parent even
                    // though the spent event's cancelBubble is already true.
                    event.cancelBubble = true;
                  }),
                ],
              },
              "Client",
            ),
          ),
        ),
      ),
    );

    boundary.content.dispatch("click");
    expect(calls).toEqual([]);

    boundary.content.textContent = "Client";
    completePendingBoundary(parent, boundary);
    await waitForHostTurns();

    expect(calls).toEqual(["child"]);
  });

  it("does not replay hydrate-only events after pending Suspense hydrates", async () => {
    const boundary = suspenseDom("pending", "textarea", "Loading");
    const calls: string[] = [];

    flushSync(() =>
      hydrateRoot(
        boundary.container as unknown as Element,
        createElement(
          Suspense,
          { fallback: createElement("textarea", null, "Loading") },
          createElement(
            "textarea",
            { events: [on("input", () => calls.push("input"))] },
            "Client",
          ),
        ),
      ),
    );

    boundary.content.dispatch("input");
    expect(calls).toEqual([]);

    boundary.content.textContent = "Client";
    completePendingBoundary(boundary.container, boundary);

    await waitForHostTurns();

    expect(boundary.container.childNodes).toEqual([boundary.content]);
    expect(boundary.content.textContent).toBe("Client");
    expect(calls).toEqual([]);
  });

  it("hydrates pending Suspense boundaries after the server completes them", async () => {
    const {
      container,
      content: fallback,
      end,
      placeholder,
      start,
    } = suspenseDom("pending", "button", "Loading");
    const calls: string[] = [];

    flushSync(() =>
      hydrateRoot(
        container as unknown as Element,
        createElement(
          Suspense,
          { fallback: createElement("button", null, "Loading") },
          createElement(
            "button",
            { events: [on("click", () => calls.push("click"))] },
            "Client",
          ),
        ),
      ),
    );

    fallback.dispatch("click");

    const serverContent = element("button", "Client");
    if (placeholder === null) throw new Error("Expected pending placeholder.");
    start.data = "fig:suspense:completed";
    container.removeChild(placeholder);
    container.removeChild(fallback);
    container.insertBefore(serverContent, end);
    (start as RetriableFakeComment).__figRetry?.();

    await waitForHostTurns();

    expect(container.childNodes).toEqual([serverContent]);
    expect(serverContent.textContent).toBe("Client");
    expect(calls).toEqual([]);

    serverContent.dispatch("click");

    expect(calls).toEqual(["click"]);
  });

  it("client-renders server-recovered Suspense boundaries in background work", async () => {
    const {
      container,
      content: fallback,
      placeholder,
    } = suspenseDom("client-rendered", "button", "Loading");
    const calls: string[] = [];
    const recoverable = captureRecoverableErrors();
    if (placeholder === null) throw new Error("Expected client placeholder.");
    placeholder.dataset.dgst = "digest-1";
    placeholder.dataset.msg = "Server failed";

    flushSync(() =>
      hydrateRoot(
        container as unknown as Element,
        createElement(
          Suspense,
          { fallback: createElement("button", null, "Loading") },
          createElement(
            "button",
            { events: [on("click", () => calls.push("click"))] },
            "Client",
          ),
        ),
        { onRecoverableError: recoverable.capture },
      ),
    );

    expect(container.textContent).toBe("Loading");

    await waitForHostTurns();

    expect(container.childNodes).toHaveLength(1);
    expect(container.childNodes[0]).not.toBe(fallback);
    expect(container.textContent).toBe("Client");

    (container.childNodes[0] as FakeElement).dispatch("click");
    expect(calls).toEqual(["click"]);
    expect((recoverable.errors[0] as Error).message).toBe("Server failed");
    expect((recoverable.errors[0] as Error & { digest?: string }).digest).toBe(
      "digest-1",
    );
    expect(recoverable.infos[0]).toMatchObject({
      digest: "digest-1",
      recovery: "suspense",
      source: "server",
    });
    expect(
      (recoverable.infos[0] as { componentStack?: string }).componentStack,
    ).toContain("at Suspense");
  });

  it("client-renders pending Suspense boundaries when the server marks them recovered", async () => {
    const {
      container,
      content: fallback,
      end,
      placeholder,
      start,
    } = suspenseDom("pending", "button", "Loading");
    const recoverable = captureRecoverableErrors();
    if (placeholder === null) throw new Error("Expected pending placeholder.");

    flushSync(() =>
      hydrateRoot(
        container as unknown as Element,
        createElement(
          Suspense,
          { fallback: createElement("button", null, "Loading") },
          createElement("button", null, "Client"),
        ),
        { onRecoverableError: recoverable.capture },
      ),
    );

    start.data = "fig:suspense:client";
    placeholder.dataset.msg = "Server failed after shell";
    (start as RetriableFakeComment).__figRetry?.();

    await waitForHostTurns();

    expect(container.childNodes).toHaveLength(1);
    expect(container.childNodes).not.toEqual([
      start,
      placeholder,
      fallback,
      end,
    ]);
    expect(container.textContent).toBe("Client");
    expect((recoverable.errors[0] as Error).message).toBe(
      "Server failed after shell",
    );
    expect(recoverable.infos[0]).toMatchObject({
      recovery: "suspense",
      source: "server",
    });
  });

  it("leaves pending Suspense boundaries dehydrated during background work", async () => {
    const {
      container,
      content: fallback,
      end,
      placeholder,
      start,
    } = suspenseDom("pending", "span", "Loading");

    flushSync(() =>
      hydrateRoot(
        container as unknown as Element,
        createElement(
          Suspense,
          { fallback: createElement("span", null, "Loading") },
          createElement("span", null, "Client"),
        ),
      ),
    );

    await waitForHostTurns();

    expect(container.childNodes).toEqual([start, placeholder, fallback, end]);
    expect(container.textContent).toBe("Loading");
  });

  it("does not hydrate completed Suspense boundaries during unrelated updates", () => {
    const {
      container,
      content: fallback,
      end,
      placeholder,
      start,
    } = suspenseDom("pending", "span", "Loading");
    const shell = new FakeElement("button");
    shell.appendChild(new FakeText("Shell 0"));
    container.insertBefore(shell, start);
    let increment: (() => void) | null = null;

    function App() {
      const [count, setCount] = useState(0);
      increment = () => setCount((value) => value + 1);

      return [
        createElement("button", null, `Shell ${count}`),
        createElement(
          Suspense,
          { fallback: createElement("span", null, "Loading") },
          createElement("span", null, "Client"),
        ),
      ];
    }

    flushSync(() =>
      hydrateRoot(container as unknown as Element, createElement(App)),
    );

    start.data = "fig:suspense:completed";

    flushSync(() => increment?.());

    expect(container.childNodes).toEqual([
      shell,
      start,
      placeholder,
      fallback,
      end,
    ]);
    expect(shell.textContent).toBe("Shell 1");
    expect(fallback.textContent).toBe("Loading");
  });

  it("recovers Suspense hydration mismatches at the boundary", () => {
    const container = new FakeElement("root");
    const before = element("p", "Before");
    const after = element("p", "After");
    const {
      content: server,
      end,
      start,
    } = suspenseDom("completed", "span", "Server");
    const recoverable = captureRecoverableErrors();

    container.appendChild(before);
    container.appendChild(start);
    container.appendChild(server);
    container.appendChild(end);
    container.appendChild(after);

    flushSync(() =>
      hydrateRoot(
        container as unknown as Element,
        [
          createElement("p", null, "Before"),
          createElement(
            Suspense,
            { fallback: createElement("span", null, "Loading") },
            createElement("div", null, "Client"),
          ),
          createElement("p", null, "After"),
        ],
        { onRecoverableError: recoverable.capture },
      ),
    );

    server.dispatch("click");

    expect(container.childNodes[0]).toBe(before);
    expect(container.childNodes.at(-1)).toBe(after);
    expect(container.textContent).toBe("BeforeClientAfter");
    expect(recoverable.messages()).toEqual([
      "Hydration mismatch: expected <div>.",
    ]);
    expect(recoverable.infos[0]).toMatchObject({
      actual: "different DOM node",
      expected: "<div>",
      recovery: "suspense",
      source: "hydration",
    });
    expect(
      (recoverable.infos[0] as { componentStack?: string }).componentStack,
    ).toContain("at Suspense");
  });

  it("removes dehydrated Suspense ranges when they unmount", () => {
    const { container } = suspenseDom("completed", "span", "Server");
    let root: ReturnType<typeof hydrateRoot> | undefined;

    flushSync(() => {
      root = hydrateRoot(
        container as unknown as Element,
        createElement(
          Suspense,
          { fallback: createElement("span", null, "Loading") },
          createElement("span", null, "Client"),
        ),
      );
    });
    flushSync(() => root?.render(null));

    expect(container.childNodes).toEqual([]);
  });

  it("matches nested dehydrated Suspense ranges when they unmount", () => {
    const container = new FakeElement("root");
    const outerStart = new FakeComment("fig:suspense:completed");
    const outerEnd = new FakeComment("/fig:suspense");
    const inner = suspenseDom("pending", "span", "Inner loading");
    let root: ReturnType<typeof hydrateRoot> | undefined;
    if (inner.placeholder === null) throw new Error("Expected pending marker.");

    for (const node of [
      outerStart,
      inner.start,
      inner.placeholder,
      inner.content,
      inner.end,
      outerEnd,
    ]) {
      container.appendChild(node);
    }

    flushSync(() => {
      root = hydrateRoot(
        container as unknown as Element,
        createElement(
          Suspense,
          { fallback: createElement("span", null, "Outer loading") },
          createElement(
            Suspense,
            { fallback: createElement("span", null, "Inner loading") },
            createElement("span", null, "Inner client"),
          ),
        ),
      );
    });
    flushSync(() => root?.render(null));

    expect(container.childNodes).toEqual([]);
  });

  it("preserves server-only attributes and styles during hydration", () => {
    const container = new FakeElement("root");
    const button = new FakeElement("button");

    button.setAttribute("class", "server");
    button.setAttribute("data-server", "extra");
    button.setAttribute("id", "stale");
    button.setAttribute("style", "color: red; font-weight: bold;");
    button.style.color = "red";
    button.style.fontWeight = "bold";
    container.appendChild(button);

    flushSync(() =>
      hydrateRoot(
        container as unknown as Element,
        createElement("button", {
          class: "client",
          style: { color: "blue" },
        }),
      ),
    );

    expect(container.childNodes).toEqual([button]);
    expect(button.attributes).toEqual({
      class: "client",
      "data-server": "extra",
      id: "stale",
      style: "color: red; font-weight: bold;",
    });
    expect(button.style.color).toBe("blue");
    expect(button.style.fontWeight).toBe("bold");
  });

  it("hydrates unsafe HTML without reconciling its children", () => {
    const container = new FakeElement("root");
    const article = new FakeElement("article");
    article.innerHTML = "<strong>Client</strong>";
    container.appendChild(article);

    flushSync(() =>
      hydrateRoot(
        container as unknown as Element,
        createElement("article", {
          unsafeHTML: "<strong>Client</strong>",
        }),
      ),
    );

    expect(container.childNodes).toEqual([article]);
    expect(article.innerHTML).toBe("<strong>Client</strong>");
    expect(article.childNodes).toEqual([]);
  });

  it("hydrates non-canonical unsafe HTML without comparing raw strings", () => {
    const container = new FakeElement("root");
    const article = new FakeElement("article");
    const recoverable = captureRecoverableErrors();
    article.innerHTML = "<br>";
    container.appendChild(article);

    flushSync(() =>
      hydrateRoot(
        container as unknown as Element,
        createElement("article", {
          unsafeHTML: "<br/>",
        }),
        { onRecoverableError: recoverable.capture },
      ),
    );

    expect(container.childNodes).toEqual([article]);
    expect(article.innerHTML).toBe("<br>");
    expect(recoverable.errors).toEqual([]);
  });

  it("preserves hydrated unsafe HTML without reconciling raw mismatches", () => {
    const container = new FakeElement("root");
    const article = new FakeElement("article");
    const recoverable = captureRecoverableErrors();
    article.innerHTML = "<strong>Server</strong>";
    container.appendChild(article);

    flushSync(() =>
      hydrateRoot(
        container as unknown as Element,
        createElement("article", {
          unsafeHTML: "<strong>Client</strong>",
        }),
        { onRecoverableError: recoverable.capture },
      ),
    );

    expect(container.childNodes).toEqual([article]);
    expect(article.innerHTML).toBe("<strong>Server</strong>");
    expect(recoverable.errors).toEqual([]);
  });

  it("recovers from hydrated text mismatches", () => {
    const container = new FakeElement("root");
    const span = new FakeElement("span");
    const recoverable = captureRecoverableErrors();
    span.appendChild(new FakeText("Server"));
    container.appendChild(span);

    flushSync(() =>
      hydrateRoot(
        container as unknown as Element,
        createElement("span", null, "Client"),
        { onRecoverableError: recoverable.capture },
      ),
    );

    const clientSpan = container.childNodes[0] as FakeElement;
    expect(clientSpan).not.toBe(span);
    expect(clientSpan.textContent).toBe("Client");
    expect(recoverable.messages()).toEqual([
      "Hydration mismatch: expected text.",
    ]);
  });

  it("suppresses hydrated text mismatch recovery when requested", () => {
    const container = new FakeElement("root");
    const span = new FakeElement("span");
    const recoverable = captureRecoverableErrors();
    span.appendChild(new FakeText("Server"));
    container.appendChild(span);

    flushSync(() =>
      hydrateRoot(
        container as unknown as Element,
        createElement("span", { suppressHydrationWarning: true }, "Client"),
        { onRecoverableError: recoverable.capture },
      ),
    );

    expect(container.childNodes).toEqual([span]);
    expect(span.textContent).toBe("Client");
    expect(recoverable.errors).toEqual([]);
  });

  it("keeps native SVG attributes aligned during hydration", () => {
    const container = new FakeElement("root");
    const svg = new FakeElement("svg", "http://www.w3.org/2000/svg");
    const use = new FakeElement("use", "http://www.w3.org/2000/svg");

    use.setAttribute("aria-label", "Icon");
    use.setAttribute("data-id", "icon");
    use.setAttribute("tabindex", "0");
    use.setAttribute("xlink:href", "#icon");
    use.setAttribute("style", "--accent: red; color: blue;");
    use.style["--accent"] = "red";
    use.style.color = "blue";
    svg.appendChild(use);
    container.appendChild(svg);

    flushSync(() =>
      hydrateRoot(
        container as unknown as Element,
        createElement(
          "svg",
          null,
          createElement("use", {
            "aria-label": "Icon",
            "data-id": "icon",
            style: { "--accent": "red", color: "blue" },
            tabindex: 0,
            "xlink:href": "#icon",
          }),
        ),
      ),
    );

    expect(container.childNodes).toEqual([svg]);
    expect(svg.childNodes).toEqual([use]);
    expect(use.attributes).toEqual({
      "aria-label": "Icon",
      "data-id": "icon",
      style: "--accent: red; color: blue;",
      tabindex: "0",
      "xlink:href": "#icon",
    });
    expect(use.style["--accent"]).toBe("red");
    expect(use.style.color).toBe("blue");
  });

  it("keeps native HTML attributes aligned during hydration", () => {
    const container = new FakeElement("root");
    const input = new FakeElement("input");

    input.setAttribute("data-server", "extra");
    input.setAttribute("maxlength", "20");
    input.setAttribute("readonly", "");
    container.appendChild(input);

    flushSync(() =>
      hydrateRoot(
        container as unknown as Element,
        createElement("input", {
          maxlength: 20,
          readonly: true,
        }),
      ),
    );

    expect(container.childNodes).toEqual([input]);
    expect(input.attributes).toEqual({
      "data-server": "extra",
      maxlength: "20",
      readonly: "true",
    });
  });

  it("hydrates controlled form values", () => {
    const container = new FakeElement("root");
    const input = new FakeElement("input");
    input.setAttribute("value", "Server");
    input.defaultValue = "Server";
    input.value = "User typed";
    container.appendChild(input);

    flushSync(() =>
      hydrateRoot(
        container as unknown as Element,
        createElement("input", { value: "Client" }),
      ),
    );

    expect(container.childNodes).toEqual([input]);
    expect(input.value).toBe("Client");
    expect(input.defaultValue).toBe("Server");
    expect(input.attributes.value).toBe("Server");
  });

  it("preserves uncontrolled form edits during hydration", () => {
    const container = new FakeElement("root");
    const input = new FakeElement("input");
    input.setAttribute("value", "Server");
    input.defaultValue = "Server";
    input.value = "User typed";
    container.appendChild(input);

    flushSync(() =>
      hydrateRoot(
        container as unknown as Element,
        createElement("input", { defaultValue: "Server" }),
      ),
    );

    expect(input.value).toBe("User typed");
    expect(input.defaultValue).toBe("Server");
    expect(input.attributes.value).toBe("Server");
  });

  it("preserves uncontrolled checked edits during hydration", () => {
    const container = new FakeElement("root");
    const input = new FakeElement("input");
    input.setAttribute("checked", "true");
    input.defaultChecked = true;
    input.checked = false;
    container.appendChild(input);

    flushSync(() =>
      hydrateRoot(
        container as unknown as Element,
        createElement("input", { defaultChecked: true, type: "checkbox" }),
      ),
    );

    expect(input.checked).toBe(false);
    expect(input.defaultChecked).toBe(true);
    expect(input.attributes.checked).toBe("true");
  });

  it("hydrates textarea default content without extra text mismatches", () => {
    const container = new FakeElement("root");
    const textarea = new FakeElement("textarea");
    textarea.appendChild(new FakeText("Server draft"));
    textarea.defaultValue = "Server draft";
    textarea.value = "Server draft";
    container.appendChild(textarea);

    flushSync(() =>
      hydrateRoot(
        container as unknown as Element,
        createElement("textarea", { defaultValue: "Server draft" }),
      ),
    );

    expect(container.childNodes).toEqual([textarea]);
    expect(textarea.value).toBe("Server draft");
    expect(textarea.textContent).toBe("Server draft");
  });

  it("preserves uncontrolled textarea edits during hydration", () => {
    const container = new FakeElement("root");
    const textarea = new FakeElement("textarea");
    textarea.appendChild(new FakeText("Server draft"));
    textarea.defaultValue = "Server draft";
    textarea.value = "User typed";
    container.appendChild(textarea);

    flushSync(() =>
      hydrateRoot(
        container as unknown as Element,
        createElement("textarea", { defaultValue: "Server draft" }),
      ),
    );

    expect(textarea.value).toBe("User typed");
    expect(textarea.defaultValue).toBe("Server draft");
    expect(textarea.textContent).toBe("Server draft");
  });

  it("reports recoverable hydration mismatches while client-rendering", () => {
    const container = new FakeElement("root");
    const span = new FakeElement("span");
    const recoverable = captureRecoverableErrors();
    container.appendChild(span);

    flushSync(() =>
      hydrateRoot(
        container as unknown as Element,
        createElement("div", null, "Client"),
        { onRecoverableError: recoverable.capture },
      ),
    );

    expect(container.childNodes).toHaveLength(1);
    expect(container.childNodes[0]).not.toBe(span);
    expect((container.childNodes[0] as FakeElement).tagName).toBe("div");
    expect(container.textContent).toBe("Client");
    expect(recoverable.errors).toHaveLength(1);
    expect(recoverable.errors[0]).toBeInstanceOf(Error);
    expect((recoverable.errors[0] as Error).message).toBe(
      "Hydration mismatch: expected <div>.",
    );
    expect(recoverable.infos[0]).toMatchObject({
      actual: "different DOM node",
      expected: "<div>",
      recovery: "root",
      source: "hydration",
    });
  });

  it("ignores recoverable error callback failures after recovery", () => {
    const container = new FakeElement("root");
    const span = new FakeElement("span");
    let calls = 0;
    container.appendChild(span);

    expect(() =>
      flushSync(() =>
        hydrateRoot(
          container as unknown as Element,
          createElement("div", null, "Client"),
          {
            onRecoverableError: () => {
              calls += 1;
              throw new Error("report failed");
            },
          },
        ),
      ),
    ).not.toThrow();

    expect(calls).toBe(1);
    expect(container.textContent).toBe("Client");
  });

  it("switches early hydration updates to client rendering", () => {
    const container = new FakeElement("root");
    const span = new FakeElement("span");
    span.appendChild(new FakeText("Server"));
    container.appendChild(span);

    const root = hydrateRoot(
      container as unknown as Element,
      createElement("span", null, "Server"),
    );

    flushSync(() => root.render(createElement("span", null, "Client")));

    expect(container.childNodes).toHaveLength(1);
    expect(container.childNodes[0]).not.toBe(span);
    expect(container.textContent).toBe("Client");
  });

  it("throws clear duplicate-root diagnostics", () => {
    const clientContainer = new FakeElement("root");
    const root = createRoot(clientContainer as unknown as Element);

    expect(() => createRoot(clientContainer as unknown as Element)).toThrow(
      "Cannot call createRoot on a container that already has a Fig root.",
    );
    expect(() =>
      hydrateRoot(clientContainer as unknown as Element, null),
    ).toThrow(
      "Cannot call hydrateRoot on a container that already has a Fig root.",
    );

    flushSync(() => root.render(createElement("span", null, "Client")));
    expect(clientContainer.textContent).toBe("Client");

    const hydrationContainer = new FakeElement("root");
    const hydratedSpan = new FakeElement("span");
    hydratedSpan.appendChild(new FakeText("Server"));
    hydrationContainer.appendChild(hydratedSpan);

    flushSync(() =>
      hydrateRoot(
        hydrationContainer as unknown as Element,
        createElement("span", null, "Server"),
      ),
    );

    expect(() =>
      hydrateRoot(hydrationContainer as unknown as Element, null),
    ).toThrow(
      "Cannot call hydrateRoot on a container that already has a Fig root.",
    );
    expect(() => createRoot(hydrationContainer as unknown as Element)).toThrow(
      "Cannot call createRoot on a container that already has a Fig root.",
    );
  });
});

describe("enclosingSuspenseBoundaryStart", () => {
  it("finds the marker pair enclosing a nested target", () => {
    const container = new FakeElement("root");
    const start = new FakeComment("fig:suspense:pending:0");
    const wrapper = new FakeElement("div");
    const target = element("button", "Inside");
    container.appendChild(start);
    container.appendChild(wrapper);
    wrapper.appendChild(target);
    container.appendChild(new FakeComment("/fig:suspense"));

    expect(enclosingSuspenseBoundaryStart(target)).toBe(start);
  });

  it("ignores boundaries closed before the target", () => {
    const container = new FakeElement("root");
    container.appendChild(new FakeComment("fig:suspense:completed"));
    container.appendChild(element("span", "Done"));
    container.appendChild(new FakeComment("/fig:suspense"));
    const target = element("button", "After");
    container.appendChild(target);

    expect(enclosingSuspenseBoundaryStart(target)).toBe(null);
  });

  it("resumes outward from a start marker across nested boundaries", () => {
    const container = new FakeElement("root");
    const outerStart = new FakeComment("fig:suspense:pending:0");
    const innerStart = new FakeComment("fig:suspense:pending:1");
    const target = element("span", "Deep");
    const innerEnd = new FakeComment("/fig:suspense");
    const outerEnd = new FakeComment("/fig:suspense");
    for (const node of [outerStart, innerStart, target, innerEnd, outerEnd]) {
      container.appendChild(node);
    }

    const inner = enclosingSuspenseBoundaryStart(target);
    expect(inner).toBe(innerStart);
    const outer = enclosingSuspenseBoundaryStart(inner);
    expect(outer).toBe(outerStart);
    expect(enclosingSuspenseBoundaryStart(outer)).toBe(null);
  });

  it("returns null for targets outside any boundary", () => {
    const container = new FakeElement("root");
    const target = element("span", "Plain");
    container.appendChild(target);

    expect(enclosingSuspenseBoundaryStart(target)).toBe(null);
    expect(enclosingSuspenseBoundaryStart(null)).toBe(null);
  });
});

describe("isWithinSuspenseBoundary", () => {
  it("checks boundary membership by walking target ancestors", () => {
    const container = new FakeElement("root");
    const start = new FakeComment("fig:suspense:pending:0");
    const wrapper = new FakeElement("div");
    const target = element("button", "Inside");
    const end = new FakeComment("/fig:suspense");
    const after = element("span", "After");

    container.appendChild(start);
    container.appendChild(wrapper);
    wrapper.appendChild(target);
    container.appendChild(end);
    container.appendChild(after);

    const boundary = {
      end,
      forceClientRender: false,
      id: "0",
      start,
      status: "pending" as const,
    } as unknown as DehydratedSuspenseBoundary<Element, Text | Comment>;

    expect(isWithinSuspenseBoundary(target as unknown as Node, boundary)).toBe(
      true,
    );
    expect(isWithinSuspenseBoundary(wrapper as unknown as Node, boundary)).toBe(
      true,
    );
    expect(isWithinSuspenseBoundary(after as unknown as Node, boundary)).toBe(
      false,
    );
    expect(isWithinSuspenseBoundary(start as unknown as Node, boundary)).toBe(
      false,
    );

    const adopted = new FakeElement("adopted");
    adopted.appendChild(start);
    expect(isWithinSuspenseBoundary(target as unknown as Node, boundary)).toBe(
      true,
    );
  });
});

type RetriableFakeComment = FakeComment & { __figRetry?: () => void };

function captureRecoverableErrors(): {
  capture(this: void, error: unknown, info: unknown): void;
  errors: unknown[];
  infos: unknown[];
  messages(): string[];
} {
  const errors: unknown[] = [];
  const infos: unknown[] = [];

  return {
    capture(this: void, error, info) {
      errors.push(error);
      infos.push(info);
    },
    errors,
    infos,
    messages() {
      return errors.map((error) =>
        error instanceof Error ? error.message : String(error),
      );
    },
  };
}

function suspenseDom(
  status: "client-rendered" | "completed" | "pending",
  tagName: string,
  text: string,
): {
  container: FakeElement;
  content: FakeElement;
  end: FakeComment;
  placeholder: FakeElement | null;
  start: FakeComment;
} {
  const container = new FakeElement("root");
  const start = new FakeComment(
    status === "completed"
      ? "fig:suspense:completed"
      : status === "pending"
        ? "fig:suspense:pending:0"
        : "fig:suspense:client",
  );
  const placeholder =
    status === "completed" ? null : new FakeElement("template");
  const content = element(tagName, text);
  const end = new FakeComment("/fig:suspense");

  container.appendChild(start);
  if (placeholder !== null) container.appendChild(placeholder);
  container.appendChild(content);
  container.appendChild(end);

  return { container, content, end, placeholder, start };
}

const voidTags = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

// Minimal HTML-to-fake-DOM parser for hydration round trips. Like a browser,
// contiguous character data becomes a single text node — which is exactly the
// merge behavior these tests exercise — while comments split text nodes.
function containerFromHtml(html: string): FakeElement {
  const container = new FakeElement("root");
  const stack: FakeElement[] = [container];
  let index = 0;

  while (index < html.length) {
    const parent = stack[stack.length - 1];

    if (html.startsWith("<!--", index)) {
      const end = html.indexOf("-->", index + 4);
      parent.appendChild(new FakeComment(html.slice(index + 4, end)));
      index = end + 3;
      continue;
    }

    if (html.startsWith("</", index)) {
      index = html.indexOf(">", index) + 1;
      stack.pop();
      continue;
    }

    if (html[index] === "<") {
      const end = html.indexOf(">", index);
      const parsed = parseTag(html.slice(index + 1, end));
      parent.appendChild(parsed);
      if (!voidTags.has(parsed.tagName)) stack.push(parsed);
      index = end + 1;
      continue;
    }

    const next = html.indexOf("<", index);
    const stop = next === -1 ? html.length : next;
    parent.appendChild(new FakeText(unescapeHtml(html.slice(index, stop))));
    index = stop;
  }

  return container;
}

function parseTag(raw: string): FakeElement {
  const match = /^([a-zA-Z][^\s/>]*)\s*(.*)$/s.exec(raw);
  const parsed = new FakeElement(match?.[1] ?? raw);

  for (const attribute of (match?.[2] ?? "").matchAll(
    /([^\s=]+)(?:="([^"]*)")?/g,
  )) {
    parsed.setAttribute(attribute[1], unescapeHtml(attribute[2] ?? ""));
  }

  return parsed;
}

function unescapeHtml(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");
}

function element(tagName: string, text: string): FakeElement {
  const node = new FakeElement(tagName);
  node.appendChild(new FakeText(text));
  return node;
}

function completePendingBoundary(
  parent: FakeElement,
  boundary: ReturnType<typeof suspenseDom>,
): void {
  if (boundary.placeholder === null) {
    throw new Error("Expected pending placeholder.");
  }

  boundary.start.data = "fig:suspense:completed";
  parent.removeChild(boundary.placeholder);
  (boundary.start as RetriableFakeComment).__figRetry?.();
}
