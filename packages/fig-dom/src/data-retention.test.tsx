import {
  Activity,
  createDataStore,
  createElement,
  dataResource,
  readData,
  readPromise,
  Suspense,
  useState,
} from "@bgub/fig";
import type { FigDataStore } from "@bgub/fig/internal";
import { expect, it, vi } from "vitest";
import { createRoot, flushSync, hydrateRoot } from "./index.ts";
import {
  FakeComment,
  FakeElement,
  FakeText,
  installFakeDocument,
} from "./test-utils.ts";

installFakeDocument();
const retentionMs = 5 * 60 * 1000;

it.each([
  ["initial", "adopted"],
  ["pushed", "adopted"],
  ["initial", "default"],
  ["pushed", "default"],
])("evicts unclaimed %s hydration in a %s store", (source, kind) => {
  vi.useFakeTimers();
  const entries = [{ key: ["unused"] as const, value: "server value" }];
  const initialData = source === "initial" ? entries : undefined;
  const root = createRoot(
    new FakeElement("root") as unknown as Element,
    kind === "adopted"
      ? { dataStore: createDataStore({ initialData }) }
      : { initialData },
  );
  const store = root.data as FigDataStore;
  try {
    flushSync(() => root.render("elsewhere"));
    if (source === "pushed") store.hydrate(entries);
    vi.advanceTimersByTime(retentionMs - 1);
    expect(store.snapshot()).toEqual(entries);
    vi.advanceTimersByTime(1);
    expect(store.snapshot()).toEqual([]);
  } finally {
    flushSync(() => root.unmount());
    vi.useRealTimers();
  }
});

it.each([
  ["adopted", "reveal"],
  ["default", "reveal"],
  ["installed", "reveal"],
  ["adopted", "discard"],
  ["default", "discard"],
  ["installed", "discard"],
])(
  "retains deferred Activity hydration in a %s store until %s",
  (kind, action) => {
    vi.useFakeTimers();
    const entries = [{ key: ["secret"] as const, value: "secret tab" }];
    const resource = dataResource<[], string>({ key: () => ["secret"] });
    let reveal = () => {};
    let childRenders = 0;
    function Child() {
      childRenders += 1;
      return createElement("span", null, readData(resource));
    }
    function App() {
      const [mode, setMode] = useState<"visible" | "hidden">("hidden");
      reveal = () => setMode("visible");
      return createElement(Activity, { mode }, createElement(Child));
    }
    const container = new FakeElement("root");
    const template = new FakeElement("template");
    template.setAttribute("data-fig-activity", "");
    const span = new FakeElement("span");
    span.appendChild(new FakeText("secret tab"));
    template.appendChild(span);
    container.appendChild(template);
    const root = flushSync(() =>
      hydrateRoot(
        container as unknown as Element,
        createElement(App),
        kind === "adopted"
          ? { dataStore: createDataStore({ initialData: entries }) }
          : { initialData: entries },
      ),
    );
    const store = root.data as FigDataStore;
    try {
      expect(childRenders).toBe(0);
      if (kind !== "default") {
        // Installing the lazy store must transfer hydration ownership. The
        // unrelated loaded value must still expire while hydration is deferred.
        void root.data.refreshData(
          dataResource({
            key: () => ["unrelated"],
            load: () => "client value",
          }),
        );
      }
      vi.advanceTimersByTime(retentionMs * 2);
      expect(store.snapshot()).toEqual(entries);
      if (action === "reveal") {
        flushSync(reveal);
        expect(container.childNodes[0]).toBe(span);
        expect(container.textContent).toBe("secret tab");
        vi.advanceTimersByTime(retentionMs * 2);
        expect(store.snapshot()).toEqual(entries);
      }
      flushSync(() => root.render("elsewhere"));
      vi.advanceTimersByTime(retentionMs - 1);
      expect(store.snapshot()).toEqual(entries);
      vi.advanceTimersByTime(1);
      expect(store.snapshot()).toEqual([]);
    } finally {
      flushSync(() => root.unmount());
      vi.useRealTimers();
    }
  },
);

it("expires buffered hydration batches independently and cancels timers on disposal", () => {
  vi.useFakeTimers();
  const first = [{ key: ["first"] as const, value: "first" }];
  const second = [{ key: ["second"] as const, value: "second" }];
  const root = createRoot(new FakeElement("root") as unknown as Element, {
    initialData: first,
  });
  const store = root.data as FigDataStore;
  try {
    vi.advanceTimersByTime(retentionMs / 2);
    root.data.hydrate(second);
    vi.advanceTimersByTime(retentionMs / 2);
    expect(store.snapshot()).toEqual(second);
    flushSync(() => root.unmount());
    root.data.hydrate(first);
    expect(store.snapshot()).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    flushSync(() => root.unmount());
    vi.useRealTimers();
  }
});

it.each(["default", "adopted"])(
  "retains pushed data for pending Suspense in a %s store until discard",
  (kind) => {
    vi.useFakeTimers();
    const entries = [{ key: ["streamed"] as const, value: "server value" }];
    const container = new FakeElement("root");
    container.appendChild(new FakeComment("fig:suspense:pending:0"));
    container.appendChild(new FakeElement("template"));
    const fallback = new FakeElement("span");
    fallback.appendChild(new FakeText("loading"));
    container.appendChild(fallback);
    container.appendChild(new FakeComment("/fig:suspense"));
    const resource = dataResource<[], string>({ key: () => ["streamed"] });
    function Reader() {
      return createElement("span", null, readData(resource));
    }
    const root = flushSync(() =>
      hydrateRoot(
        container as unknown as Element,
        createElement(
          Suspense,
          { fallback: createElement("span", null, "loading") },
          createElement(Reader),
        ),
        kind === "adopted" ? { dataStore: createDataStore() } : {},
      ),
    );
    const store = root.data as FigDataStore;
    try {
      root.data.hydrate(entries);
      vi.advanceTimersByTime(retentionMs * 2);
      expect(container.textContent).toBe("loading");
      expect(store.snapshot()).toEqual(entries);
      flushSync(() => root.render("elsewhere"));
      vi.advanceTimersByTime(retentionMs);
      expect(store.snapshot()).toEqual([]);
    } finally {
      flushSync(() => root.unmount());
      vi.useRealTimers();
    }
  },
);

it("evicts a cached value read by a discarded Suspense render", async () => {
  vi.useFakeTimers();
  const store = createDataStore();
  const signals = new Map<string, AbortSignal>();
  const resource = dataResource({
    key: (id: string) => ["value", id],
    load: (id: string, { signal }) => {
      signals.set(id, signal);
      return id;
    },
  });
  const container = new FakeElement("root");
  const root = createRoot(container as unknown as Element, {
    dataStore: store,
  });
  const never = new Promise<never>(() => undefined);
  function Reader() {
    readData(resource, "abandoned");
    return readPromise(never);
  }
  try {
    await store.refreshData(resource, "control");
    await store.refreshData(resource, "abandoned");
    flushSync(() =>
      root.render(
        createElement(Suspense, { fallback: "loading" }, createElement(Reader)),
      ),
    );
    expect(container.textContent).toBe("loading");
    flushSync(() => root.render("elsewhere"));
    vi.advanceTimersByTime(retentionMs - 1);
    expect(signals.get("abandoned")?.aborted).toBe(false);
    vi.advanceTimersByTime(1);
    expect(store.snapshot()).toEqual([]);
    expect(signals.get("control")?.reason).toBe("evicted");
    expect(signals.get("abandoned")?.reason).toBe("evicted");
  } finally {
    flushSync(() => root.unmount());
    vi.useRealTimers();
  }
});

it("retains a committed hydrated value until its reader unmounts", () => {
  vi.useFakeTimers();
  const entries = [{ key: ["claimed"] as const, value: "server value" }];
  const store = createDataStore({ initialData: entries });
  const resource = dataResource<[], string>({ key: () => ["claimed"] });
  const root = createRoot(new FakeElement("root") as unknown as Element, {
    dataStore: store,
  });
  function Reader() {
    return createElement("span", null, readData(resource));
  }
  try {
    flushSync(() => root.render(createElement(Reader)));
    vi.advanceTimersByTime(retentionMs * 2);
    expect(store.snapshot()).toEqual(entries);
    flushSync(() => root.render("elsewhere"));
    vi.advanceTimersByTime(retentionMs);
    expect(store.snapshot()).toEqual([]);
  } finally {
    flushSync(() => root.unmount());
    vi.useRealTimers();
  }
});
