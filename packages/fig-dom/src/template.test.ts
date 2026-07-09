// @vitest-environment happy-dom
import { createElement, template } from "@bgub/fig";
import { describe, expect, it } from "vite-plus/test";
import { createRoot, flushSync, hydrateRoot, on } from "./index.ts";

// <li class={slot3}><span>{slot0}</span><button events={slot2}>{slot1}</button></li>
const rowTemplate = template("<li><span> </span><button> </button></li>", [
  { kind: "text", path: [0, 0] },
  { kind: "text", path: [1, 0] },
  { kind: "events", path: [1] },
  { kind: "attr", name: "class", path: [] },
]);

function row(key: string, slots: readonly unknown[]) {
  return createElement(rowTemplate as never, { key, slots });
}

describe("@bgub/fig-dom templates", () => {
  it("mounts template instances and applies initial slots", () => {
    const container = document.createElement("div");
    const root = createRoot(container);

    flushSync(() =>
      root.render(
        createElement("ul", null, row("a", ["Row a", "Go", [], "row"])),
      ),
    );

    const li = container.querySelector("li");
    expect(li?.getAttribute("class")).toBe("row");
    expect(li?.querySelector("span")?.textContent).toBe("Row a");
    expect(li?.querySelector("button")?.textContent).toBe("Go");
  });

  it("updates only changed slots through the commit queue", () => {
    const container = document.createElement("div");
    const root = createRoot(container);

    flushSync(() =>
      root.render(
        createElement("ul", null, row("a", ["Row a", "Go", [], "row"])),
      ),
    );
    const li = container.querySelector("li");

    flushSync(() =>
      root.render(
        createElement("ul", null, row("a", ["Row a2", "Go", [], "row on"])),
      ),
    );

    expect(container.querySelector("li")).toBe(li);
    expect(li?.getAttribute("class")).toBe("row on");
    expect(li?.querySelector("span")?.textContent).toBe("Row a2");
  });

  it("dispatches delegated events inside templates and bubbles into fiber handlers", () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    const order: string[] = [];
    let seenSignal: AbortSignal | null = null;

    flushSync(() =>
      root.render(
        createElement(
          "ul",
          { events: [on("click", () => order.push("ul"))] },
          row("a", [
            "Row a",
            "Go",
            [
              on("click", (_event, signal) => {
                seenSignal = signal;
                order.push("button");
              }),
            ],
            "row",
          ]),
        ),
      ),
    );

    const button = container.querySelector("button");
    button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(order).toEqual(["button", "ul"]);
    expect(seenSignal).not.toBeNull();
  });

  it("swaps event handlers by slot identity and aborts on removal", () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    const calls: string[] = [];
    let signalA: AbortSignal | null = null;

    const render = (handler: "a" | "b" | null) =>
      flushSync(() =>
        root.render(
          createElement(
            "ul",
            null,
            handler === null
              ? null
              : row("x", [
                  "Row",
                  "Go",
                  [
                    on("click", (_event, signal) => {
                      if (handler === "a") signalA = signal;
                      calls.push(handler);
                    }),
                  ],
                  "row",
                ]),
          ),
        ),
      );

    render("a");
    const button = container.querySelector("button");
    button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(calls).toEqual(["a"]);
    expect(signalA).not.toBeNull();

    render("b");
    container
      .querySelector("button")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(calls).toEqual(["a", "b"]);
    // The first handler's run signal ended aborted when it was superseded.
    expect((signalA as unknown as AbortSignal).aborted).toBe(true);

    const detached = container.querySelector("button");
    render(null);
    expect(container.querySelector("li")).toBeNull();
    // Handlers on removed template content no longer receive live dispatch.
    detached?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(calls).toEqual(["a", "b"]);
  });

  it("hydrates server-rendered templates: adopts DOM and binds event slots", () => {
    const container = document.createElement("div");
    // What the descriptor's server segments produce for these slot values.
    container.innerHTML =
      '<ul><li class="row"><span>Row a</span><button>Go</button></li></ul>';
    const serverLi = container.querySelector("li");
    const clicks: string[] = [];

    const app = (label: string, handler: () => void) =>
      createElement(
        "ul",
        null,
        row("a", [label, "Go", [on("click", handler)], "row"]),
      );

    const root = hydrateRoot(
      container,
      app("Row a", () => clicks.push("first")),
    );
    flushSync(() => undefined);

    // Adopted, not replaced.
    expect(container.querySelector("li")).toBe(serverLi);

    container
      .querySelector("button")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(clicks).toEqual(["first"]);

    // Post-hydration slot updates flow through the adopted slot nodes.
    flushSync(() => root.render(app("Row a2", () => clicks.push("second"))));
    expect(serverLi?.querySelector("span")?.textContent).toBe("Row a2");
    container
      .querySelector("button")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(clicks).toEqual(["first", "second"]);
  });

  it("recovers by client-rendering when a hydrated text slot mismatches", () => {
    const container = document.createElement("div");
    container.innerHTML =
      '<ul><li class="row"><span>Stale server</span><button>Go</button></li></ul>';
    const serverLi = container.querySelector("li");
    const errors: string[] = [];

    hydrateRoot(
      container,
      createElement("ul", null, row("a", ["Fresh client", "Go", [], "row"])),
      {
        onRecoverableError: (error) =>
          errors.push(error instanceof Error ? error.message : String(error)),
      },
    );
    flushSync(() => undefined);

    // The mismatch surfaced and the tree was client-rendered fresh.
    expect(errors.length).toBeGreaterThan(0);
    expect(container.querySelector("li")).not.toBe(serverLi);
    expect(container.querySelector("span")?.textContent).toBe("Fresh client");
  });

  it("preserves mismatched attribute slots and warns in dev", () => {
    const container = document.createElement("div");
    container.innerHTML =
      '<ul><li class="server-class"><span>Row a</span><button>Go</button></li></ul>';
    const serverLi = container.querySelector("li");
    const warnings: unknown[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => warnings.push(args[0]);

    try {
      hydrateRoot(
        container,
        createElement(
          "ul",
          null,
          row("a", ["Row a", "Go", [], "client-class"]),
        ),
      );
      flushSync(() => undefined);
    } finally {
      console.error = original;
    }

    // Adopted (no recovery), server attribute kept, dev warning emitted.
    expect(container.querySelector("li")).toBe(serverLi);
    expect(serverLi?.getAttribute("class")).toBe("server-class");
    expect(
      warnings.some(
        (message) =>
          typeof message === "string" &&
          message.includes('template attribute "class"'),
      ),
    ).toBe(true);
  });

  it("moves template instances on keyed reorder without recreating them", () => {
    const container = document.createElement("div");
    const root = createRoot(container);

    const render = (ids: string[]) =>
      flushSync(() =>
        root.render(
          createElement(
            "ul",
            null,
            ids.map((id) => row(id, [`Row ${id}`, "Go", [], "row"])),
          ),
        ),
      );

    render(["a", "b"]);
    const [liA, liB] = Array.from(container.querySelectorAll("li"));

    render(["b", "a"]);
    const after = Array.from(container.querySelectorAll("li"));
    expect(after[0]).toBe(liB);
    expect(after[1]).toBe(liA);
    expect(after[0]?.querySelector("span")?.textContent).toBe("Row b");
  });
});
