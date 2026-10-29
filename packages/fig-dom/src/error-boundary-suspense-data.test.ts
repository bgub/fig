import {
  createElement,
  ErrorBoundary,
  readPromise,
  Suspense,
  createDataStore,
  dataResource,
  readData,
  type FigNode,
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

it("refreshes a retained wrapper data read before reveal", async () => {
  const gate = deferred<void>();
  const resource = dataResource<[], string>({ key: () => ["probe"] });
  const store = createDataStore({
    initialData: [{ key: ["probe"], value: "old" }],
  });
  let failing = true;
  const container = new FakeElement("root");
  const root = createRoot(container as unknown as Element, {
    dataStore: store,
  });
  function Wrapper({ children }: { children: FigNode }) {
    return [readData(resource), children];
  }
  function Primary() {
    if (failing) throw new Error("temporary");
    return "healthy";
  }
  function Pending() {
    readPromise(gate.promise);
    return "ready";
  }
  try {
    flushSync(() =>
      root.render(
        createElement(
          Suspense,
          { fallback: "waiting" },
          createElement(
            "section",
            null,
            createElement(
              Wrapper,
              null,
              createElement(
                ErrorBoundary,
                { fallback: "error" },
                createElement(Primary),
              ),
            ),
          ),
          createElement(Pending),
        ),
      ),
    );
    expect(container.textContent).toBe("waiting");
    store.hydrate([{ key: ["probe"], value: "new" }]);
    failing = false;
    gate.resolve();
    await waitForHostTurns();
    expect(container.textContent).toBe("newhealthyready");
  } finally {
    flushSync(() => root.unmount());
  }
});
