// @vitest-environment happy-dom
import { createDataStore, readData, Suspense, useActionState } from "@bgub/fig";
import { act } from "@bgub/fig-dom/test-utils";
import { createRoot, type FigRoot } from "@bgub/fig-dom";
import {
  createCollection,
  createTransaction,
  eq,
  localOnlyCollectionOptions,
} from "@tanstack/db";
import { afterEach, expect, it } from "vitest";
import { liveQuery } from "./db.ts";

interface Todo {
  id: string;
  title: string;
  done: boolean;
}

const roots: FigRoot[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) root.unmount();
  document.body.replaceChildren();
});

function todoCollection(id: string) {
  return createCollection(
    localOnlyCollectionOptions<Todo, string>({
      id,
      getKey: (todo) => todo.id,
      initialData: [
        { id: "a", title: "Write the adapter", done: false },
        { id: "b", title: "Ship it", done: true },
      ],
    }),
  );
}

it("renders a live query and follows collection changes", async () => {
  const todos = todoCollection("todos-live");
  const openTodos = liveQuery({
    key: () => ["open-todos"],
    query: () => (q) =>
      q.from({ todo: todos }).where(({ todo }) => eq(todo.done, false)),
  });
  let renders = 0;
  function OpenTodos() {
    renders += 1;
    const rows = readData(openTodos);
    return (
      <ul>
        {rows.map((todo) => (
          <li key={todo.id}>{todo.title}</li>
        ))}
      </ul>
    );
  }

  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => {
    root.render(
      <Suspense fallback={<p>loading</p>}>
        <OpenTodos />
      </Suspense>,
    );
  });
  expect(host.textContent).toBe("Write the adapter");

  await act(async () => {
    todos.insert({ id: "c", title: "Add tests", done: false });
  });
  expect(host.textContent).toBe("Write the adapterAdd tests");

  await act(async () => {
    todos.update("a", (draft) => {
      draft.done = true;
    });
  });
  expect(host.textContent).toBe("Add tests");

  // A change outside the query's result renders nothing.
  const before = renders;
  await act(async () => {
    todos.update("b", (draft) => {
      draft.title = "Ship it soon";
    });
  });
  expect(renders).toBe(before);
});

it("re-renders hydrated rows when the browser's view differs", async () => {
  const todos = todoCollection("todos-status");
  const allTodos = liveQuery({
    key: () => ["status-todos"],
    query: () => (q) => q.from({ todo: todos }),
  });
  function Status() {
    const rows = readData(allTodos);
    return <p>{rows.map((todo) => `${todo.id}:${todo.$synced}`).join(" ")}</p>;
  }
  // Rows as a server rendered them before its sync confirmed them.
  const hydrated = [
    { id: "a", title: "Write the adapter", done: false, $synced: false },
    { id: "b", title: "Ship it", done: true, $synced: false },
  ];
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host, {
    dataStore: createDataStore({
      initialData: [{ key: ["status-todos"], value: hydrated }],
    }),
  });
  roots.push(root);
  await act(async () => {
    root.render(
      <Suspense fallback={<p>loading</p>}>
        <Status />
      </Suspense>,
    );
  });
  expect(host.textContent).toBe("a:true b:true");
});

it("composes collection writes with Fig actions", async () => {
  const todos = todoCollection("todos-actions");
  const titles = liveQuery({
    key: () => ["action-todos"],
    query: () => (q) =>
      q
        .from({ todo: todos })
        .where(({ todo }) => eq(todo.done, false))
        .select(({ todo }) => ({ id: todo.id })),
  });
  // Each save waits on a backend the test settles by hand.
  const backend: { settle: (ok: boolean) => void }[] = [];
  let save!: (id: string) => void;
  function Todos() {
    const rows = readData(titles);
    const [status, run, isPending] = useActionState(
      async (_previous: string, id: string, _signal: AbortSignal) => {
        const transaction = createTransaction({
          mutationFn: async ({ transaction }) => {
            const ok = await new Promise<boolean>((settle) =>
              backend.push({ settle }),
            );
            if (!ok) throw new Error("rejected");
            todos.utils.acceptMutations(transaction);
          },
        });
        transaction.mutate(() => todos.insert({ id, title: id, done: false }));
        try {
          await transaction.when("settled");
          return `saved ${id}`;
        } catch {
          return `failed ${id}`;
        }
      },
      "idle",
    );
    save = run;
    return (
      <p>
        {rows.map((todo) => todo.id).join(",")} {status}
        {isPending ? " pending" : ""}
      </p>
    );
  }
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => {
    root.render(
      <Suspense fallback={<p>loading</p>}>
        <Todos />
      </Suspense>,
    );
  });
  expect(host.textContent).toBe("a idle");

  // The optimistic row renders while the action is pending.
  await act(async () => save("c"));
  expect(host.textContent).toBe("a,c idle pending");
  await act(async () => backend.shift()?.settle(true));
  expect(host.textContent).toBe("a,c saved c");

  // A rejected write rolls back in TanStack and settles the action.
  await act(async () => save("d"));
  expect(host.textContent).toBe("a,c,d saved c pending");
  await act(async () => backend.shift()?.settle(false));
  expect(host.textContent).toBe("a,c failed d");

  // A newer run supersedes the action, but abort is not undo: the earlier
  // write still completes.
  await act(async () => save("e"));
  await act(async () => save("f"));
  expect(host.textContent).toBe("a,c,e,f failed d pending");
  await act(async () => {
    backend.shift()?.settle(true);
    backend.shift()?.settle(true);
  });
  expect(host.textContent).toBe("a,c,e,f saved f");
});
