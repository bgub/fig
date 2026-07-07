import type { DataResourceKey } from "@bgub/fig";
import {
  Activity,
  createElement,
  dataResource,
  ErrorBoundary,
  invalidateData,
  preloadData,
  readData,
  readDataStore,
  refreshData,
  Suspense,
  useReactive,
  useState,
} from "@bgub/fig";
import { describe, expect, it } from "vite-plus/test";
import { createRoot, flushSync, on } from "./index.ts";
import {
  deferred,
  delay,
  FakeElement,
  installFakeDocument,
} from "./test-utils.ts";

installFakeDocument();

describe("@bgub/fig-dom data resources", () => {
  it("suspends on first read and dedupes the loader by key", async () => {
    const pending = deferred<string>();
    let loads = 0;
    const messageResource = dataResource({
      key: (id: string) => ["message", id],
      load: async () => {
        loads += 1;
        return pending.promise;
      },
    });

    function Message() {
      return createElement("span", null, readData(messageResource, "one"));
    }

    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);

    flushSync(() =>
      root.render(
        createElement(
          Suspense,
          { fallback: createElement("span", null, "Loading") },
          createElement(Message, null),
        ),
      ),
    );

    expect(container.textContent).toBe("Loading");
    expect(loads).toBe(1);

    pending.resolve("Loaded");
    await delay();

    expect(container.textContent).toBe("Loaded");
    expect(loads).toBe(1);
  });

  it("frees the container for a new root after unmount", () => {
    const container = new FakeElement("root");
    const first = createRoot(container as unknown as Element);
    flushSync(() => first.render(createElement("span", null, "hi")));
    expect(container.textContent).toBe("hi");

    first.unmount();

    // Previously the container kept its (now disposed) root forever, so this
    // threw a duplicate-root error and any reuse hit a disposed data store.
    expect(() => createRoot(container as unknown as Element)).not.toThrow();
  });

  it("tears down synchronously on unmount", () => {
    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);
    flushSync(() => root.render(createElement("span", null, "hi")));
    expect(container.textContent).toBe("hi");

    root.unmount();

    // The teardown render is flushed synchronously, so the tree is gone
    // immediately rather than on a later tick.
    expect(container.textContent).toBe("");
  });

  it("refreshes from delegated event handlers using the root data store", async () => {
    const values = ["Ada", "Grace"];
    const userResource = dataResource({
      key: (id: string) => ["user", id],
      load: () => values.shift() ?? "Unknown",
    });

    function Profile() {
      const user = readData(userResource, "one");
      return createElement(
        "button",
        { events: [on("click", () => void refreshData(userResource, "one"))] },
        user,
      );
    }

    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);

    flushSync(() =>
      root.render(
        createElement(
          Suspense,
          { fallback: createElement("span", null, "Loading") },
          createElement(Profile, null),
        ),
      ),
    );
    await delay();

    expect(container.textContent).toBe("Ada");

    (container.firstChild as FakeElement).dispatch("click");
    await delay();

    expect(container.textContent).toBe("Grace");
  });

  it("refreshes from direct (non-delegated) event handlers too", async () => {
    const values = ["Ada", "Grace"];
    const userResource = dataResource({
      key: (id: string) => ["focused-user", id],
      load: () => values.shift() ?? "Unknown",
    });

    function Profile() {
      const user = readData(userResource, "one");
      return createElement(
        "input",
        {
          // focus is non-bubbling, so its listener attaches directly to the
          // element instead of the delegation root; dispatch must still run
          // inside the root's data scope for the ambient store to resolve.
          events: [
            on("focus", () => {
              void readDataStore().refreshData(userResource, "one");
            }),
          ],
          value: user,
        },
        null,
      );
    }

    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);

    flushSync(() =>
      root.render(
        createElement(
          Suspense,
          { fallback: createElement("span", null, "Loading") },
          createElement(Profile, null),
        ),
      ),
    );
    await delay();

    const input = container.firstChild as FakeElement;
    expect(input.value).toBe("Ada");

    input.dispatch("focus");
    await delay();

    expect(input.value).toBe("Grace");
  });

  it("invalidates visible data without replacing it with a fallback", async () => {
    const next = deferred<string>();
    let loads = 0;
    const labelResource = dataResource({
      key: (id: string) => ["label", id],
      load: () => {
        loads += 1;
        return loads === 1 ? "Initial" : next.promise;
      },
    });

    function Label() {
      return createElement("span", null, readData(labelResource, "one"));
    }

    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);

    flushSync(() =>
      root.render(
        createElement(
          Suspense,
          { fallback: createElement("span", null, "Loading") },
          createElement(Label, null),
        ),
      ),
    );
    await delay();

    expect(container.textContent).toBe("Initial");

    root.data.run(() => invalidateData(labelResource, "one"));
    await delay();

    expect(container.textContent).toBe("Initial");
    expect(loads).toBe(2);

    next.resolve("Updated");
    await delay();

    expect(container.textContent).toBe("Updated");
  });

  it("mutates through the root data handle without run(), even after awaits", async () => {
    const next = deferred<string>();
    let loads = 0;
    const labelResource = dataResource({
      key: (id: string) => ["handle-label", id],
      load: () => {
        loads += 1;
        return loads === 1 ? "Initial" : next.promise;
      },
    });

    function Label() {
      return createElement("span", null, readData(labelResource, "one"));
    }

    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);

    flushSync(() =>
      root.render(
        createElement(
          Suspense,
          { fallback: createElement("span", null, "Loading") },
          createElement(Label, null),
        ),
      ),
    );
    await delay();
    expect(container.textContent).toBe("Initial");

    // No ambient store here (plain async test code): the handle carries its
    // store, so the canonical `await save(); invalidate(...)` flow works.
    root.data.invalidateData(labelResource, "one");
    await delay();
    expect(loads).toBe(2);

    next.resolve("Updated");
    await delay();
    expect(container.textContent).toBe("Updated");
  });

  it("captures readDataStore() in render for use after awaits in events", async () => {
    const values = ["Ada", "Grace"];
    const userResource = dataResource({
      key: (id: string) => ["captured-user", id],
      load: () => values.shift() ?? "Unknown",
    });

    function Profile() {
      const data = readDataStore();
      const user = readData(userResource, "one");
      return createElement(
        "button",
        {
          events: [
            on("click", () => {
              void (async () => {
                // The ambient slot is gone after this await; the captured
                // handle is the supported path.
                await delay();
                await data.refreshData(userResource, "one");
              })();
            }),
          ],
        },
        user,
      );
    }

    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);

    flushSync(() =>
      root.render(
        createElement(
          Suspense,
          { fallback: createElement("span", null, "Loading") },
          createElement(Profile, null),
        ),
      ),
    );
    await delay();
    expect(container.textContent).toBe("Ada");

    (container.firstChild as FakeElement).dispatch("click");
    await delay();
    await delay();

    expect(container.textContent).toBe("Grace");
  });

  it("resolves the ambient store inside effects", async () => {
    let loads = 0;
    const itemResource = dataResource({
      key: (id: string) => ["effect-preload", id],
      load: () => {
        loads += 1;
        return "Item";
      },
    });

    function Preloader() {
      useReactive(() => {
        // Throws "no ambient store" before effects ran inside dataStore.run.
        preloadData(itemResource, "one");
      }, []);
      return null;
    }

    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);
    flushSync(() => root.render(createElement(Preloader, null)));
    await delay();

    expect(loads).toBe(1);
  });

  it("recovers from a failed load: error fallback, invalidate, remount", async () => {
    let attempts = 0;
    const profileResource = dataResource({
      key: (id: string) => ["recovery", id],
      load: () => {
        attempts += 1;
        return attempts === 1
          ? Promise.reject(new Error("network down"))
          : Promise.resolve("Ada");
      },
    });

    function Profile() {
      return createElement("span", null, readData(profileResource, "one"));
    }

    // The whole loop: load fails -> function fallback renders the error with
    // a retry button -> retry invalidates the poisoned entry and remounts the
    // boundary by key -> fresh load succeeds.
    function App() {
      const [generation, setGeneration] = useState(0);
      const data = readDataStore();
      return createElement(
        ErrorBoundary,
        {
          key: generation,
          fallback: (error: unknown) =>
            createElement(
              "button",
              {
                events: [
                  on("click", () => {
                    data.invalidateData(profileResource, "one");
                    setGeneration((value) => value + 1);
                  }),
                ],
              },
              `Failed: ${(error as Error).message}`,
            ),
        },
        createElement(
          Suspense,
          { fallback: createElement("span", null, "Loading") },
          createElement(Profile, null),
        ),
      );
    }

    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);

    flushSync(() => root.render(createElement(App, null)));
    await delay();
    expect(container.textContent).toBe("Failed: network down");
    expect(attempts).toBe(1);

    (container.firstChild as FakeElement).dispatch("click");
    await delay();
    await delay();

    expect(container.textContent).toBe("Ada");
    expect(attempts).toBe(2);
  });

  it("hydrates initial data entries before the first client read", () => {
    const hydratedResource = dataResource<[string], string>({
      key: (id: string) => ["hydrated", id],
    });

    function HydratedLabel() {
      return createElement("span", null, readData(hydratedResource, "one"));
    }

    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element, {
      initialData: [{ key: ["hydrated", "one"], value: "Hydrated" }],
    });

    flushSync(() =>
      root.render(
        createElement(
          Suspense,
          { fallback: createElement("span", null, "Loading") },
          createElement(HydratedLabel, null),
        ),
      ),
    );

    expect(container.textContent).toBe("Hydrated");
  });

  it("reports unsupported refreshes for loader-less resources", async () => {
    const hydratedResource = dataResource<[string], string>({
      key: (id: string) => ["hydrate-only", id],
    });

    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element, {
      initialData: [{ key: ["hydrate-only", "one"], value: "Hydrated" }],
    });

    const result = await root.data.run(() =>
      refreshData(hydratedResource, "one"),
    );

    expect(result).toEqual({
      reason: "no-client-loader",
      staleValue: "Hydrated",
      status: "unsupported",
    });
  });

  it("keeps stale fulfilled data visible when a refresh rejects", async () => {
    const error = new Error("No update");
    let loads = 0;
    const labelResource = dataResource({
      key: (id: string) => ["refresh-error", id],
      load: () => {
        loads += 1;
        if (loads === 1) return "Initial";
        throw error;
      },
    });

    function Label() {
      return createElement("span", null, readData(labelResource, "one"));
    }

    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);

    flushSync(() =>
      root.render(
        createElement(
          Suspense,
          { fallback: createElement("span", null, "Loading") },
          createElement(Label, null),
        ),
      ),
    );
    await delay();

    expect(container.textContent).toBe("Initial");

    const result = await root.data.run(() => refreshData(labelResource, "one"));
    await delay();

    expect(result).toEqual({
      error,
      staleValue: "Initial",
      status: "rejected",
    });
    expect(container.textContent).toBe("Initial");
  });

  it("publishes hidden Activity data subscriptions and prerenders invalidations", async () => {
    const values = ["Initial", "Updated"];
    let loads = 0;
    const labelResource = dataResource({
      key: (id: string) => ["hidden-label", id],
      load: () => {
        loads += 1;
        return values.shift() ?? "Unexpected";
      },
    });

    function Label() {
      return createElement("span", null, readData(labelResource, "one"));
    }

    function App() {
      return createElement(
        Activity,
        { mode: "hidden" },
        createElement(Label, null),
      );
    }

    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);
    root.render(createElement(App, null));
    await delay();

    const span = container.childNodes[0] as FakeElement;
    expect(container.textContent).toBe("Initial");
    expect(span.style.display).toBe("none");
    expect(loads).toBe(1);

    root.data.run(() => invalidateData(labelResource, "one"));
    await delay();

    expect(container.textContent).toBe("Updated");
    expect(span.style.display).toBe("none");
    expect(loads).toBe(2);
  });

  it("reports failed data resource keys to error boundaries", async () => {
    const error = new Error("Missing user");
    const reports: Array<{
      error: unknown;
      keys: DataResourceKey[] | undefined;
    }> = [];
    const userResource = dataResource({
      key: (id: string) => ["failed-user", id],
      load: () => {
        throw error;
      },
    });

    function Profile() {
      return createElement("span", null, readData(userResource, "one"));
    }

    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element);

    root.render(
      createElement(
        ErrorBoundary,
        {
          fallback: createElement("span", null, "Crashed"),
          onError(caught, info) {
            reports.push({ error: caught, keys: info.dataResourceKeys });
          },
        },
        createElement(
          Suspense,
          { fallback: createElement("span", null, "Loading") },
          createElement(Profile, null),
        ),
      ),
    );
    await delay();
    await delay();

    expect(container.textContent).toBe("Crashed");
    expect(reports).toEqual([
      {
        error,
        keys: [["failed-user", "one"]],
      },
    ]);
  });
});
