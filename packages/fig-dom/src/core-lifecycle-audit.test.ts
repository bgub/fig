import {
  Activity,
  createElement,
  useBeforeLayout,
  useStableEvent,
} from "@bgub/fig";
import { expect, it } from "vitest";
import { createRoot, flushSync } from "./index.ts";
import { FakeElement, installFakeDocument } from "./test-utils.ts";

installFakeDocument();

it("keeps only the latest invocation live when an abort listener re-enters a stable event", () => {
  const signals = new Map<string, AbortSignal>();
  let fire: (label: string) => void = () => {};
  function App() {
    const event = useStableEvent((label: string, signal: AbortSignal) => {
      signals.set(label, signal);
      if (label === "first")
        signal.addEventListener("abort", () => fire("nested"), { once: true });
    });
    useBeforeLayout(() => {
      fire = event;
    }, []);
    return createElement("span", null, "app");
  }
  const root = createRoot(new FakeElement("root") as unknown as Element);
  try {
    flushSync(() => root.render(createElement(App, null)));
    fire("first");
    fire("second");
    expect(signals.get("first")?.aborted).toBe(true);
    expect(signals.get("nested")?.aborted).toBe(false);
    expect(signals.get("second")?.aborted).toBe(true);
    flushSync(() => root.unmount());
    expect(signals.get("nested")?.aborted).toBe(true);
  } finally {
    flushSync(() => root.unmount());
  }
});

it("publishes stable-event retirement before running unmount abort listeners", () => {
  const abortedDuringCalls: boolean[] = [];
  let fire = () => {};
  let calls = 0;
  function App() {
    const event = useStableEvent((signal: AbortSignal) => {
      abortedDuringCalls.push(signal.aborted);
      if (calls++ === 0)
        signal.addEventListener("abort", () => fire(), { once: true });
    });
    useBeforeLayout(() => {
      fire = event;
    }, []);
    return createElement("span", null, "app");
  }
  const root = createRoot(new FakeElement("root") as unknown as Element);
  try {
    flushSync(() => root.render(createElement(App, null)));
    fire();
    flushSync(() => root.unmount());
    expect(abortedDuringCalls).toEqual([false, true]);
  } finally {
    flushSync(() => root.unmount());
  }
});

it("does not revive stable events in a still-hidden nested Activity when its ancestor reveals", () => {
  const calls: boolean[] = [];
  let fire = () => {};
  function Child() {
    fire = useStableEvent((signal: AbortSignal) => {
      calls.push(signal.aborted);
    });
    return createElement("span", null, "hidden");
  }
  const child = createElement(
    Activity,
    { mode: "hidden" },
    createElement(Child, null),
  );
  function App({ hidden }: { hidden: boolean }) {
    return createElement(
      Activity,
      { mode: hidden ? "hidden" : "visible" },
      child,
    );
  }
  const root = createRoot(new FakeElement("root") as unknown as Element);
  try {
    flushSync(() => root.render(createElement(App, { hidden: true })));
    fire();
    flushSync(() => root.render(createElement(App, { hidden: false })));
    fire();
    expect(calls).toEqual([true, true]);
  } finally {
    flushSync(() => root.unmount());
  }
});

it("keeps an inner reveal retired until its hidden ancestor also reveals", () => {
  const calls: boolean[] = [];
  let fire = () => {};
  function Child() {
    fire = useStableEvent((signal: AbortSignal) => {
      calls.push(signal.aborted);
    });
    return createElement("span", null, "child");
  }
  const child = createElement(Child, null);
  function App({
    outerHidden,
    innerHidden,
  }: {
    outerHidden: boolean;
    innerHidden: boolean;
  }) {
    return createElement(
      Activity,
      { mode: outerHidden ? "hidden" : "visible" },
      createElement(
        Activity,
        { mode: innerHidden ? "hidden" : "visible" },
        child,
      ),
    );
  }
  const root = createRoot(new FakeElement("root") as unknown as Element);
  try {
    flushSync(() =>
      root.render(createElement(App, { outerHidden: true, innerHidden: true })),
    );
    fire();
    flushSync(() =>
      root.render(
        createElement(App, { outerHidden: true, innerHidden: false }),
      ),
    );
    fire();
    flushSync(() =>
      root.render(
        createElement(App, { outerHidden: false, innerHidden: false }),
      ),
    );
    fire();
    expect(calls).toEqual([true, true, false]);
  } finally {
    flushSync(() => root.unmount());
  }
});
