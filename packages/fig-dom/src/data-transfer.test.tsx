// @vitest-environment happy-dom
import {
  BrowserRequiredError,
  createDataStore,
  dataResource,
  readData,
  requireBrowser,
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
function transfer(
  entries: ReturnType<ReturnType<typeof createDataStore>["snapshot"]>,
) {
  return decodePayloadDataEntries(encodePayloadDataEntries(entries));
}

it("keeps excluded entries out of the snapshot and transfers dehydrated forms", async () => {
  const live = dataResource<[], Connection>({
    key: () => ["connection"],
    dehydrate: false,
    load: () => new Connection(["a"]),
  });
  const portable = dataResource<[], Connection>({
    key: () => ["portable"],
    dehydrate: (connection) => connection.rows,
    rehydrate: (rows) => new Connection(rows as string[]),
    load: () => new Connection(["b", "c"]),
  });
  const server = createDataStore();
  await server.ensureData(live);
  const original = await server.ensureData(portable);

  const entries = server.snapshot();
  expect(entries).toEqual([{ key: ["portable"], value: ["b", "c"] }]);
  // Readers on the server still see the live value.
  expect(await server.ensureData(portable)).toBe(original);

  const client = createDataStore({ initialData: transfer(entries) });
  // Before any resource reads it, the entry is still in its transferred form.
  expect(client.snapshot()).toEqual(entries);
  const revived = await client.ensureData(portable);
  expect(revived).toBeInstanceOf(Connection);
  expect(revived.rows).toEqual(["b", "c"]);
  expect(await client.ensureData(portable)).toBe(revived);
  server.dispose();
  client.dispose();
});

it("freezes dehydrated forms before disposal retires live values", async () => {
  const portable = dataResource<[], Connection>({
    key: () => ["frozen"],
    dehydrate: (connection) => [...connection.rows],
    load: ({ signal }) => {
      const connection = new Connection(["kept"]);
      // Closing empties the connection, as a cleaned-up client would.
      signal.addEventListener("abort", () => connection.rows.splice(0));
      return connection;
    },
  });
  const server = createDataStore();
  await server.ensureData(portable);
  server.dispose();
  // A server render's getData() may run after its stream closed the store.
  expect(server.snapshot()).toEqual([{ key: ["frozen"], value: ["kept"] }]);
});

it("retires a revived value with its entry", async () => {
  const signals: AbortSignal[] = [];
  const portable = dataResource<[], Connection>({
    key: () => ["revived"],
    dehydrate: (connection) => connection.rows,
    rehydrate: (rows, { signal }) => {
      signals.push(signal);
      const connection = new Connection(rows as string[]);
      signal.addEventListener("abort", () => (connection.closed = true));
      return connection;
    },
  });
  const client = createDataStore({
    initialData: [{ key: ["revived"], value: ["x"] }],
  });
  const connection = await client.ensureData(portable);
  expect(connection.closed).toBe(false);
  client.dispose();
  expect(signals[0]?.reason).toBe("store-disposed");
  expect(connection.closed).toBe(true);
});

it("leaves a browser-only load to the browser during server rendering", async () => {
  const onError = vi.fn();
  let inBrowser = false;
  const notes = dataResource<[], string>({
    key: () => ["browser-notes"],
    load: () =>
      inBrowser ? "local notes" : requireBrowser("Notes live in IndexedDB."),
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
    BrowserRequiredError,
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
      return inBrowser
        ? "local notes"
        : requireBrowser("Notes live in IndexedDB.");
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
