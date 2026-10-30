// @vitest-environment happy-dom
import {
  createDataStore,
  dataResource,
  type DataResourceWatchContext,
  readData,
  Suspense,
} from "@bgub/fig";
import { afterEach, expect, it } from "vitest";
import { act } from "./act.ts";
import { createRoot, type FigRoot, hydrateRoot } from "./index.ts";

const roots: FigRoot[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) root.unmount();
  document.body.replaceChildren();
});

function container(html = "") {
  const host = document.createElement("div");
  host.innerHTML = html;
  document.body.append(host);
  return host;
}

it("hydrates the server snapshot, then applies the watch's newer value", async () => {
  const seenDuringWatchStart: string[] = [];
  let host!: HTMLElement;
  const notes = dataResource<[], string>({
    key: () => ["notes"],
    load: () => "loaded",
    watch: ({ publish }) => {
      seenDuringWatchStart.push(host.textContent ?? "");
      // Another tab wrote after the server (or worker) rendered this page.
      publish("written by another tab");
    },
  });
  function Notes() {
    return <p>{readData(notes)}</p>;
  }

  host = container("<p>from server</p>");
  const errors: unknown[] = [];
  await act(async () => {
    roots.push(
      hydrateRoot(host, <Notes />, {
        dataStore: createDataStore({
          initialData: [{ key: ["notes"], value: "from server" }],
        }),
        onRecoverableError: (error) => errors.push(error),
      }),
    );
  });

  // Hydration committed against the server value before the watch started.
  expect(seenDuringWatchStart).toEqual(["from server"]);
  expect(errors).toEqual([]);
  expect(host.innerHTML).toBe("<p>written by another tab</p>");
});

it("keeps components current and stops the watch on unmount", async () => {
  let source: DataResourceWatchContext<number> | undefined;
  const counter = dataResource<[string], number>({
    key: (id) => ["counter", id],
    watch: (_id, context) => {
      source = context;
      context.publish(0);
    },
  });
  function Counter() {
    return <output>{readData(counter, "a")}</output>;
  }

  const host = container();
  const root = createRoot(host);
  roots.push(root);
  await act(async () => {
    root.render(
      <Suspense fallback={<span>waiting</span>}>
        <Counter />
      </Suspense>,
    );
  });
  expect(host.textContent).toBe("0");

  await act(async () => source?.publish(1));
  expect(host.textContent).toBe("1");

  const watch = source;
  await act(async () => root.render(null));
  expect(watch?.signal.reason).toBe("released");
});

it("holds a push-only watch while its Suspense fallback waits, however long", async () => {
  let source: DataResourceWatchContext<string> | undefined;
  const presence = dataResource<[string], string>({
    key: (room) => ["presence", room],
    watch: (_room, context) => {
      source = context;
    },
  });
  function Presence() {
    return <output>{readData(presence, "design")}</output>;
  }

  const host = container();
  const root = createRoot(host);
  roots.push(root);
  await act(async () => {
    root.render(
      <Suspense fallback={<span>connecting</span>}>
        <Presence />
      </Suspense>,
    );
  });
  expect(host.textContent).toBe("connecting");
  const firstWatch = source;
  expect(firstWatch?.signal.aborted).toBe(false);

  await act(async () => source?.publish("Ada"));
  expect(host.textContent).toBe("Ada");
  // The revealed reader took over the same watch.
  expect(source).toBe(firstWatch);
  expect(firstWatch?.signal.aborted).toBe(false);

  await act(async () => root.render(null));
  expect(firstWatch?.signal.reason).toBe("released");
});

it("stops a push-only watch when its waiting fallback unmounts", async () => {
  let source: DataResourceWatchContext<string> | undefined;
  const feed = dataResource<[], string>({
    key: () => ["feed"],
    watch: (context) => {
      source = context;
    },
  });
  function Feed() {
    return <output>{readData(feed)}</output>;
  }

  const host = container();
  const root = createRoot(host);
  roots.push(root);
  await act(async () => {
    root.render(
      <Suspense fallback={<span>waiting</span>}>
        <Feed />
      </Suspense>,
    );
  });
  expect(source?.signal.aborted).toBe(false);

  await act(async () => root.render(<p>elsewhere</p>));
  // The value-less entry is discarded along with its watch.
  expect(source?.signal.reason).toBe("evicted");
});

it("keeps a push-only watch across Suspense boundary replacement", async () => {
  const sources: DataResourceWatchContext<string>[] = [];
  const feed = dataResource<[], string>({
    key: () => ["replaced-feed"],
    watch: (context) => {
      sources.push(context);
    },
  });
  function Feed() {
    return <output>{readData(feed)}</output>;
  }

  const host = container();
  const root = createRoot(host);
  roots.push(root);
  const render = (key: string) =>
    root.render(
      <Suspense key={key} fallback={<span>waiting {key}</span>}>
        <Feed />
      </Suspense>,
    );
  await act(async () => render("a"));
  expect(host.textContent).toBe("waiting a");

  // The old boundary unmounts while the new one takes over the same read.
  await act(async () => render("b"));
  expect(host.textContent).toBe("waiting b");
  expect(sources).toHaveLength(1);
  expect(sources[0]?.signal.aborted).toBe(false);

  await act(async () => sources[0]?.publish("Ada"));
  expect(host.textContent).toBe("Ada");
});

it("keeps a pending loader across Suspense boundary replacement", async () => {
  const signals: AbortSignal[] = [];
  let resolveLoad: (value: string) => void = () => undefined;
  const feed = dataResource<[], string>({
    key: () => ["replaced-loader"],
    load: ({ signal }) => {
      signals.push(signal);
      return new Promise<string>((resolve) => {
        resolveLoad = resolve;
      });
    },
  });
  function Feed() {
    return <output>{readData(feed)}</output>;
  }
  const host = container();
  const root = createRoot(host);
  roots.push(root);
  const render = (key: string) =>
    root.render(
      <Suspense key={key} fallback={<span>waiting {key}</span>}>
        <Feed />
      </Suspense>,
    );

  await act(async () => render("a"));
  await act(async () => render("b"));
  expect(host.textContent).toBe("waiting b");
  expect(signals).toHaveLength(1);
  expect(signals[0]?.aborted).toBe(false);

  await act(async () => resolveLoad("Ada"));
  expect(host.textContent).toBe("Ada");
});
