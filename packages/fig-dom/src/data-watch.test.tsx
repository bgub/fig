// @vitest-environment happy-dom
import {
  createDataStore,
  dataResource,
  type DataResourceWatchContext,
  readData,
  Suspense,
  transition,
  useState,
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

it("keeps a pending loader while a transition preserves the previous screen", async () => {
  let loads = 0;
  let advance = () => {};
  let resolveLoad: (value: string) => void = () => undefined;
  let pendingSignal: AbortSignal | undefined;
  const resource = dataResource<[number], string>({
    key: (id) => ["transition-loader", id],
    load: (id, { signal }) => {
      if (id === 0) return "old";
      loads += 1;
      // Bound a broken implementation's retry loop so the assertion fails.
      if (loads > 1) return "unexpected retry";
      pendingSignal = signal;
      return new Promise<string>((resolve) => {
        resolveLoad = resolve;
      });
    },
  });
  function Value({ id }: { id: number }) {
    return <p>{readData(resource, id)}</p>;
  }
  function App() {
    const [id, setId] = useState(0);
    advance = () => transition(() => setId(1));
    return (
      <Suspense fallback={<p>loading</p>}>
        <Value id={id} />
      </Suspense>
    );
  }
  const host = container();
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(<App />));
  await act(async () => advance());
  expect(loads).toBe(1);
  expect(pendingSignal?.aborted).toBe(false);
  expect(host.textContent).toBe("old");

  await act(async () => resolveLoad("new"));
  expect(host.textContent).toBe("new");
  expect(loads).toBe(1);
});

function pushOnlyTransition(immediate = false, boundary = true) {
  const contexts = new Map<number, DataResourceWatchContext<string>[]>();
  const errors: unknown[] = [];
  let keyReads = 0;
  let setId: (id: number) => void = () => undefined;
  let updateOther = () => {};
  const resource = dataResource<[number], string>({
    key: (id) => {
      // Keep a regression's eviction/retry loop bounded.
      if (++keyReads > 50) throw new Error("Push-only transition retry loop");
      return ["transition-watch", id];
    },
    watch: (id, context) => {
      const watches = contexts.get(id) ?? [];
      watches.push(context);
      contexts.set(id, watches);
      if (id === 0) context.publish("old");
      else if (immediate) context.publish("new");
    },
  });
  function Value({ id }: { id: number }) {
    return <output>{readData(resource, id)}</output>;
  }
  function App() {
    const [id, set] = useState(0);
    const [other, setOther] = useState(0);
    setId = set;
    updateOther = () => setOther((value) => value + 1);
    return (
      <>
        <span>{other}</span>
        {boundary ? (
          <Suspense fallback="loading">
            <Value id={id} />
          </Suspense>
        ) : (
          <Value id={id} />
        )}
      </>
    );
  }
  const host = container();
  const root = createRoot(host, {
    dataStore: createDataStore({
      initialData: [{ key: ["transition-watch", 0], value: "old" }],
    }),
    onUncaughtError: (error) => errors.push(error),
  });
  roots.push(root);
  return {
    contexts,
    errors,
    host,
    root,
    resource,
    render: () => root.render(<App />),
    advance: (id = 1) => transition(() => setId(id)),
    cancel: () => setId(0),
    updateOther: () => updateOther(),
  };
}

it.each([false, true])(
  "retains a transition's push-only read with immediate publication: %s",
  async (immediate) => {
    const test = pushOnlyTransition(immediate);
    await act(async () => test.render());
    await act(async () => test.advance());
    expect(test.errors).toEqual([]);
    expect(test.contexts.get(1)).toHaveLength(1);
    const watch = test.contexts.get(1)?.[0];
    expect(watch?.signal.aborted).toBe(false);
    if (!immediate) {
      expect(test.host.textContent).toBe("0old");
      await act(async () => test.updateOther());
      expect(test.host.textContent).toBe("1old");
      expect(watch?.signal.aborted).toBe(false);
      await act(async () => watch?.publish("new"));
    }
    expect(test.host.querySelector("output")?.textContent).toBe("new");
    expect(test.contexts.get(1)).toHaveLength(1);
    expect(watch?.signal.aborted).toBe(false);
    // Keep the same boundary mounted: completion must have released its
    // temporary hold, so switching back stops the now-unused watch.
    await act(async () => test.cancel());
    expect(test.host.querySelector("output")?.textContent).toBe("old");
    expect(watch?.signal.aborted).toBe(true);
  },
);

it.each(["remove", "unmount", "supersede"])(
  "releases a suspended transition's push-only read on %s",
  async (outcome) => {
    const test = pushOnlyTransition();
    await act(async () => test.render());
    await act(async () => test.advance());
    expect(test.errors).toEqual([]);
    expect(test.contexts.get(1)).toHaveLength(1);
    const watch = test.contexts.get(1)?.[0];
    await act(async () => {
      if (outcome === "remove") test.root.render(<p>elsewhere</p>);
      else if (outcome === "unmount") test.root.unmount();
      else test.cancel();
    });
    expect(watch?.signal.aborted).toBe(true);
    expect(test.errors).toEqual([]);
  },
);

it("keeps a transition's pending watch for another caller after boundary removal", async () => {
  const test = pushOnlyTransition();
  await act(async () => test.render());
  await act(async () => test.advance());
  expect(test.errors).toEqual([]);
  const watch = test.contexts.get(1)?.[0];
  const value = test.root.data.ensureData(test.resource, 1);
  await act(async () => test.root.render(<p>elsewhere</p>));
  expect(watch?.signal.aborted).toBe(false);
  await act(async () => watch?.publish("shared"));
  expect(await value).toBe("shared");
  expect(watch?.signal.aborted).toBe(true);
});

it("releases preserved transition reads when the source fails", async () => {
  const test = pushOnlyTransition();
  await act(async () => test.render());
  await act(async () => test.advance());
  const watch = test.contexts.get(1)?.[0];
  const error = new Error("Source failed");
  await act(async () => watch?.fail(error));
  expect(test.errors).toEqual([error]);
  expect(watch?.signal.aborted).toBe(true);
  expect(test.host.textContent).toBe("");
});

it.each([false, true])(
  "retains a root-level transition with immediate publication: %s",
  async (immediate) => {
    const test = pushOnlyTransition(immediate, false);
    await act(async () => test.render());
    await act(async () => test.advance());
    expect(test.errors).toEqual([]);
    expect(test.contexts.get(1)).toHaveLength(1);
    const watch = test.contexts.get(1)?.[0];
    if (!immediate) {
      expect(test.host.querySelector("output")?.textContent).toBe("old");
      await act(async () => test.updateOther());
      expect(watch?.signal.aborted).toBe(false);
      await act(async () => watch?.publish("new"));
    }
    expect(test.host.querySelector("output")?.textContent).toBe("new");
    expect(test.contexts.get(1)).toHaveLength(1);
    await act(async () => test.cancel());
    expect(watch?.signal.aborted).toBe(true);
  },
);

it.each(["unmount", "supersede"])(
  "releases a root-level suspended transition on %s",
  async (outcome) => {
    const test = pushOnlyTransition(false, false);
    await act(async () => test.render());
    await act(async () => test.advance());
    expect(test.errors).toEqual([]);
    expect(test.contexts.get(1)).toHaveLength(1);
    const watch = test.contexts.get(1)?.[0];
    await act(async () =>
      outcome === "unmount" ? test.root.unmount() : test.cancel(),
    );
    expect(watch?.signal.aborted).toBe(true);
  },
);

it.each(["immediate", "delayed", "unmount"])(
  "holds an initial push-only read without Suspense: %s",
  async (outcome) => {
    let reads = 0;
    const watches: DataResourceWatchContext<string>[] = [];
    const errors: unknown[] = [];
    const resource = dataResource<[], string>({
      key: () => {
        if (++reads > 50) throw new Error("Root suspension retry loop");
        return ["root-push-only"];
      },
      watch: (context) => {
        watches.push(context);
        if (outcome === "immediate") context.publish("ready");
      },
    });
    function Value() {
      return <output>{readData(resource)}</output>;
    }
    const host = container();
    const root = createRoot(host, {
      onUncaughtError: (error) => errors.push(error),
    });
    roots.push(root);
    await act(async () => root.render(<Value />));
    expect(errors).toEqual([]);
    expect(watches).toHaveLength(1);
    const watch = watches[0];
    expect(watch?.signal.aborted).toBe(false);
    if (outcome === "unmount") {
      await act(async () => root.unmount());
      expect(watch?.signal.aborted).toBe(true);
      return;
    }
    if (outcome === "delayed") {
      expect(host.textContent).toBe("");
      await act(async () => watch?.publish("ready"));
    }
    expect(host.textContent).toBe("ready");
    expect(watches).toHaveLength(1);
    await act(async () => root.render(null));
    expect(watch?.signal.aborted).toBe(true);
  },
);

it("releases a superseded root-level key when the newer transition commits", async () => {
  const test = pushOnlyTransition(false, false);
  await act(async () => test.render());
  await act(async () => test.advance(1));
  await act(async () => test.advance(2));
  expect(test.errors).toEqual([]);
  expect(test.contexts.get(1)).toHaveLength(1);
  expect(test.contexts.get(2)).toHaveLength(1);
  const first = test.contexts.get(1)?.[0];
  const second = test.contexts.get(2)?.[0];
  await act(async () => second?.publish("second"));
  expect(test.host.querySelector("output")?.textContent).toBe("second");
  expect(first?.signal.aborted).toBe(true);
  expect(second?.signal.aborted).toBe(false);
  await act(async () => first?.publish("late"));
  expect(test.host.querySelector("output")?.textContent).toBe("second");
});
