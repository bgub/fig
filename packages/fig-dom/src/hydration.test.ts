import { createElement, Suspense, useState } from "@bgub/fig";
import { describe, expect, it } from "vitest";
import { type Bind, createRoot, flushSync, hydrateRoot, on } from "./index.ts";
import {
  delay,
  FakeComment,
  FakeElement,
  FakeText,
  installFakeDocument,
} from "./test-utils.ts";

installFakeDocument();

describe("@bgub/fig-dom hydration", () => {
  it("hydrates existing host elements without duplicating nodes", () => {
    const container = new FakeElement("root");
    const button = new FakeElement("button");
    button.setAttribute("id", "server");
    button.appendChild(new FakeText("Server"));
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
    expect(button.attributes).toEqual({ id: "client" });

    button.dispatch("click");
    expect(calls).toEqual(["click"]);
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

  it("runs binds for hydrated host elements", () => {
    const container = new FakeElement("root");
    const input = new FakeElement("input");
    const calls: Array<[FakeElement, AbortSignal]> = [];
    const bind: Bind = (node, signal) =>
      calls.push([node as FakeElement, signal]);
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
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBe(input);
    expect(calls[0][1].aborted).toBe(false);
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
    } = suspenseDom("completed", "button", "Server");
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
    expect(button.textContent).toBe("Server");

    button.dispatch("click");

    expect(container.childNodes).toEqual([button]);
    expect(button.textContent).toBe("Client");
    expect(calls).toEqual(["click"]);
  });

  it("hydrates completed Suspense boundaries in background work", async () => {
    const { container, content: button } = suspenseDom(
      "completed",
      "button",
      "Server",
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

    await delay();

    expect(container.childNodes).toEqual([button]);
    expect(button.textContent).toBe("Client");

    button.dispatch("click");
    expect(calls).toEqual(["click"]);
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
    await delay();

    expect(container.childNodes).toEqual([start, placeholder, fallback, end]);
    expect(container.textContent).toBe("Loading");
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

    const serverContent = element("button", "Server");
    if (placeholder === null) throw new Error("Expected pending placeholder.");
    start.data = "fig:suspense:completed";
    container.removeChild(placeholder);
    container.removeChild(fallback);
    container.insertBefore(serverContent, end);
    (start as RetriableFakeComment).__figRetry?.();

    await delay();

    expect(container.childNodes).toEqual([serverContent]);
    expect(serverContent.textContent).toBe("Client");
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
    const errors: unknown[] = [];
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
        { onRecoverableError: (error) => errors.push(error) },
      ),
    );

    expect(container.textContent).toBe("Loading");

    await delay();

    expect(container.childNodes).toHaveLength(1);
    expect(container.childNodes[0]).not.toBe(fallback);
    expect(container.textContent).toBe("Client");

    (container.childNodes[0] as FakeElement).dispatch("click");
    expect(calls).toEqual(["click"]);
    expect((errors[0] as Error).message).toBe("Server failed");
    expect((errors[0] as Error & { digest?: string }).digest).toBe("digest-1");
  });

  it("client-renders pending Suspense boundaries when the server marks them recovered", async () => {
    const {
      container,
      content: fallback,
      end,
      placeholder,
      start,
    } = suspenseDom("pending", "button", "Loading");
    const errors: unknown[] = [];
    if (placeholder === null) throw new Error("Expected pending placeholder.");

    flushSync(() =>
      hydrateRoot(
        container as unknown as Element,
        createElement(
          Suspense,
          { fallback: createElement("button", null, "Loading") },
          createElement("button", null, "Client"),
        ),
        { onRecoverableError: (error) => errors.push(error) },
      ),
    );

    start.data = "fig:suspense:client";
    placeholder.dataset.msg = "Server failed after shell";
    (start as RetriableFakeComment).__figRetry?.();

    await delay();

    expect(container.childNodes).toHaveLength(1);
    expect(container.childNodes).not.toEqual([
      start,
      placeholder,
      fallback,
      end,
    ]);
    expect(container.textContent).toBe("Client");
    expect((errors[0] as Error).message).toBe("Server failed after shell");
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

    await delay();

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
    const errors: string[] = [];

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
        {
          onRecoverableError: (error) =>
            errors.push(error instanceof Error ? error.message : String(error)),
        },
      ),
    );

    server.dispatch("click");

    expect(container.childNodes[0]).toBe(before);
    expect(container.childNodes.at(-1)).toBe(after);
    expect(container.textContent).toBe("BeforeClientAfter");
    expect(errors).toEqual(["Hydration mismatch: expected <div>."]);
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

  it("removes server-only attributes and styles during hydration", () => {
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
          className: "client",
          style: { color: "blue" },
        }),
      ),
    );

    expect(container.childNodes).toEqual([button]);
    expect(button.attributes).toEqual({ class: "client" });
    expect(button.style.color).toBe("blue");
    expect(button.style.fontWeight).toBe("");
  });

  it("reports recoverable hydration mismatches while client-rendering", () => {
    const container = new FakeElement("root");
    const span = new FakeElement("span");
    const errors: unknown[] = [];
    container.appendChild(span);

    flushSync(() =>
      hydrateRoot(
        container as unknown as Element,
        createElement("div", null, "Client"),
        { onRecoverableError: (error) => errors.push(error) },
      ),
    );

    expect(container.childNodes).toHaveLength(1);
    expect(container.childNodes[0]).not.toBe(span);
    expect((container.childNodes[0] as FakeElement).tagName).toBe("div");
    expect(container.textContent).toBe("Client");
    expect(errors).toHaveLength(1);
    expect(errors[0]).toBeInstanceOf(Error);
    expect((errors[0] as Error).message).toBe(
      "Hydration mismatch: expected <div>.",
    );
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

type RetriableFakeComment = FakeComment & { __figRetry?: () => void };

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

function element(tagName: string, text: string): FakeElement {
  const node = new FakeElement(tagName);
  node.appendChild(new FakeText(text));
  return node;
}
