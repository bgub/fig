// @vitest-environment happy-dom
import {
  createDataStore,
  type FigDataHydrationEntry,
  readData,
  Suspense,
} from "@bgub/fig";
import {
  decodePayloadDataEntries,
  encodePayloadDataEntries,
} from "@bgub/fig/internal";
import { createRoot, type FigRoot, hydrateRoot } from "@bgub/fig-dom";
import { act } from "@bgub/fig-dom/test-utils";
import { renderToStream } from "@bgub/fig-server";
import {
  collectionOptions,
  eq,
  localOnlyCollectionOptions,
} from "@tanstack/db";
import { afterEach, expect, it, vi } from "vitest";
import { browserDependency, dbClient, liveQuery } from "./db.ts";

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

// What a real document carries: the data snapshot through Fig's Payload codec.
function transfer(entries: FigDataHydrationEntry[]): FigDataHydrationEntry[] {
  return decodePayloadDataEntries(encodePayloadDataEntries(entries));
}

async function renderOnServer(app: Parameters<typeof renderToStream>[0]) {
  const onError = vi.fn();
  const result = renderToStream(app, { onError });
  const html = await new Response(result.stream).text();
  return { data: result.getData(), html, onError };
}

it("server-renders a live query, hydrates it, then follows local changes", async () => {
  // The server's collection has rows; the browser's starts empty, so any
  // rows it has after hydration came across from the server.
  let onServer = true;
  const todos = collectionOptions("ssr-todos", () =>
    localOnlyCollectionOptions<Todo, string>({
      id: "ssr-todos",
      getKey: (todo) => todo.id,
      initialData: onServer
        ? [
            { id: "a", title: "Rendered on the server", done: false },
            { id: "b", title: "Already done", done: true },
          ]
        : [],
    }),
  );
  const openTodos = liveQuery({
    key: () => ["ssr-open-todos"],
    query: () => (q) =>
      q.from({ todo: todos }).where(({ todo }) => eq(todo.done, false)),
  });
  const seen: unknown[] = [];
  function OpenTodos() {
    const rows = readData(openTodos);
    seen.push(rows);
    return (
      <ul>
        {rows.map((todo) => (
          <li key={todo.id}>{todo.title}</li>
        ))}
      </ul>
    );
  }
  const app = (
    <Suspense fallback={<p>loading</p>}>
      <OpenTodos />
    </Suspense>
  );

  const server = await renderOnServer(app);
  expect(server.onError).not.toHaveBeenCalled();
  expect(server.html).toContain("Rendered on the server");
  // The client entry crosses as TanStack's dehydrated state, not an instance,
  // and both entries survive the Payload codec (virtual row fields included).
  const data = transfer(server.data);
  const clientEntry = data.find(
    (entry) => entry.key[0] === "fig-tanstack-db:client",
  );
  expect(clientEntry?.value).toMatchObject({
    collections: [{ collectionId: "ssr-todos" }],
  });

  onServer = false;
  seen.length = 0;
  const host = document.createElement("div");
  host.innerHTML = server.html;
  document.body.append(host);
  runInlineScripts(host);
  const recoverable = vi.fn();
  let root!: FigRoot;
  await act(async () => {
    root = hydrateRoot(host, app, {
      dataStore: createDataStore({ initialData: data }),
      onRecoverableError: recoverable,
    });
    roots.push(root);
  });
  expect(recoverable).not.toHaveBeenCalled();
  expect(host.textContent).toBe("Rendered on the server");
  // The watch's first publish matched the hydrated rows, so every render saw
  // the hydrated value and none followed for the publish.
  expect(new Set(seen.splice(0)).size).toBe(1);

  // The browser's collection was seeded from the server's rows.
  const client = await root.data.ensureData(dbClient);
  const collection = client.collection(todos);
  expect(collection.size).toBe(2);

  await act(async () => {
    collection.insert({ id: "c", title: "Added in the browser", done: false });
  });
  expect(host.textContent).toBe("Rendered on the serverAdded in the browser");
});

it("leaves a query over browser-only storage to the browser", async () => {
  const notes = collectionOptions("local-notes", (client) =>
    localOnlyCollectionOptions<{ id: string; text: string }, string>({
      id: "local-notes",
      getKey: (note) => note.id,
      // Stands in for an IndexedDB handle the app passes to its browser and
      // service-worker clients, and not to the origin server's.
      initialData: browserDependency<{ id: string; text: string }[]>(
        client,
        "localNotes",
        "Notes live in this browser.",
      ),
    }),
  );
  const allNotes = liveQuery({
    key: () => ["local-notes"],
    query: () => (q) => q.from({ note: notes }),
  });
  function Notes() {
    return (
      <p>
        {readData(allNotes)
          .map((note) => note.text)
          .join(", ")}
      </p>
    );
  }

  const server = await renderOnServer(
    <Suspense fallback={<p>opening notes</p>}>
      <Notes />
    </Suspense>,
  );
  expect(server.html).toContain("opening notes");
  expect(server.html).toContain("fig:suspense:browser");
  expect(server.onError).not.toHaveBeenCalled();
});

it("loads browser-only collections where the dependency exists", async () => {
  const { createDbClient } = await import("./db.ts");
  const workerClient = createDbClient({
    key: ["worker-client"],
    options: () => ({ localNotes: [{ id: "n", text: "from the worker" }] }),
  });
  const notes = collectionOptions("worker-notes", (client) =>
    localOnlyCollectionOptions<{ id: string; text: string }, string>({
      id: "worker-notes",
      getKey: (note) => note.id,
      initialData: browserDependency(client, "localNotes"),
    }),
  );
  const allNotes = liveQuery({
    key: () => ["worker-notes"],
    client: workerClient,
    query: () => (q) => q.from({ note: notes }),
  });
  function Notes() {
    return (
      <p>
        {readData(allNotes)
          .map((note) => note.text)
          .join(", ")}
      </p>
    );
  }
  const server = await renderOnServer(
    <Suspense fallback={<p>opening notes</p>}>
      <Notes />
    </Suspense>,
  );
  expect(server.html).toContain("from the worker");

  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => {
    root.render(
      <Suspense fallback={<p>opening notes</p>}>
        <Notes />
      </Suspense>,
    );
  });
  expect(host.textContent).toBe("from the worker");
});

// innerHTML does not execute scripts; run the server's inline operations in
// document order, as the HTML parser would have.
function runInlineScripts(container: Element): void {
  for (const script of Array.from(container.querySelectorAll("script"))) {
    // happy-dom does not run inserted scripts; evaluate the server's own
    // trusted operation scripts directly.
    // oxlint-disable-next-line typescript/no-implied-eval
    new Function(script.textContent ?? "")();
    script.remove();
  }
}
