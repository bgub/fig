import { createElement, useBeforePaint } from "@bgub/fig";
import { describe, expect, it } from "vite-plus/test";
import { type Bind, createRoot, flushSync, render } from "./index.ts";
import { FakeElement, installFakeDocument } from "./test-utils.ts";

installFakeDocument();

describe("@bgub/fig-dom bind", () => {
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
});
