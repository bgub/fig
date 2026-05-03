import { createElement } from "@bgub/fig";
import { describe, expect, it } from "vitest";
import { type Bind, createRoot, flushSync, hydrateRoot, on } from "./index.ts";
import { FakeElement, FakeText, installFakeDocument } from "./test-utils.ts";

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
