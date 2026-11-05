// @vitest-environment happy-dom
import {
  MissingCapabilityError,
  createDataStore,
  dataResource,
  type FigDataHydrationEntry,
  readData,
  requireCapability,
  Suspense,
} from "@bgub/fig";
import {
  decodePayloadDataEntries,
  encodePayloadDataEntries,
} from "@bgub/fig/internal";
import { renderToHtml } from "@bgub/fig-server";
import { afterEach, expect, it, vi } from "vitest";
import { act } from "./act.ts";
import { type FigRoot, hydrateRoot } from "./index.ts";

const roots: FigRoot[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) root.unmount();
  document.body.replaceChildren();
});

class Connection {
  closed = false;
  constructor(readonly rows: string[]) {}
}

// The serialized form a real document carries between server and browser.
function transfer(entries: readonly FigDataHydrationEntry[]) {
  return decodePayloadDataEntries(encodePayloadDataEntries(entries));
}

it("keeps `transfer: false` entries in the store that created them", async () => {
  const connection = dataResource<[], Connection>({
    key: () => ["connection"],
    load: ({ signal }) => {
      const value = new Connection(["a"]);
      signal.addEventListener("abort", () => (value.closed = true));
      return value;
    },
    transfer: false,
  });
  const rows = dataResource<[], string[]>({
    key: () => ["rows"],
    load: async ({ data }) => (await data.ensureData(connection)).rows,
  });
  const server = createDataStore();
  const live = await server.ensureData(connection);
  await server.ensureData(rows);

  const entries = server.snapshot();
  expect(entries).toEqual([{ key: ["rows"], value: ["a"] }]);

  // The browser's own load opens its own connection, with its own lifetime.
  const client = createDataStore({ initialData: transfer(entries) });
  const opened = await client.ensureData(connection);
  expect(opened).not.toBe(live);
  client.dispose();
  expect(opened.closed).toBe(true);
  expect(live.closed).toBe(false);
  server.dispose();
  expect(live.closed).toBe(true);
});

it("hands a transfer form to the browser's next load", async () => {
  const loads: unknown[] = [];
  const portable = dataResource<[], Connection>({
    key: () => ["portable"],
    load: ({ signal, transferred }) => {
      loads.push(transferred);
      const value = new Connection((transferred as string[]) ?? ["fresh"]);
      signal.addEventListener("abort", () => (value.closed = true));
      return value;
    },
    transfer: (connection) => connection.rows,
  });
  const server = createDataStore();
  const original = await server.ensureData(portable);
  original.rows.push("later");

  // Taken when the snapshot is: rows added after the load are included.
  const entries = server.snapshot();
  expect(entries).toEqual([{ key: ["portable"], value: ["fresh", "later"] }]);
  expect(await server.ensureData(portable)).toBe(original);

  const client = createDataStore({ initialData: transfer(entries) });
  // Until a reader names the resource, the entry holds the transfer form.
  expect(client.snapshot()).toEqual(entries);
  const revived = await client.ensureData(portable);
  expect(revived).toBeInstanceOf(Connection);
  expect(revived.rows).toEqual(["fresh", "later"]);
  // The load consumed it: a later load starts fresh.
  await client.refreshData(portable);
  expect(loads).toEqual([undefined, ["fresh", "later"], undefined]);
  const current = await client.ensureData(portable);
  client.dispose();
  expect(current.closed).toBe(true);
  server.dispose();
});

it("hydrates a transfer form without suspending when the load is synchronous", async () => {
  const portable = dataResource<[], Connection>({
    key: () => ["sync-portable"],
    load: ({ transferred }) =>
      new Connection((transferred as string[] | undefined) ?? []),
    transfer: (connection) => connection.rows,
  });
  function Rows() {
    return <p>{readData(portable).rows.join(",")}</p>;
  }
  const app = (
    <Suspense fallback={<p>loading</p>}>
      <Rows />
    </Suspense>
  );
  const server = createDataStore({
    initialData: [{ key: ["sync-portable"], value: ["a", "b"] }],
  });
  const html = await renderToHtml(app, { dataStore: server });
  expect(html).toContain("a,b");

  const host = document.createElement("div");
  host.innerHTML = html;
  document.body.append(host);
  runInlineScripts(host);
  const recoverable = vi.fn();
  await act(async () => {
    roots.push(
      hydrateRoot(host, app, {
        dataStore: createDataStore({
          initialData: [{ key: ["sync-portable"], value: ["a", "b"] }],
        }),
        onRecoverableError: recoverable,
      }),
    );
  });
  expect(recoverable).not.toHaveBeenCalled();
  expect(host.textContent).toBe("a,b");
});

it("freezes transfer forms before disposal retires live values", async () => {
  const portable = dataResource<[], Connection>({
    key: () => ["frozen"],
    load: ({ signal }) => {
      const connection = new Connection(["kept"]);
      // Closing empties the connection, as a cleaned-up client would.
      signal.addEventListener("abort", () => connection.rows.splice(0));
      return connection;
    },
    transfer: (connection) => [...connection.rows],
  });
  const server = createDataStore();
  await server.ensureData(portable);
  server.dispose();
  // A server render's getData() may run after its stream closed the store.
  expect(server.snapshot()).toEqual([{ key: ["frozen"], value: ["kept"] }]);
});

it("transfers values as is without a transfer rule", async () => {
  const live = dataResource<[], Connection>({
    key: () => ["untransferable"],
    load: () => new Connection([]),
  });
  const server = createDataStore();
  await server.ensureData(live);
  // A live value with no rule reaches the codec, which rejects it.
  expect(() => transfer(server.snapshot())).toThrow();
  server.dispose();
});

it("leaves a browser-only load to the browser during server rendering", async () => {
  const onError = vi.fn();
  let inBrowser = false;
  const notes = dataResource<[], string>({
    key: () => ["browser-notes"],
    load: () => {
      requireCapability(inBrowser, "Notes live in IndexedDB.");
      return "local notes";
    },
  });
  function Notes() {
    return <p>{readData(notes)}</p>;
  }
  const app = (
    <Suspense fallback={<p>opening notes</p>}>
      <Notes />
    </Suspense>
  );

  const html = await renderToHtml(app, { onError });
  expect(html).toContain("opening notes");
  // Required before any work: decided in the shell, with no streamed segment.
  expect(html).not.toContain('<div hidden id="s-');
  expect(onError).not.toHaveBeenCalled();

  const server = createDataStore();
  await expect(server.ensureData(notes)).rejects.toBeInstanceOf(
    MissingCapabilityError,
  );
  server.dispose();

  inBrowser = true;
  const host = document.createElement("div");
  host.innerHTML = html;
  document.body.append(host);
  runInlineScripts(host);
  expect(host.innerHTML).toContain("<!--fig:suspense:browser-->");
  const recoverable = vi.fn();
  await act(async () => {
    roots.push(hydrateRoot(host, app, { onRecoverableError: recoverable }));
  });
  expect(host.textContent).toBe("local notes");
  expect(recoverable).not.toHaveBeenCalled();
});

it("leaves a load that discovers the requirement later to the browser", async () => {
  const onError = vi.fn();
  let inBrowser = false;
  const notes = dataResource<[], string>({
    key: () => ["late-browser-notes"],
    load: async () => {
      await Promise.resolve();
      requireCapability(inBrowser, "Notes live in IndexedDB.");
      return "local notes";
    },
  });
  function Notes() {
    return <p>{readData(notes)}</p>;
  }
  const app = (
    <Suspense fallback={<p>opening notes</p>}>
      <Notes />
    </Suspense>
  );
  const html = await renderToHtml(app, { onError });
  expect(onError).not.toHaveBeenCalled();

  // The boundary's content was staged before the requirement surfaced.
  expect(html).toContain('<div hidden id="s-');

  inBrowser = true;
  const host = document.createElement("div");
  host.innerHTML = html;
  document.body.append(host);
  // The streamed operation marks the boundary and removes the staged content.
  runInlineScripts(host);
  expect(host.innerHTML).toContain("<!--fig:suspense:browser-->");
  expect(host.querySelector("[hidden]")).toBeNull();
  const recoverable = vi.fn();
  await act(async () => {
    roots.push(hydrateRoot(host, app, { onRecoverableError: recoverable }));
  });
  expect(host.textContent).toBe("local notes");
  expect(recoverable).not.toHaveBeenCalled();
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
