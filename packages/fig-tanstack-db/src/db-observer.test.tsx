// @vitest-environment happy-dom
import { readData, Suspense } from "@bgub/fig";
import { createRoot } from "@bgub/fig-dom";
import { act } from "@bgub/fig-dom/test-utils";
import { createCollection, localOnlyCollectionOptions } from "@tanstack/db";
import { expect, it, vi } from "vitest";

// Shared through globalThis: the mocked module evaluates in its own scope.
const counts = Symbol.for("fig-tanstack-db.test.observer-counts");
const observers = ((globalThis as Record<symbol, unknown>)[counts] ??= {
  created: 0,
  disposed: 0,
}) as { created: number; disposed: number };
vi.mock("@tanstack/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/db")>();
  // Static imports evaluate this factory before the test module's body runs.
  const observers = ((globalThis as Record<symbol, unknown>)[
    Symbol.for("fig-tanstack-db.test.observer-counts")
  ] ??= { created: 0, disposed: 0 }) as { created: number; disposed: number };
  return {
    ...actual,
    createLiveQueryObserver: ((...args) => {
      observers.created += 1;
      const observer = actual.createLiveQueryObserver(...args);
      const dispose = observer.dispose;
      observer.dispose = () => {
        observers.disposed += 1;
        dispose.call(observer);
      };
      return observer;
    }) as typeof actual.createLiveQueryObserver,
  };
});

const { liveQuery } = await import("./db.ts");

it("shares one observer between the load and the watch of a query", async () => {
  const items = createCollection(
    localOnlyCollectionOptions<{ id: string }, string>({
      id: "shared-observer-items",
      getKey: (item) => item.id,
      initialData: [{ id: "a" }],
    }),
  );
  const allItems = liveQuery({
    key: () => ["shared-observer-items"],
    query: () => (q) => q.from({ item: items }),
  });
  function Items() {
    return <p>{readData(allItems).length}</p>;
  }

  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <Suspense fallback={null}>
        <Items />
      </Suspense>,
    );
  });
  await act(async () => items.insert({ id: "b" }));
  expect(host.textContent).toBe("2");
  expect(observers.created).toBe(1);

  // Disposing the root retires both holders, so the observer goes too.
  root.unmount();
  expect(observers.disposed).toBe(1);
});
