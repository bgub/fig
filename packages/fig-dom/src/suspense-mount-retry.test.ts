// @vitest-environment happy-dom
import {
  createElement as h,
  Suspense,
  readPromise,
  createDataStore,
  dataResource,
  readData,
  useState,
  useMemo,
  useId,
  useBeforePaint,
  type StateSetter,
} from "@bgub/fig";
import { it, expect } from "vitest";
import { createRoot, flushSync } from "./index.ts";
import { deferred, waitForHostTurns } from "./test-utils.ts";

it.each(["replace", "remove", "nested-replace"])(
  "reveals fresh structural data changes: %s",
  async (mode) => {
    const gate = deferred<void>();
    const resource = dataResource<[], boolean>({ key: () => ["shape"] });
    const store = createDataStore({
      initialData: [{ key: ["shape"], value: false }],
    });
    const container = document.createElement("div");
    const errors: unknown[] = [];
    const root = createRoot(container, {
      dataStore: store,
      onUncaughtError: (error) => errors.push(error),
    });
    function Reader() {
      const next = readData(resource);
      const child = next
        ? mode === "remove"
          ? null
          : h("strong", null, "new")
        : h("span", null, "old");
      return mode === "nested-replace" ? h("div", null, child) : child;
    }
    function Pending() {
      readPromise(gate.promise);
      return "ready";
    }
    try {
      flushSync(() =>
        root.render(
          h(
            Suspense,
            { fallback: "waiting" },
            h("section", null, h(Reader)),
            h(Pending),
          ),
        ),
      );
      expect(container.textContent).toBe("waiting");
      store.hydrate([{ key: ["shape"], value: true }]);
      gate.resolve();
      await waitForHostTurns();
      expect(errors).toEqual([]);
      expect(container.textContent).toBe(
        mode === "remove" ? "ready" : "newready",
      );
    } finally {
      flushSync(() => root.unmount());
    }
  },
);

it.each(["empty-children", "removed-props"])(
  "rebuilds speculative host output: %s",
  async (mode) => {
    const gate = deferred<void>();
    const resource = dataResource<[], boolean>({ key: () => ["shape"] });
    const store = createDataStore({
      initialData: [{ key: ["shape"], value: false }],
    });
    const container = document.createElement("div");
    const errors: unknown[] = [];
    const root = createRoot(container, {
      dataStore: store,
      onUncaughtError: (error) => errors.push(error),
    });
    function Reader() {
      const next = readData(resource);
      return mode === "empty-children"
        ? h("div", null, next ? null : h("span", null, "old"))
        : h(
            "div",
            next ? {} : { title: "old", style: { color: "red" } },
            "value",
          );
    }
    function Pending() {
      readPromise(gate.promise);
      return "ready";
    }
    try {
      flushSync(() =>
        root.render(
          h(Suspense, { fallback: "waiting" }, h(Reader), h(Pending)),
        ),
      );
      store.hydrate([{ key: ["shape"], value: true }]);
      gate.resolve();
      await waitForHostTurns();
      expect(errors).toEqual([]);
      const revealed = container.firstElementChild!;
      if (mode === "empty-children") expect(revealed.childNodes.length).toBe(0);
      else {
        expect(revealed.hasAttribute("title")).toBe(false);
        expect((revealed as HTMLElement).style.color).toBe("");
      }
    } finally {
      flushSync(() => root.unmount());
    }
  },
);

it("retains hook identity and mounts effects only after repeated retries reveal", async () => {
  const gates = [deferred<void>(), deferred<void>()];
  const container = document.createElement("div");
  const root = createRoot(container);
  let initializations = 0;
  let memoizations = 0;
  let liveEffects = 0;
  let latestId = "";
  let update: StateSetter<number> = () => {};
  function Reader() {
    const [count, setCount] = useState(() => {
      initializations++;
      return 1;
    });
    update = setCount;
    const label = useMemo(() => {
      memoizations++;
      return "value";
    }, []);
    latestId = useId();
    useBeforePaint((signal) => {
      liveEffects++;
      signal.addEventListener(
        "abort",
        () => {
          liveEffects--;
        },
        { once: true },
      );
    }, []);
    return h("div", { id: latestId }, `${label}:${count}`);
  }
  function Pending() {
    for (const gate of gates) readPromise(gate.promise);
    return "ready";
  }
  try {
    flushSync(() =>
      root.render(h(Suspense, { fallback: "waiting" }, h(Reader), h(Pending))),
    );
    const id = latestId;
    const initialCount = initializations;
    const memoCount = memoizations;
    expect(liveEffects).toBe(0);
    gates[0].resolve();
    await waitForHostTurns();
    expect(container.textContent).toBe("waiting");
    expect(liveEffects).toBe(0);
    gates[1].resolve();
    await waitForHostTurns();
    expect(container.textContent).toBe("value:1ready");
    expect(latestId).toBe(id);
    expect(initializations).toBe(initialCount);
    expect(memoizations).toBe(memoCount);
    expect(liveEffects).toBe(1);
    const element = container.firstElementChild;
    flushSync(() => update(2));
    expect(container.textContent).toBe("value:2ready");
    expect(container.firstElementChild).toBe(element);
    flushSync(() => root.render("replacement"));
    expect(liveEffects).toBe(0);
    flushSync(() => update(3));
    expect(container.textContent).toBe("replacement");
  } finally {
    flushSync(() => root.unmount());
  }
  expect(liveEffects).toBe(0);
});
