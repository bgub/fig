// @vitest-environment happy-dom
import {
  Activity,
  createMixin,
  type FigNode,
  type MixinContext,
  readPromise,
  Suspense,
  transition,
  useState,
} from "@bgub/fig";
import { afterEach, expect, it } from "vitest";
import { createRoot, type FigRoot, flushSync, hostBinding } from "./index.ts";
import { act } from "./act.ts";

const roots: FigRoot[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await act(() => root.unmount());
  document.body.replaceChildren();
});
const behavior = createMixin(
  (
    context: MixinContext,
    owner: object,
    update: (node: Element, signal: AbortSignal) => undefined,
  ) => ({
    bind: [context.props.bind, hostBinding(context, owner, update)],
  }),
);

it.each(["callback", "host"] as const)(
  "aborts retained siblings when a %s binding throws during an update",
  (kind) => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container, { onUncaughtError() {} });
    roots.push(root);
    const owner = {};
    const signals: AbortSignal[] = [];
    const sibling = (_: Element, signal: AbortSignal): undefined => {
      signals.push(signal);
    };
    const view = (fail: boolean) => {
      const first = (_: Element, signal: AbortSignal): undefined => {
        signals.push(signal);
        if (fail) throw new Error("binding failed");
      };
      return kind === "callback" ? (
        <button bind={[first, sibling]} />
      ) : (
        <button mix={[behavior(owner, first), behavior(owner, sibling)]} />
      );
    };
    flushSync(() => root.render(view(false)));
    const retained = signals.at(-1)!;
    expect(retained.aborted).toBe(false);
    expect(() => flushSync(() => root.render(view(true)))).toThrow(
      "binding failed",
    );
    expect(container.childNodes.length).toBe(0);
    expect(retained.aborted).toBe(true);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
  },
);

async function render(node: FigNode) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  await act(() => root.render(node));
  return { host, root };
}

it("updates committed configuration without aborting a host's work", async () => {
  const owner = {};
  const seen: { value: number; signal: AbortSignal }[] = [];
  const view = (value: number) => (
    <button
      mix={behavior(owner, (_, signal) => {
        seen.push({ value, signal });
      })}
    />
  );
  const { root } = await render(view(1));
  const live = seen.at(-1)!.signal;
  await act(() => root.render(view(2)));
  expect(seen.at(-1)).toEqual({ value: 2, signal: live });
  expect(live.aborted).toBe(false);
  await act(() => root.unmount());
  expect(live.aborted).toBe(true);
});

it("retiring a conditional behavior does not restart its sibling", async () => {
  const first = {},
    second = {};
  const a: AbortSignal[] = [],
    b: AbortSignal[] = [];
  const view = (show: boolean) => (
    <button
      mix={[
        show &&
          behavior(first, (_, signal) => {
            a.push(signal);
          }),
        behavior(second, (_, signal) => {
          b.push(signal);
        }),
      ]}
    />
  );
  const { root } = await render(view(true));
  const liveA = a.at(-1)!,
    liveB = b.at(-1)!;
  await act(() => root.render(view(false)));
  expect(liveA.aborted).toBe(true);
  expect(b.at(-1)).toBe(liveB);
  expect(liveB.aborted).toBe(false);
});

it("replaces an owner on the same host before attaching its successor", async () => {
  const first = {},
    second = {};
  let live: AbortSignal | undefined;
  const order: string[] = [];
  const view = (owner: object) => (
    <button
      mix={behavior(owner, (_, signal) => {
        live = signal;
        order.push("update");
        signal.addEventListener("abort", () => order.push("abort"), {
          once: true,
        });
      })}
    />
  );
  const { host, root } = await render(view(first));
  const node = host.firstChild,
    old = live!;
  order.length = 0;
  await act(() => root.render(view(second)));
  expect(host.firstChild).toBe(node);
  expect(old.aborted).toBe(true);
  expect(order[0]).toBe("abort");
  expect(live).not.toBe(old);
});

it("ends a replaced host's lifetime even with the same owner and mixin slot", async () => {
  const owner = {};
  const signals: AbortSignal[] = [];
  const view = (key: string) => (
    <button
      key={key}
      mix={behavior(owner, (_, signal) => {
        signals.push(signal);
      })}
    />
  );
  const { root } = await render(view("a"));
  const old = signals.at(-1)!;
  await act(() => root.render(view("b")));
  expect(old.aborted).toBe(true);
  expect(signals.at(-1)).not.toBe(old);
});

it("does not publish a suspended render's host configuration", async () => {
  const owner = {},
    pending = new Promise<void>(() => {});
  const values: number[] = [];
  let advance = () => {};
  function Child({ value }: { value: number }): FigNode {
    const node = (
      <button
        mix={behavior(owner, () => {
          values.push(value);
        })}
      />
    );
    if (value === 2) readPromise(pending);
    return node;
  }
  function App(): FigNode {
    const [value, set] = useState(1);
    advance = () => transition(() => set(2));
    return (
      <Suspense fallback="loading">
        <Child value={value} />
      </Suspense>
    );
  }
  await render(<App />);
  values.length = 0;
  await act(advance);
  expect(values).toEqual([]);
});

it("ends and restarts work across Activity hiding with the latest configuration", async () => {
  const owner = {};
  const seen: { value: number; signal: AbortSignal }[] = [];
  const view = (hidden: boolean, value: number) => (
    <Activity mode={hidden ? "hidden" : "visible"}>
      <button
        mix={behavior(owner, (_, signal) => {
          seen.push({ value, signal });
        })}
      />
    </Activity>
  );
  const { root } = await render(view(false, 1));
  const live = seen.at(-1)!.signal;
  await act(() => root.render(view(true, 2)));
  expect(live.aborted).toBe(true);
  const count = seen.length;
  await act(() => root.render(view(true, 3)));
  expect(seen).toHaveLength(count);
  await act(() => root.render(view(false, 4)));
  expect(seen.at(-1)!.value).toBe(4);
  expect(seen.at(-1)!.signal.aborted).toBe(false);
  expect(seen.at(-1)!.signal).not.toBe(live);
});

it("keeps raw callback lifetimes independent from composed host behavior updates", async () => {
  const owner = {};
  const rawSignals: AbortSignal[] = [],
    hostSignals: AbortSignal[] = [];
  const raw = (_: Element, signal: AbortSignal): undefined => {
    rawSignals.push(signal);
  };
  const view = (value: number) => (
    <button
      bind={raw}
      mix={behavior(owner, (node, signal) => {
        node.textContent = String(value);
        hostSignals.push(signal);
      })}
    />
  );
  const { root } = await render(view(1));
  const rawCount = rawSignals.length,
    live = hostSignals.at(-1)!;
  await act(() => root.render(view(2)));
  expect(rawSignals).toHaveLength(rawCount);
  expect(rawSignals.at(-1)!.aborted).toBe(false);
  expect(hostSignals.at(-1)).toBe(live);
});

it("adding a composed host behavior does not replace an authored callback's lifetime", async () => {
  const owner = {};
  const signals: AbortSignal[] = [];
  const raw = (_: Element, signal: AbortSignal): undefined => {
    signals.push(signal);
  };
  const view = (enabled: boolean) => (
    <button bind={raw} mix={enabled && behavior(owner, () => {})} />
  );
  const { root } = await render(view(false));
  const live = signals.at(-1)!;
  const count = signals.length;
  await act(() => root.render(view(true)));
  expect(signals).toHaveLength(count);
  expect(live.aborted).toBe(false);
  await act(() => root.render(view(false)));
  expect(signals).toHaveLength(count);
  expect(live.aborted).toBe(false);
});
