import { createElement, useBeforePaint } from "@bgub/fig";
import { describe, expect, it } from "vitest";
import { type Bind, composeBind, createRoot, flushSync } from "./index.ts";
import { FakeElement, installFakeDocument } from "./test-utils.ts";

installFakeDocument();

// Tests run in development mode, where Fig strict-runs first-time binds:
// run, abort, run again with a fresh signal. Callback changes and removals
// stay single.
describe("@bgub/fig-dom bind", () => {
  it("binds host nodes through normal component props", () => {
    const calls: string[] = [];
    const signals: AbortSignal[] = [];
    const container = new FakeElement("root");

    function TextField({ bind }: { bind?: Bind<HTMLInputElement> }) {
      return createElement("input", { bind });
    }
    const root = createRoot(container as unknown as Element);

    flushSync(() =>
      root.render(
        createElement(TextField, {
          bind: (node, signal) => {
            calls.push((node as unknown as FakeElement).tagName);
            signals.push(signal);
          },
        }),
      ),
    );

    const input = container.childNodes[0] as FakeElement;

    expect(calls).toEqual(["input", "input"]);
    expect(signals[0].aborted).toBe(true);
    expect(signals[1].aborted).toBe(false);
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

    expect(calls).toEqual(["first", "first"]);
    expect(signals[0].aborted).toBe(true);
    expect(signals[1].aborted).toBe(false);

    flushSync(() => root.render(createElement("button", { bind: second })));

    expect(calls).toEqual(["first", "first", "second"]);
    expect(signals[1].aborted).toBe(true);
    expect(signals[2].aborted).toBe(false);

    flushSync(() => root.render(createElement("button", null)));

    expect(signals[2].aborted).toBe(true);
  });

  it("composes bind callbacks through composeBind", () => {
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
    const third: Bind = (_node, signal) => {
      calls.push("third");
      signals.push(signal);
    };
    const composed = composeBind(first, second, null, third);

    flushSync(() => root.render(createElement("button", { bind: composed })));

    expect(calls).toEqual([
      "first",
      "second",
      "third",
      "first",
      "second",
      "third",
    ]);
    expect(signals.slice(0, 3).every((signal) => signal.aborted)).toBe(true);
    expect(signals.slice(3).every((signal) => !signal.aborted)).toBe(true);

    flushSync(() => root.render(createElement("button", null)));

    expect(signals.slice(3).every((signal) => signal.aborted)).toBe(true);
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
    expect(signals[0].aborted).toBe(true);
    expect(signals[1].aborted).toBe(false);

    flushSync(() => root.render(createElement(App, { show: false })));
    expect(signals[1].aborted).toBe(true);
  });

  it("aborts every original sibling when an abort handler mutates the DOM", () => {
    const signals: AbortSignal[] = [];
    const runs = [0, 0, 0];
    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);

    const bind =
      (index: number): Bind =>
      (node, signal) => {
        runs[index] += 1;
        signals[index] = signal;

        // Register only on the live strict-mode invocation; the first signal
        // aborts immediately during mount.
        if (index === 0 && runs[index] === 2) {
          signal.addEventListener("abort", () => {
            const element = node as unknown as FakeElement;
            const sibling = element.nextSibling;
            if (sibling !== null) element.parentNode?.removeChild(sibling);
          });
        }
      };

    flushSync(() =>
      root.render(
        createElement(
          "main",
          null,
          createElement("span", { bind: bind(0) }),
          createElement("span", { bind: bind(1) }),
          createElement("span", { bind: bind(2) }),
        ),
      ),
    );

    expect(signals.every((signal) => !signal.aborted)).toBe(true);

    root.unmount();

    expect(signals.every((signal) => signal.aborted)).toBe(true);
  });

  it("aborts every original descendant when its parent abort mutates the DOM", () => {
    const signals: AbortSignal[] = [];
    let parentRuns = 0;
    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);
    const parentBind: Bind = (node, signal) => {
      parentRuns += 1;
      signals[0] = signal;

      // Register only on the live strict-mode invocation.
      if (parentRuns === 2) {
        signal.addEventListener("abort", () => {
          const element = node as unknown as FakeElement;
          if (element.firstChild !== null) {
            element.removeChild(element.firstChild);
          }
        });
      }
    };
    const childBind: Bind = (_node, signal) => {
      signals[1] = signal;
    };

    flushSync(() =>
      root.render(
        createElement(
          "main",
          { bind: parentBind },
          createElement("span", { bind: childBind }),
        ),
      ),
    );

    expect(signals).toHaveLength(2);
    expect(signals.every((signal) => !signal.aborted)).toBe(true);

    root.unmount();

    expect(signals.every((signal) => signal.aborted)).toBe(true);
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
    const root = createRoot(container as unknown as Element);

    flushSync(() => root.render(createElement(App, null)));

    // Both the bind and the before-paint effect strict-run twice on mount.
    expect(calls).toEqual(["bind", "bind", "before-paint", "before-paint"]);
  });
});
