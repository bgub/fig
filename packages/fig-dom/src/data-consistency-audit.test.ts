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
