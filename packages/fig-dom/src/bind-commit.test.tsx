// @vitest-environment happy-dom
import { Activity, createMixin, useBeforePaint, useState } from "@bgub/fig";
import { afterEach, expect, it, vi } from "vitest";
import { act } from "./act.ts";
import {
  createPortal,
  createRoot,
  flushSync,
  hostBinding,
  hydrateRoot,
  on,
  type Bind,
  type FigRoot,
} from "./index.ts";

const roots: FigRoot[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) root.unmount();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

const behavior = createMixin((context, owner: object, callback: Bind) => ({
  bind: hostBinding(context, owner, callback),
}));

function container() {
  const host = document.createElement("div");
  document.body.append(host);
  return host;
}

it.each(["callback", "host"] as const)(
  "runs %s bindings after all mutations and restoration, before before-paint effects",
  (kind) => {
    const host = container();
    const outside = document.createElement("button");
    document.body.append(outside);
    outside.focus();
    const root = createRoot(host);
    roots.push(root);
    const owner = {};
    const observations: string[] = [];
    const signals: AbortSignal[] = [];
    function App({ value }: { value: string }) {
      useBeforePaint(() => {
        observations.push(`effect:${document.activeElement?.id}`);
      }, [value]);
      const callback: Bind = (node, signal) => {
        observations.push(`bind:${host.querySelector("output")?.textContent}`);
        signals.push(signal);
        (node as HTMLInputElement).focus();
      };
      return (
        <>
          <input
            id="target"
            bind={kind === "callback" ? callback : undefined}
            mix={[
              kind === "host" && behavior(owner, callback),
              on("focus", () => {
                observations.push("focus");
              }),
            ]}
          />
          <output>{value}</output>
        </>
      );
    }
    flushSync(() => root.render(<App value="first" />));
    expect(observations).toEqual([
      "bind:first",
      "focus",
      "bind:first",
      "effect:target",
      "effect:target",
    ]);
    const live = signals.at(-1)!;
    observations.length = 0;
    outside.focus();
    flushSync(() => root.render(<App value="second" />));
    expect(observations).toEqual(["bind:second", "focus", "effect:target"]);
    expect(signals.at(-1) === live).toBe(kind === "host");
    expect(live.aborted).toBe(kind === "callback");
  },
);

it.each(["selection", "blur"] as const)(
  "lets an updated binding choose %s after restoration",
  (action) => {
    const host = container();
    const root = createRoot(host);
    roots.push(root);
    flushSync(() => root.render(<input defaultValue="Selected text" />));
    const input = host.firstElementChild as HTMLInputElement;
    input.focus();
    input.setSelectionRange(2, 8);
    flushSync(() =>
      root.render(
        <input
          defaultValue="Selected text"
          bind={(node) => {
            if (action === "blur") node.blur();
            else node.setSelectionRange(0, 3);
          }}
        />,
      ),
    );
    if (action === "blur") expect(document.activeElement).toBe(document.body);
    else expect([input.selectionStart, input.selectionEnd]).toEqual([0, 3]);
  },
);

it("runs hydration bindings against the completed sibling tree", () => {
  const host = container();
  host.innerHTML = '<input id="target"><output>ready</output>';
  const outside = document.createElement("button");
  document.body.append(outside);
  outside.focus();
  const seen: string[] = [];
  const root = flushSync(() =>
    hydrateRoot(
      host,
      <>
        <input
          id="target"
          bind={(node) => {
            node.focus();
          }}
        />
        <output
          bind={() => {
            seen.push(document.activeElement?.id ?? "");
          }}
        >
          ready
        </output>
      </>,
    ),
  );
  roots.push(root);
  expect(seen).toEqual(["target", "target"]);
  expect(document.activeElement).toBe(host.firstElementChild);
});

it("skips host updates hidden in the same commit and focuses on reveal", () => {
  const host = container();
  const outside = document.createElement("button");
  document.body.append(outside);
  const root = createRoot(host);
  roots.push(root);
  const owner = {};
  const seen: number[] = [];
  const signals: AbortSignal[] = [];
  const view = (hidden: boolean, value: number) => (
    <Activity mode={hidden ? "hidden" : "visible"}>
      <input
        mix={behavior(owner, (node, signal) => {
          seen.push(value);
          signals.push(signal);
          (node as HTMLInputElement).focus();
        })}
      />
    </Activity>
  );
  flushSync(() => root.render(view(false, 1)));
  const live = signals.at(-1)!;
  seen.length = 0;
  outside.focus();
  flushSync(() => root.render(view(true, 2)));
  expect(seen).toEqual([]);
  expect(live.aborted).toBe(true);
  expect(document.activeElement).toBe(outside);
  flushSync(() => root.render(view(false, 3)));
  expect(seen).toEqual([3]);
  expect(signals.at(-1)).not.toBe(live);
  expect(document.activeElement).toBe(host.firstElementChild);
});

it("finishes pending bindings before flushing state scheduled by a binding", async () => {
  const host = container();
  const root = createRoot(host);
  roots.push(root);
  const seen: string[] = [];
  function App() {
    const [value, set] = useState(0);
    return (
      <>
        <button
          bind={() => {
            if (value === 0) set(1);
          }}
        />
        <output
          bind={() => {
            seen.push(host.textContent!);
          }}
        >
          {value}
        </output>
      </>
    );
  }
  await act(() => root.render(<App />));
  expect(seen).toEqual(["0", "0", "1"]);
  expect(host.textContent).toBe("1");
});

it("discards pending bindings when a later mutation fails", () => {
  const host = container();
  const root = createRoot(host, { onUncaughtError() {} });
  roots.push(root);
  const bind = vi.fn();
  const insert = host.insertBefore.bind(host);
  const spy = vi
    .spyOn(host, "insertBefore")
    .mockImplementation((node, before) => {
      if (node instanceof HTMLOutputElement)
        throw new Error("insertion failed");
      return insert(node, before);
    });
  expect(() =>
    flushSync(() =>
      root.render(
        <>
          <input bind={bind} />
          <output />
        </>,
      ),
    ),
  ).toThrow("insertion failed");
  expect(bind).not.toHaveBeenCalled();
  expect(host.childNodes).toHaveLength(0);
  spy.mockRestore();
  flushSync(() => root.render(<input bind={bind} />));
  expect(bind).toHaveBeenCalledTimes(2);
});

it("keeps binding queues isolated when a callback schedules another root", () => {
  const firstHost = container();
  const secondHost = container();
  const first = createRoot(firstHost);
  const second = createRoot(secondHost);
  roots.push(first, second);
  const seen: string[] = [];
  const secondView = (
    <button
      bind={() => {
        seen.push("other root");
      }}
    />
  );
  flushSync(() =>
    first.render(
      <>
        <button
          bind={() => {
            seen.push("first");
            flushSync(() => second.render(secondView));
          }}
        />
        <button
          bind={() => {
            seen.push("sibling");
          }}
        />
      </>,
    ),
  );
  expect(seen).toEqual([
    "first",
    "first",
    "sibling",
    "sibling",
    "other root",
    "other root",
  ]);
});

it("reports the throwing binding's component and cancels the remaining callbacks", () => {
  const host = container();
  const reports: string[] = [];
  const root = createRoot(host, {
    onUncaughtError(_error, info) {
      reports.push(info.componentStack);
    },
  });
  roots.push(root);
  const pending = vi.fn();
  const signals: AbortSignal[] = [];
  function BindingOwner() {
    return (
      <input
        bind={(_, signal) => {
          signals.push(signal);
          throw new Error("binding failed");
        }}
      />
    );
  }
  function Unrelated() {
    return <span />;
  }
  expect(() =>
    flushSync(() =>
      root.render(
        <>
          <Unrelated />
          <BindingOwner />
          <input bind={pending} />
        </>,
      ),
    ),
  ).toThrow("binding failed");
  expect(reports).toHaveLength(1);
  expect(reports[0]).toContain("at BindingOwner");
  expect(reports[0]).not.toContain("at Unrelated");
  expect(pending).not.toHaveBeenCalled();
  expect(signals.every((signal) => signal.aborted)).toBe(true);
  expect(host.childNodes).toHaveLength(0);
  flushSync(() => root.render(<input bind={pending} />));
  expect(pending).toHaveBeenCalledTimes(2);
});

it.each(["callback", "host"] as const)(
  "preserves %s binding lifetimes across keyed moves",
  (kind) => {
    const host = container();
    const root = createRoot(host);
    roots.push(root);
    const owner = {};
    const signals: AbortSignal[] = [];
    const observed: string[][] = [];
    const callback: Bind = (_, signal) => {
      signals.push(signal);
      observed.push(Array.from(host.children, (node) => node.id));
    };
    const view = (keys: string[]) =>
      keys.map((key) => (
        <input
          key={key}
          id={key}
          bind={key === "a" && kind === "callback" ? callback : undefined}
          mix={key === "a" && kind === "host" && behavior(owner, callback)}
        />
      ));
    flushSync(() => root.render(view(["a", "b"])));
    const original = host.firstElementChild;
    const live = signals.at(-1)!;
    observed.length = 0;
    flushSync(() => root.render(view(["b", "a"])));
    expect(host.lastElementChild).toBe(original);
    expect(observed).toEqual(kind === "host" ? [["b", "a"]] : []);
    expect(signals).toHaveLength(kind === "host" ? 3 : 2);
    expect(signals.at(-1)).toBe(live);
    expect(live.aborted).toBe(false);
  },
);

it("activates portal bindings after the whole root's mutations and restoration", () => {
  const host = container();
  const portal = container();
  const outside = document.createElement("button");
  document.body.append(outside);
  outside.focus();
  const root = createRoot(host);
  roots.push(root);
  const seen: string[] = [];
  flushSync(() =>
    root.render(
      <>
        {createPortal(
          <input
            bind={(node) => {
              seen.push(host.textContent!);
              node.focus();
            }}
          />,
          portal,
        )}
        <output>ready</output>
      </>,
    ),
  );
  expect(seen).toEqual(["ready", "ready"]);
  expect(document.activeElement).toBe(portal.firstElementChild);
});

it.each(["mount", "update"] as const)(
  "attributes a shared asset's throwing binding to its declaring component on %s",
  (phase) => {
    const host = container();
    const reports: string[] = [];
    const root = createRoot(host, {
      onUncaughtError(_error, info) {
        reports.push(info.componentStack);
      },
    });
    roots.push(root);
    function BindingOwner({ fail }: { fail: boolean }) {
      return (
        <link
          rel="preload"
          as="script"
          href="/binding-owner.js"
          bind={() => {
            if (fail) throw new Error("owner failed");
          }}
        />
      );
    }
    function InnocentOwner() {
      return <link rel="preload" as="script" href="/binding-owner.js" />;
    }
    const view = (fail: boolean) => (
      <>
        <BindingOwner fail={fail} />
        <InnocentOwner />
      </>
    );
    try {
      if (phase === "update") flushSync(() => root.render(view(false)));
      expect(() => flushSync(() => root.render(view(true)))).toThrow(
        "owner failed",
      );
      expect(reports).toHaveLength(1);
      expect(reports[0]).toContain("at BindingOwner");
      expect(reports[0]).not.toContain("at InnocentOwner");
    } finally {
      root.unmount();
      document.head.querySelector('link[href="/binding-owner.js"]')?.remove();
    }
  },
);

it("attributes a metadata winner's binding failure independently of fiber order", () => {
  const host = container();
  const reports: string[] = [];
  const root = createRoot(host, {
    onUncaughtError(_error, info) {
      reports.push(info.componentStack);
    },
  });
  roots.push(root);
  function BindingOwner() {
    return (
      <meta
        name="binding-review"
        content="new"
        bind={() => {
          throw new Error("metadata failed");
        }}
      />
    );
  }
  function InnocentOwner() {
    return <meta name="binding-review" content="old" />;
  }
  flushSync(() => root.render(<InnocentOwner key="old" />));
  expect(() =>
    flushSync(() =>
      root.render([<BindingOwner key="new" />, <InnocentOwner key="old" />]),
    ),
  ).toThrow("metadata failed");
  expect(reports).toHaveLength(1);
  expect(reports[0]).toContain("at BindingOwner");
  expect(reports[0]).not.toContain("at InnocentOwner");
  expect(document.head.querySelector('meta[name="binding-review"]')).toBeNull();
});
