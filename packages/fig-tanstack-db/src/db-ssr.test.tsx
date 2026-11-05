// @vitest-environment happy-dom
import {
  createDataStore,
  dataResource,
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
import {
  capabilityDependency,
  dbClientResource,
  dbClient,
  liveQuery,
} from "./db.ts";

// The cancellation test watches Node's unhandled-rejection reporting; the
// package compiles without @types/node, so declare the two hooks it uses.
declare const process: {
  on(event: "unhandledRejection", listener: (reason: unknown) => void): void;
  off(event: "unhandledRejection", listener: (reason: unknown) => void): void;
};

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

// Opts every collection in, so these tests can watch collection rows cross.
const seedingClient = dbClientResource({
  key: ["seeding-client"],
  transferCollection: () => true,
});

async function renderOnServer(app: Parameters<typeof renderToStream>[0]) {
  const onError = vi.fn();
  const result = renderToStream(app, { onError });
  const html = await new Response(result.stream).text();
  return { data: result.getData(), html, onError };
}

it("disables collection-slot transfer when no policy is supplied", async () => {
  const items = collectionOptions("non-transferring-items", () =>
    localOnlyCollectionOptions<{ id: string }, string>({
      id: "non-transferring-items",
      getKey: (item) => item.id,
      initialData: [{ id: "a" }],
    }),
  );
  const query = liveQuery({
    key: () => ["non-transferring-query"],
    client: dbClientResource(),
    query: () => (q) => q.from({ item: items }),
  });
  const store = createDataStore();
  const ensureData = vi.spyOn(store, "ensureData");
  const controller = new AbortController();
  try {
    // Inspect the dependency used by the actual query loader, without
    // exposing the adapter's private collection-slot resource.
    await query.load!({ data: store, signal: controller.signal });
    const slotCall = ensureData.mock.calls.find(
      ([, collectionId]) => collectionId === items.id,
    );
    expect(slotCall).toBeDefined();
    expect(slotCall?.[0].transfer).toBe(false);
  } finally {
    controller.abort();
    ensureData.mockRestore();
    store.dispose();
  }
});

it.each([
  ["default client", dbClient],
  [
    "custom client without collection transfer",
    dbClientResource({ key: ["query-only-client"] }),
  ],
] as const)(
  "sends only query rows with %s and lets the browser collection sync",
  async (_name, clientResource) => {
    // Both sides' collections hold the same rows, standing in for a browser
    // collection that syncs them itself.
    const todos = collectionOptions("default-todos", () =>
      localOnlyCollectionOptions<Todo, string>({
        id: "default-todos",
        getKey: (todo) => todo.id,
        initialData: [{ id: "a", title: "Synced on both sides", done: false }],
      }),
    );
    const allTodos = liveQuery({
      key: () => ["default-todos"],
      client: clientResource,
      query: () => (q) => q.from({ todo: todos }),
    });
    const seen: unknown[] = [];
    function Titles() {
      const rows = readData(allTodos);
      seen.push(rows);
      return <p>{rows.map((todo) => todo.title).join(",")}</p>;
    }
    const app = (
      <Suspense fallback={<p>loading</p>}>
        <Titles />
      </Suspense>
    );

    const server = await renderOnServer(app);
    expect(server.onError).not.toHaveBeenCalled();
    const data = transfer(server.data);
    // The collection's entry exists on the server but never transfers.
    expect(data.map((entry) => entry.key)).toEqual([["default-todos"]]);

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
    expect(host.textContent).toBe("Synced on both sides");
    // The browser's own rows matched the hydrated ones, so nothing re-rendered.
    expect(new Set(seen.splice(0)).size).toBe(1);

    const client = await root.data.ensureData(clientResource);
    await act(async () => {
      client
        .collection(todos)
        .insert({ id: "b", title: "Added in the browser", done: false });
    });
    expect(host.textContent).toBe("Synced on both sides,Added in the browser");
  },
);

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
    client: seedingClient,
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
  // The client stays on the server; the collection's rows cross as their own
  // entry, and every entry survives the Payload codec (virtual row fields
  // included).
  const data = transfer(server.data);
  expect(data.map((entry) => entry.key)).toEqual([
    ["ssr-open-todos"],
    ["seeding-client", "collection", "ssr-todos"],
  ]);
  expect(data[1]?.value).toMatchObject({
    collectionId: "ssr-todos",
    rows: [{ key: "a" }, { key: "b" }],
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
  const client = await root.data.ensureData(seedingClient);
  const collection = client.collection(todos);
  expect(collection.size).toBe(2);

  await act(async () => {
    collection.insert({ id: "c", title: "Added in the browser", done: false });
  });
  expect(host.textContent).toBe("Rendered on the serverAdded in the browser");
});

it("streams a late boundary's collection after its reveal", async () => {
  let onServer = true;
  const seeded = (id: string, title: string) =>
    collectionOptions(id, () =>
      localOnlyCollectionOptions<Todo, string>({
        id,
        getKey: (todo) => todo.id,
        initialData: onServer ? [{ id: "1", title, done: false }] : [],
      }),
    );
  const shellTodos = seeded("stream-shell-todos", "In the shell");
  const lateTodos = seeded("stream-late-todos", "In a late boundary");
  const shellQuery = liveQuery({
    key: () => ["stream-shell-query"],
    client: seedingClient,
    query: () => (q) => q.from({ todo: shellTodos }),
  });
  const lateQuery = liveQuery({
    key: () => ["stream-late-query"],
    client: seedingClient,
    query: () => (q) => q.from({ todo: lateTodos }),
  });
  // Holds the late boundary back until after the shell is written.
  let release!: () => void;
  const gate = dataResource<[], string>({
    key: () => ["stream-gate"],
    load: () =>
      onServer
        ? new Promise<string>((resolve) => (release = () => resolve("open")))
        : "open",
  });
  function Titles(props: { query: typeof shellQuery }) {
    return (
      <p>
        {readData(props.query)
          .map((todo) => todo.title)
          .join(",")}
      </p>
    );
  }
  function Late() {
    readData(gate);
    return <Titles query={lateQuery} />;
  }
  const app = (
    <main>
      <Titles query={shellQuery} />
      <Suspense fallback={<p>loading</p>}>
        <Late />
      </Suspense>
    </main>
  );

  const onError = vi.fn();
  const result = renderToStream(app, { onError });
  await result.shellReady;
  // The shell's snapshot has the shell's collection, not the late one.
  const shellData = transfer(result.takeData());
  const keys = shellData.map((entry) => entry.key);
  expect(keys).toContainEqual([
    "seeding-client",
    "collection",
    "stream-shell-todos",
  ]);
  expect(keys).not.toContainEqual([
    "seeding-client",
    "collection",
    "stream-late-todos",
  ]);

  release();
  const html = await new Response(result.stream).text();
  expect(onError).not.toHaveBeenCalled();
  // The query's row precedes the reveal; its collection's rows follow it.
  expectAfterReveal(html, '["stream-late-query"]', '"stream-late-todos"]');

  onServer = false;
  const host = document.createElement("div");
  host.innerHTML = html;
  document.body.append(host);
  runInlineScripts(host);
  const recoverable = vi.fn();
  let root!: FigRoot;
  await act(async () => {
    root = hydrateRoot(host, app, {
      dataStore: createDataStore({ initialData: shellData }),
      onRecoverableError: recoverable,
    });
    roots.push(root);
  });
  expect(recoverable).not.toHaveBeenCalled();
  expect(host.textContent).toBe("In the shellIn a late boundary");

  // Both browser collections were seeded from the server's rows.
  const client = await root.data.ensureData(seedingClient);
  expect(client.collection(shellTodos).size).toBe(1);
  const late = client.collection(lateTodos);
  expect(late.size).toBe(1);
  await act(async () => {
    late.insert({ id: "2", title: "Added in the browser", done: false });
  });
  expect(host.textContent).toBe(
    "In the shellIn a late boundary,Added in the browser",
  );
});

it("holds a syncing collection back until its rows are ready", async () => {
  let markSynced!: () => void;
  const items = collectionOptions("syncing-items", () => ({
    id: "syncing-items",
    getKey: (item: { id: string }) => item.id,
    sync: {
      sync: ({ begin, write, commit, markReady }) => {
        markSynced = () => {
          begin();
          write({ type: "insert", value: { id: "a" } });
          void commit();
          markReady();
        };
      },
    },
  }));
  const itemsQuery = liveQuery({
    key: () => ["syncing-items-query"],
    client: seedingClient,
    query: () => (q) => q.from({ item: items }),
  });
  function Count() {
    return <p>{readData(itemsQuery).length}</p>;
  }

  const onError = vi.fn();
  const result = renderToStream(
    <Suspense fallback={<p>loading</p>}>
      <Count />
    </Suspense>,
    { onError },
  );
  await result.shellReady;
  await vi.waitFor(() => expect(markSynced).toBeTypeOf("function"));
  // The collection's entry exists, but an empty, still-syncing collection
  // has nothing to send and is not claimed by the shell.
  const collectionKey = ["seeding-client", "collection", "syncing-items"];
  expect(result.takeData().map((entry) => entry.key)).not.toContainEqual(
    collectionKey,
  );

  markSynced();
  const html = await new Response(result.stream).text();
  expect(onError).not.toHaveBeenCalled();
  expectAfterReveal(html, '["syncing-items-query"]', '"syncing-items"]');
  expect(html.slice(html.indexOf('"syncing-items"]'))).toContain(
    '"value":{"id":"a"}',
  );
});

it("applies collection rows that arrive after the browser loaded", async () => {
  let onServer = true;
  const todos = collectionOptions("arriving-todos", () =>
    onServer
      ? localOnlyCollectionOptions<Todo, string>({
          id: "arriving-todos",
          getKey: (todo) => todo.id,
          initialData: [{ id: "1", title: "From the server", done: false }],
        })
      : {
          id: "arriving-todos",
          getKey: (todo: Todo) => todo.id,
          // The browser's own sync has not finished.
          sync: { sync: () => undefined },
        },
  );
  const query = liveQuery({
    key: () => ["arriving-query"],
    client: seedingClient,
    query: () => (q) => q.from({ todo: todos }),
  });
  function Titles() {
    return (
      <p>
        {readData(query)
          .map((todo) => todo.title)
          .join(",")}
      </p>
    );
  }
  const app = (
    <Suspense fallback={<p>loading</p>}>
      <Titles />
    </Suspense>
  );
  const { html, onError } = await renderOnServer(app);
  expect(onError).not.toHaveBeenCalled();
  expectAfterReveal(html, '["arriving-query"]', '"arriving-todos"]');

  // Hydrate with everything up to the collection's rows.
  onServer = false;
  const lateAt = html.lastIndexOf("<script", html.indexOf('"arriving-todos"]'));
  const host = document.createElement("div");
  host.innerHTML = html.slice(0, lateAt);
  document.body.append(host);
  runInlineScripts(host);
  const recoverable = vi.fn();
  let root!: FigRoot;
  await act(async () => {
    root = hydrateRoot(host, app, { onRecoverableError: recoverable });
    roots.push(root);
  });
  expect(recoverable).not.toHaveBeenCalled();
  expect(host.textContent).toBe("From the server");
  const client = await root.data.ensureData(seedingClient);
  const collection = client.collection(todos);
  expect(collection.size).toBe(0);

  // The rows arrive once the collection's entry has loaded.
  const tail = document.createElement("div");
  tail.innerHTML = html.slice(lateAt);
  document.body.append(tail);
  await act(async () => runInlineScripts(tail));
  expect(collection.size).toBe(1);
  expect(collection.get("1")?.title).toBe("From the server");
  expect(host.textContent).toBe("From the server");
});

// The derived row's data precedes the boundary's reveal, and the dependency's
// rows follow it.
function expectAfterReveal(html: string, derived: string, dependency: string) {
  const derivedAt = html.indexOf(derived);
  const revealAt = html.indexOf("__figSSR.c(", derivedAt);
  expect(derivedAt).toBeGreaterThan(-1);
  expect(revealAt).toBeGreaterThan(derivedAt);
  expect(html.indexOf(dependency)).toBeGreaterThan(revealAt);
}

it("leaves a query over browser-only storage to the browser", async () => {
  const notes = collectionOptions("local-notes", (client) =>
    localOnlyCollectionOptions<{ id: string; text: string }, string>({
      id: "local-notes",
      getKey: (note) => note.id,
      // Stands in for an IndexedDB handle the app passes to its browser and
      // service-worker clients, and not to the origin server's.
      initialData: capabilityDependency<{ id: string; text: string }[]>(
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
  const workerClient = dbClientResource({
    key: ["worker-client"],
    options: () => ({ localNotes: [{ id: "n", text: "from the worker" }] }),
  });
  const notes = collectionOptions("worker-notes", (client) =>
    localOnlyCollectionOptions<{ id: string; text: string }, string>({
      id: "worker-notes",
      getKey: (note) => note.id,
      initialData: capabilityDependency(client, "localNotes"),
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

it.each(["load", "watch"] as const)(
  "seeds eager collection sync metadata before a query %s starts it",
  async (kind) => {
    const events: string[] = [];
    const items = collectionOptions("eager-seeded-items", () => {
      let offset = "fresh";
      return {
        id: "eager-seeded-items",
        getKey: (row: { id: string }) => row.id,
        startSync: true,
        sync: {
          sync: ({ markReady }) => {
            events.push(`sync:${offset}`);
            markReady();
          },
          importSyncMeta: (meta) => {
            if (typeof meta !== "string") throw new Error("invalid offset");
            offset = meta;
            events.push(`import:${offset}`);
          },
        },
      };
    });
    const client = dbClientResource({
      key: ["eager-seeded-client"],
      transferCollection: () => true,
    });
    const query = liveQuery({
      key: () => ["eager-seeded-query"],
      client,
      query: () => (q) => q.from({ item: items }),
    });
    const initialData: FigDataHydrationEntry[] = [
      {
        key: ["eager-seeded-client", "collection", "eager-seeded-items"],
        value: {
          collectionId: "eager-seeded-items",
          rows: [],
          syncMeta: "server-offset",
        },
      },
    ];
    if (kind === "watch") {
      initialData.push({ key: ["eager-seeded-query"], value: [] });
    }
    const store = createDataStore({ initialData });
    if (kind === "load") {
      try {
        await store.ensureData(query);
      } finally {
        store.dispose();
      }
    } else {
      function Items() {
        return <p>{readData(query).length}</p>;
      }
      const host = document.createElement("div");
      document.body.append(host);
      const root = createRoot(host, { dataStore: store });
      roots.push(root);
      await act(async () => root.render(<Items />));
    }
    expect(events).toEqual(["import:server-offset", "sync:server-offset"]);
  },
);

it("stops a hydrated watch that unmounts while it acquires its observer", async () => {
  let unmount!: () => void;
  const items = collectionOptions("unmounting-items", () => ({
    id: "unmounting-items",
    getKey: (item: { id: string }) => item.id,
    startSync: true,
    sync: {
      sync: ({ markReady }) => {
        // Retires the watch after its observer is acquired, before it
        // subscribes.
        queueMicrotask(unmount);
        markReady();
      },
    },
  }));
  const query = liveQuery({
    key: () => ["unmounting-query"],
    query: () => (q) => q.from({ item: items }),
  });
  function Count() {
    return <p>{readData(query).length}</p>;
  }
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host, {
    dataStore: createDataStore({
      initialData: [{ key: ["unmounting-query"], value: [] }],
    }),
  });
  unmount = () => root.unmount();
  const unhandled = vi.fn();
  process.on("unhandledRejection", unhandled);
  try {
    await act(async () => root.render(<Count />));
    await new Promise((resolve) => setTimeout(resolve, 0));
  } finally {
    process.off("unhandledRejection", unhandled);
  }
  expect(unhandled).not.toHaveBeenCalled();
  expect(host.textContent).toBe("");
});
