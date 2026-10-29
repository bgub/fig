// @vitest-environment happy-dom
import {
  type FigNode,
  readPromise,
  Suspense,
  transition,
  useState,
} from "@bgub/fig";
import { createRoot, type FigRoot } from "@bgub/fig-dom";
import { act } from "@bgub/fig-dom/test-utils";
import { afterEach, expect, it, vi } from "vitest";
import { createChangeDetails, type ChangeDetails } from "./changes.ts";
import { requestChanges, useControllableValue } from "./controllable-value.ts";

const roots: FigRoot[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await act(() => root.unmount());
  document.body.replaceChildren();
});
async function mount(node: FigNode) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  await act(() => root.render(node));
  return { root, host };
}
const details = () => createChangeDetails(null);

async function counter(
  options: {
    value?: number;
    defaultValue?: number;
    onChange?: (value: number, details: ChangeDetails) => void;
  } = {},
) {
  let state!: ReturnType<typeof useControllableValue<number>>;
  const reconcile = vi.fn();
  function App({ value = options.value }: { value?: number }): FigNode {
    state = useControllableValue({
      ...options,
      value,
      defaultValue: options.defaultValue ?? 0,
      reconcile,
    });
    return String(state.value);
  }
  const { root, host } = await mount(<App />);
  return {
    get state() {
      return state;
    },
    host,
    reconcile,
    render: (value: number | undefined) =>
      act(() => root.render(<App value={value} />)),
  };
}

it("composes accepted uncontrolled requests before a render and notifies exactly once", async () => {
  const change = vi.fn();
  const c = await counter({ onChange: change });
  await act(() => {
    c.state.request((n) => n + 1, details());
    c.state.request((n) => n + 1, details());
  });
  expect(c.host.textContent).toBe("2");
  expect(change.mock.calls.map((call) => call[0])).toEqual([1, 2]);
});

it("does not turn a controlled request into an optimistic controlled value", async () => {
  const change = vi.fn();
  const c = await counter({ value: 0, onChange: change });
  await act(() => {
    c.state.request((n) => n + 1, details());
    c.state.request((n) => n + 1, details());
  });
  expect(c.host.textContent).toBe("0");
  expect(change.mock.calls.map((call) => call[0])).toEqual([1, 1]);
  expect(c.reconcile).toHaveBeenCalledTimes(2);
});

it("canceled requests leave no pending intent for the next request", async () => {
  const change = vi.fn((_: number, d: ChangeDetails) => {
    if (change.mock.calls.length === 1) d.cancel();
  });
  const c = await counter({ onChange: change });
  await act(() => {
    c.state.request((n) => n + 1, details());
    c.state.request((n) => n + 1, details());
  });
  expect(c.host.textContent).toBe("1");
  expect(change.mock.calls.map((call) => call[0])).toEqual([1, 1]);
  expect(c.reconcile).not.toHaveBeenCalled();
});

it("does not notify for equal requests", async () => {
  const change = vi.fn();
  const c = await counter({ onChange: change });
  await act(() => c.state.request((n) => n, details()));
  expect(change).not.toHaveBeenCalled();
});

it("keeps the newest request when a notification reenters the owner", async () => {
  const c = await counter({
    onChange: (value) => {
      if (value === 1) c.state.request(() => 2, details());
    },
  });
  await act(() => c.state.request(() => 1, details()));
  expect(c.host.textContent).toBe("2");
  expect(c.state.current()).toBe(2);
});

it("reset retires an in-flight proposal and restores the initial default", async () => {
  const c = await counter({
    defaultValue: 3,
    onChange: (value) => {
      if (value === 4) c.state.reset();
    },
  });
  await act(() => c.state.request(() => 4, details()));
  expect(c.host.textContent).toBe("3");
});

it("uses the initial default even if a later render supplies a different default", async () => {
  let state!: ReturnType<typeof useControllableValue<number>>;
  const onChange = vi.fn();
  function App({ initial }: { initial: number }): FigNode {
    state = useControllableValue({
      value: undefined,
      defaultValue: initial,
      onChange,
      reconcile: () => {},
    });
    return String(state.value);
  }
  const { root, host } = await mount(<App initial={3} />);
  await act(() => state.request(() => 5, details()));
  await act(() => root.render(<App initial={8} />));
  await act(state.reset);
  expect(host.textContent).toBe("3");
  expect(onChange).toHaveBeenCalledOnce();
});

it("accepts function values without executing them as state updaters", async () => {
  const first = vi.fn(),
    next = vi.fn();
  let state!: ReturnType<typeof useControllableValue<() => void>>;
  function App(): FigNode {
    state = useControllableValue<() => void>({
      value: undefined,
      defaultValue: first,
      reconcile: () => {},
    });
    return null;
  }
  await mount(<App />);
  await act(() => state.request(() => next, details()));
  expect(state.value).toBe(next);
  expect(first).not.toHaveBeenCalled();
  expect(next).not.toHaveBeenCalled();
});

it("cancels all proposed fields when either callback rejects a compound change", async () => {
  let a!: ReturnType<typeof useControllableValue<number>>, b!: typeof a;
  const observed: number[][] = [];
  function App(): FigNode {
    a = useControllableValue({
      value: undefined,
      defaultValue: 0,
      onChange: () => {
        observed.push([a.current(), b.current()]);
      },
      reconcile: () => {},
    });
    b = useControllableValue({
      value: undefined,
      defaultValue: 0,
      onChange: (_, d) => d.cancel(),
      reconcile: () => {},
    });
    return `${a.value}:${b.value}`;
  }
  const { host } = await mount(<App />);
  await act(() =>
    requestChanges(
      details(),
      a.propose(() => 1),
      b.propose(() => 2),
    ),
  );
  expect(host.textContent).toBe("0:0");
  expect(observed).toEqual([[0, 0]]);
});

it("publishes controlled props only when their render commits", async () => {
  const pending = new Promise<void>(() => {}),
    changes: number[] = [];
  let state!: ReturnType<typeof useControllableValue<number>>,
    suspend = () => {};
  function Child({ value }: { value: number }): FigNode {
    state = useControllableValue({
      value,
      defaultValue: 0,
      onChange: (n) => {
        changes.push(n);
      },
      reconcile: () => {},
    });
    if (value === 10) readPromise(pending);
    return String(state.value);
  }
  function App(): FigNode {
    const [value, setValue] = useState(0);
    suspend = () => transition(() => setValue(10));
    return (
      <Suspense fallback="loading">
        <Child value={value} />
      </Suspense>
    );
  }
  const { host } = await mount(<App />);
  await act(suspend);
  await act(() => state.request((n) => n + 1, details()));
  expect(host.textContent).toBe("0");
  expect(changes).toEqual([1]);
});

it("retains uncontrolled intent through a suspended lane and an urgent unrelated commit", async () => {
  const pending = new Promise<void>(() => {}),
    changes: number[] = [];
  let state!: ReturnType<typeof useControllableValue<number>>,
    urgent = () => {};
  function Child(): FigNode {
    const [other, setOther] = useState(0);
    urgent = () => setOther((n) => n + 1);
    state = useControllableValue({
      value: undefined,
      defaultValue: 0,
      onChange: (n) => {
        changes.push(n);
      },
      reconcile: () => {},
    });
    if (state.value === 1) readPromise(pending);
    return `${state.value}:${other}`;
  }
  const { host } = await mount(
    <Suspense fallback="loading">
      <Child />
    </Suspense>,
  );
  await act(() => transition(() => state.request((n) => n + 1, details())));
  await act(urgent);
  expect(host.textContent).toBe("0:1");
  await act(() => state.request((n) => n + 1, details()));
  expect(host.textContent).toBe("2:1");
  expect(changes).toEqual([1, 2]);
});

it("retires an entire compound proposal if one field is changed reentrantly", async () => {
  let a!: ReturnType<typeof useControllableValue<number>>, b!: typeof a;
  const notifyB = vi.fn();
  function App(): FigNode {
    a = useControllableValue({
      value: undefined,
      defaultValue: 0,
      onChange: (n) => {
        if (n === 1) a.request(() => 3, details());
      },
      reconcile: () => {},
    });
    b = useControllableValue({
      value: undefined,
      defaultValue: 0,
      onChange: notifyB,
      reconcile: () => {},
    });
    return `${a.value}:${b.value}`;
  }
  const { host } = await mount(<App />);
  let accepted = true;
  await act(() => {
    accepted = requestChanges(
      details(),
      a.propose(() => 1),
      b.propose(() => 2),
    );
  });
  expect(accepted).toBe(false);
  expect(host.textContent).toBe("3:0");
  expect(notifyB).not.toHaveBeenCalled();
});

it("uses committed mode switches without carrying controlled requests into uncontrolled intent", async () => {
  const c = await counter();
  await act(() => c.state.request(() => 2, details()));
  await c.render(10);
  await act(() => c.state.request((n) => n + 1, details()));
  expect(c.state.current()).toBe(10);
  await c.render(undefined);
  await act(() => c.state.request((n) => n + 1, details()));
  expect(c.host.textContent).toBe("3");
});

it("reconciles native state after a canceled event request", async () => {
  const c = await counter({ onChange: (_, d) => d.cancel() });
  await act(() =>
    c.state.request(() => 1, createChangeDetails(new Event("change"))),
  );
  expect(c.host.textContent).toBe("0");
  expect(c.reconcile).toHaveBeenCalledOnce();
});
