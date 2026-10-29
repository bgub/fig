import {
  createDataStore,
  createElement,
  dataResource,
  readData,
  useBeforePaint,
} from "@bgub/fig";
import { afterEach, expect, it } from "vitest";
import { createRoot, flushSync, type FigRoot } from "./index.ts";
import {
  FakeElement,
  installFakeDocument,
  waitForHostTurns,
} from "./test-utils.ts";
import { requestPaint } from "../../fig-reconciler/src/scheduler.ts";

installFakeDocument();
const roots: FigRoot[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) flushSync(() => root.unmount());
});

it.each(["hydrate", "refresh", "hydrate-sync", "refresh-sync"])(
  "does not commit stale data read before a yielded update (%s)",
  async (update) => {
    const resource = dataResource<[], string>({
      key: () => ["data-consistency"],
      load: () => "new",
    });
    const store = createDataStore({
      initialData: [{ key: ["data-consistency"], value: "old" }],
    });
    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element, {
      dataStore: store,
    });
    roots.push(root);
    const commits: string[] = [];
    let yieldOnce = true;
    function Reader() {
      return createElement("span", null, readData(resource));
    }
    function Yield() {
      if (yieldOnce) {
        yieldOnce = false;
        requestPaint();
        queueMicrotask(() => {
          if (update.startsWith("hydrate"))
            store.hydrate([{ key: ["data-consistency"], value: "new" }]);
          else void store.refreshData(resource);
          if (update.endsWith("sync")) flushSync(() => {});
        });
      }
      return null;
    }
    function App() {
      useBeforePaint(() => {
        commits.push(container.textContent);
      });
      return createElement(
        "main",
        null,
        createElement(Reader),
        createElement(Yield),
        createElement(Reader),
      );
    }
    root.render(createElement(App));
    await waitForHostTurns(15);
    expect(container.textContent).toBe("newnew");
    expect(commits).not.toContain("oldnew");
  },
);

it.each([false, true])(
  "catches data changed by deletion cleanup before a new reader subscribes (sync: %s)",
  async (sync) => {
    const resource = dataResource<[], string>({ key: () => ["cleanup"] });
    const store = createDataStore({
      initialData: [{ key: ["cleanup"], value: "old" }],
    });
    const container = new FakeElement("root");
    const root = createRoot(container as unknown as Element, {
      dataStore: store,
    });
    roots.push(root);
    let replacing = false;
    const afterCommit: string[] = [];
    function Previous() {
      useBeforePaint((signal) => {
        signal.addEventListener("abort", () => {
          if (replacing) store.hydrate([{ key: ["cleanup"], value: "new" }]);
        });
      }, []);
      return createElement("span", null, "previous");
    }
    function Reader() {
      const value = readData(resource);
      useBeforePaint(() => {
        queueMicrotask(() => afterCommit.push(container.textContent));
      }, [value]);
      return createElement("span", null, value);
    }
    flushSync(() => root.render(createElement(Previous)));
    replacing = true;
    if (sync) {
      flushSync(() => root.render(createElement(Reader)));
      expect(container.textContent).toBe("new");
    } else root.render(createElement(Reader));
    await waitForHostTurns(15);
    expect(container.textContent).toBe("new");
    // The correction must finish before yielding, not merely on a later tick.
    expect(afterCommit.length).toBeGreaterThan(0);
    expect(afterCommit.every((value) => value === "new")).toBe(true);
    flushSync(() => store.hydrate([{ key: ["cleanup"], value: "latest" }]));
    expect(container.textContent).toBe("latest");
  },
);
