import {
  Activity,
  createElement,
  useActionState,
  useState,
  useTransition,
  type StartTransition,
} from "@bgub/fig";
import { expect, it } from "vitest";
import { createRoot, flushSync } from "./index.ts";
import {
  deferred,
  FakeElement,
  installFakeDocument,
  waitForHostTurns,
} from "./test-utils.ts";

installFakeDocument();

it("keeps a reentrant transition started by abort cleanup as the latest run", async () => {
  const first = deferred<void>();
  const nested = deferred<void>();
  const outer = deferred<void>();
  let start!: StartTransition;
  const signals = new Map<string, AbortSignal>();
  function App() {
    const [pending, run] = useTransition();
    start = run;
    return String(pending);
  }
  const container = new FakeElement("root");
  const root = createRoot(container as unknown as Element);
  try {
    flushSync(() => root.render(createElement(App, null)));
    start((signal) => {
      signals.set("first", signal);
      signal.addEventListener(
        "abort",
        () =>
          start((nestedSignal) => {
            signals.set("nested", nestedSignal);
            return nested.promise;
          }),
        { once: true },
      );
      return first.promise;
    });
    start((signal) => {
      signals.set("outer", signal);
      return outer.promise;
    });
    expect(signals.get("nested")?.aborted).toBe(false);
    expect(signals.get("outer")?.aborted).toBe(true);
    nested.resolve(undefined);
    await waitForHostTurns();
    expect(container.textContent).toBe("false");
  } finally {
    root.unmount();
    first.resolve(undefined);
    nested.resolve(undefined);
    outer.resolve(undefined);
    await waitForHostTurns();
  }
});

it("keeps a reentrant action result and releases its predecessor pending slots", async () => {
  const gates = {
    first: deferred<string>(),
    nested: deferred<string>(),
    outer: deferred<string>(),
  };
  let dispatch!: (label: keyof typeof gates) => void;
  const signals = new Map<string, AbortSignal>();
  function App() {
    const [value, run, pending] = useActionState(
      (_previous: string, label: keyof typeof gates, signal: AbortSignal) => {
        signals.set(label, signal);
        if (label === "first")
          signal.addEventListener("abort", () => dispatch("nested"), {
            once: true,
          });
        return gates[label].promise;
      },
      "initial",
    );
    dispatch = run;
    return `${pending}:${value}`;
  }
  const container = new FakeElement("root");
  const root = createRoot(container as unknown as Element);
  try {
    flushSync(() => root.render(createElement(App, null)));
    dispatch("first");
    dispatch("outer");
    expect(signals.get("outer")?.aborted).toBe(true);
    gates.nested.resolve("nested-result");
    await waitForHostTurns();
    expect(container.textContent).toBe("false:nested-result");
  } finally {
    root.unmount();
    for (const gate of Object.values(gates)) gate.resolve("retired");
    await waitForHostTurns();
  }
});

it("keeps a saved transition starter inert while its owner is hidden", async () => {
  let start!: StartTransition;
  let updateValue!: (value: number) => void;
  function Child() {
    const [value, setValue] = useState(0);
    updateValue = setValue;
    const [, run] = useTransition();
    start = run;
    return String(value);
  }
  const child = createElement(Child, null);
  const container = new FakeElement("root");
  const root = createRoot(container as unknown as Element);
  try {
    flushSync(() =>
      root.render(createElement(Activity, { mode: "visible" }, child)),
    );
    flushSync(() =>
      root.render(createElement(Activity, { mode: "hidden" }, child)),
    );
    start((signal, update) => {
      expect(signal.aborted).toBe(true);
      update(() => {
        throw new Error("Hidden run retained authority");
      });
    });
    flushSync(() =>
      root.render(createElement(Activity, { mode: "visible" }, child)),
    );
    start((signal, update) => {
      expect(signal.aborted).toBe(false);
      update(() => updateValue(1));
    });
    await waitForHostTurns();
    expect(container.textContent).toBe("1");
  } finally {
    root.unmount();
    await waitForHostTurns();
  }
});

it("keeps hidden action runners inert and restores their authority on reveal", async () => {
  const observed: boolean[] = [];
  let dispatch!: (value: string) => void;
  function Child() {
    const [value, run, pending] = useActionState(
      (_previous: string, next: string, signal: AbortSignal) => {
        observed.push(signal.aborted);
        return next;
      },
      "initial",
    );
    dispatch = run;
    return `${pending}:${value}`;
  }
  const child = createElement(Child, null);
  const container = new FakeElement("root");
  const root = createRoot(container as unknown as Element);
  try {
    flushSync(() =>
      root.render(createElement(Activity, { mode: "hidden" }, child)),
    );
    dispatch("hidden-result");
    await waitForHostTurns();
    flushSync(() =>
      root.render(createElement(Activity, { mode: "visible" }, child)),
    );
    expect(container.textContent).toBe("false:initial");
    dispatch("visible-result");
    await waitForHostTurns();
    expect(observed).toEqual([true, false]);
    expect(container.textContent).toBe("false:visible-result");
  } finally {
    root.unmount();
  }
});

it("keeps actions started during unmount abort cleanup retired", async () => {
  const pending = deferred<string>();
  const observed: boolean[] = [];
  let dispatch!: (cleanup: boolean) => void;
  function Child() {
    const [, run] = useActionState(
      (_previous: string, cleanup: boolean, signal: AbortSignal) => {
        observed.push(signal.aborted);
        if (!cleanup)
          signal.addEventListener("abort", () => dispatch(true), {
            once: true,
          });
        return cleanup ? "cleanup" : pending.promise;
      },
      "initial",
    );
    dispatch = run;
    return "child";
  }
  const root = createRoot(new FakeElement("root") as unknown as Element);
  try {
    flushSync(() => root.render(createElement(Child, null)));
    dispatch(false);
    flushSync(() => root.unmount());
    expect(observed).toEqual([false, true]);
  } finally {
    root.unmount();
    pending.resolve("retired");
    await waitForHostTurns();
  }
});

it("keeps an action started by settlement cleanup as the current result", async () => {
  let dispatch!: (value: string) => void;
  function Child() {
    const [value, run, pending] = useActionState(
      (_previous: string, next: string, signal: AbortSignal) => {
        if (next === "first")
          signal.addEventListener("abort", () => dispatch("nested"), {
            once: true,
          });
        return next;
      },
      "initial",
    );
    dispatch = run;
    return `${pending}:${value}`;
  }
  const container = new FakeElement("root");
  const root = createRoot(container as unknown as Element);
  try {
    flushSync(() => root.render(createElement(Child, null)));
    dispatch("first");
    await waitForHostTurns();
    expect(container.textContent).toBe("false:nested");
  } finally {
    root.unmount();
  }
});
