import {
  Activity,
  type StartTransition,
  type TransitionUpdate,
  createElement,
  useActionState,
  useBeforePaint,
  useStableEvent,
  useTransition,
  useState,
  useSyncExternalStore,
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

it("retires later stable hooks before earlier effect cleanup", () => {
  let tearingDown = false;
  const observed: boolean[] = [];
  function Child() {
    useBeforePaint((signal) => {
      signal.addEventListener("abort", () => {
        if (tearingDown) event();
      });
    }, []);
    const event = useStableEvent((signal: AbortSignal) => {
      observed.push(signal.aborted);
    });
    return "child";
  }
  const root = createRoot(new FakeElement("root") as unknown as Element);
  flushSync(() => root.render(createElement(Child, null)));
  tearingDown = true;
  root.unmount();
  expect(observed).toEqual([true]);
});

it("retires an adopted hidden owner before effect cleanup can update it", async () => {
  let tearingDown = false;
  let fire: () => void = () => {};
  const observed: boolean[] = [];
  function Child() {
    useBeforePaint((signal) => {
      signal.addEventListener("abort", () => {
        if (tearingDown) fire();
      });
    }, []);
    const [value, setValue] = useState(0);
    const [, start] = useTransition();
    fire = () =>
      start((signal, update) => {
        observed.push(signal.aborted);
        update(() => setValue(1));
      });
    return String(value);
  }
  const child = createElement(Child, null);
  const container = new FakeElement("root");
  const root = createRoot(container as unknown as Element);
  try {
    flushSync(() =>
      root.render(createElement(Activity, { mode: "visible" }, child)),
    );
    tearingDown = true;
    flushSync(() =>
      root.render(createElement(Activity, { mode: "hidden" }, child)),
    );
    tearingDown = false;
    flushSync(() =>
      root.render(createElement(Activity, { mode: "visible" }, child)),
    );
    await waitForHostTurns();
    expect(observed).toEqual([true]);
    expect(container.textContent).toBe("0");
  } finally {
    tearingDown = false;
    root.unmount();
  }
});

it.each(["hide", "delete"] as const)(
  "retires sibling owners before subscription cleanup during %s, preserving kept siblings",
  async (mode) => {
    let tearingDown = false;
    let invoke = () => {};
    let keptEvent = () => {};
    const observed: boolean[] = [];
    const keptSignals: boolean[] = [];
    const subscribe = () => () => {
      if (tearingDown) {
        invoke();
        keptEvent();
      }
    };
    function Cleanup() {
      useSyncExternalStore(subscribe, () => 0);
      return "cleanup";
    }
    function Receiver() {
      const event = useStableEvent((signal: AbortSignal) => {
        observed.push(signal.aborted);
      });
      const [value, setValue] = useState(0);
      const [pending, start] = useTransition();
      const [actionValue, dispatch, actionPending] = useActionState(
        (_previous: string, next: string, signal: AbortSignal) => {
          observed.push(signal.aborted);
          return next;
        },
        "initial",
      );
      invoke = () => {
        event();
        start((signal, update) => {
          observed.push(signal.aborted);
          update(() => setValue(1));
        });
        dispatch("updated");
      };
      return `${value}:${pending}:${actionValue}:${actionPending}`;
    }
    function Kept() {
      keptEvent = useStableEvent((signal: AbortSignal) => {
        keptSignals.push(signal.aborted);
      });
      return "kept";
    }
    const cleanup = createElement(Cleanup, null);
    const receiver = createElement(Receiver, null);
    const kept = createElement(Kept, { key: "kept" });
    function tree(retiring: boolean) {
      const visibility = retiring && mode === "hide" ? "hidden" : "visible";
      return [
        createElement(
          "div",
          { key: "first" },
          retiring && mode === "delete"
            ? null
            : createElement(Activity, { mode: visibility }, cleanup),
        ),
        createElement(
          "div",
          { key: "second" },
          retiring && mode === "delete"
            ? null
            : createElement(Activity, { mode: visibility }, receiver),
        ),
        kept,
      ];
    }
    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);
    try {
      flushSync(() => root.render(tree(false)));
      tearingDown = true;
      flushSync(() => root.render(tree(true)));
      tearingDown = false;
      expect(observed).toEqual([true, true, true]);
      expect(keptSignals).toEqual([false]);
      if (mode === "hide") {
        flushSync(() => root.render(tree(false)));
        await waitForHostTurns();
        expect(container.textContent).toBe("cleanup0:false:initial:falsekept");
        invoke();
        await waitForHostTurns();
        expect(observed).toEqual([true, true, true, false, false, false]);
        expect(container.textContent).toBe("cleanup1:false:updated:falsekept");
      }
    } finally {
      tearingDown = false;
      root.unmount();
      await waitForHostTurns();
    }
  },
);

it("retires all owners before uncaught-error cleanup", () => {
  let tearingDown = false;
  let event = () => {};
  const observed: boolean[] = [];
  const errors: unknown[] = [];
  const error = new Error("render failed");
  function Cleanup() {
    useBeforePaint((signal) => {
      signal.addEventListener("abort", () => {
        if (tearingDown) event();
      });
    }, []);
    return "cleanup";
  }
  function Receiver() {
    event = useStableEvent((signal: AbortSignal) => {
      observed.push(signal.aborted);
    });
    return "receiver";
  }
  function Broken(): never {
    throw error;
  }
  const root = createRoot(new FakeElement("root") as unknown as Element, {
    onUncaughtError: (reason) => errors.push(reason),
  });
  try {
    flushSync(() =>
      root.render([
        createElement(Cleanup, { key: "cleanup" }),
        createElement(Receiver, { key: "receiver" }),
      ]),
    );
    tearingDown = true;
    expect(() =>
      flushSync(() => root.render(createElement(Broken, null))),
    ).toThrow(error);
    expect(errors).toEqual([error]);
    expect(observed).toEqual([true]);
  } finally {
    tearingDown = false;
    root.unmount();
  }
});

it.each(["hide", "delete", "unmount", "error"] as const)(
  "retires saved transition updates before sibling cleanup during %s",
  async (mode) => {
    let tearingDown = false;
    let start!: StartTransition;
    let savedUpdate!: TransitionUpdate;
    let updateValue!: (value: number) => void;
    let keptUpdate!: TransitionUpdate;
    let startKept!: StartTransition;
    let calls = 0;
    let keptCalls = 0;
    const pending = deferred<void>();
    const error = new Error("render failed");
    function Cleanup() {
      useBeforePaint((signal) => {
        signal.addEventListener("abort", () => {
          if (!tearingDown) return;
          savedUpdate(() => {
            calls += 1;
            updateValue(1);
          });
          keptUpdate(() => {
            keptCalls += 1;
          });
        });
      }, []);
      return null;
    }
    function Receiver() {
      const [value, setValue] = useState(0);
      const [isPending, run] = useTransition();
      start = run;
      updateValue = setValue;
      return `${value}:${isPending}`;
    }
    function Kept() {
      const [, run] = useTransition();
      startKept = run;
      return null;
    }
    function Broken(): never {
      throw error;
    }
    const children = [
      createElement(Cleanup, { key: "cleanup" }),
      createElement(Receiver, { key: "receiver" }),
    ];
    const kept = createElement(Kept, { key: "kept" });
    function tree(retiring: boolean) {
      return [
        retiring && mode === "delete"
          ? null
          : createElement(
              Activity,
              { key: "activity", mode: retiring ? "hidden" : "visible" },
              children,
            ),
        kept,
      ];
    }
    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element, {
      onUncaughtError: () => {},
    });
    try {
      flushSync(() => root.render(tree(false)));
      start((_signal, update) => {
        savedUpdate = update;
        return pending.promise;
      });
      startKept((_signal, update) => {
        keptUpdate = update;
        return pending.promise;
      });
      tearingDown = true;
      if (mode === "unmount") root.unmount();
      else if (mode === "error") {
        expect(() =>
          flushSync(() => root.render(createElement(Broken, null))),
        ).toThrow(error);
      } else flushSync(() => root.render(tree(true)));
      tearingDown = false;
      expect(calls).toBe(0);
      expect(keptCalls).toBe(mode === "hide" || mode === "delete" ? 1 : 0);
      if (mode === "hide") {
        flushSync(() => root.render(tree(false)));
        savedUpdate(() => {
          calls += 1;
          updateValue(1);
        });
        await waitForHostTurns();
        expect(calls).toBe(0);
        expect(container.textContent).toBe("0:false");
        start((_signal, update) => update(() => updateValue(2)));
        await waitForHostTurns();
        expect(container.textContent).toBe("2:false");
      }
    } finally {
      tearingDown = false;
      root.unmount();
      pending.resolve(undefined);
      await waitForHostTurns();
    }
  },
);
