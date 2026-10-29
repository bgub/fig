// @vitest-environment happy-dom
import {
  createElement as h,
  createDataStore,
  dataResource,
  preload,
  readData,
  readPromise,
  Suspense,
} from "@bgub/fig";
import { expect, it, vi } from "vitest";
import { createRoot, flushSync, insertAssetResources, on } from "./index.ts";
import { deferred, waitForHostTurns } from "./test-utils.ts";

it.each(["reveal", "discard"])(
  "keeps a shared asset unchanged through repeated retries before %s",
  async (outcome) => {
    const resource = dataResource<[], string>({ key: () => ["asset"] });
    const store = createDataStore({
      initialData: [{ key: ["asset"], value: "/old.js" }],
    });
    const gates = [deferred<void>(), deferred<void>()];
    const container = document.createElement("div");
    const errors: unknown[] = [];
    const root = createRoot(container, {
      dataStore: store,
      onUncaughtError: (error) => errors.push(error),
    });
    function Reader() {
      return h("link", {
        rel: "preload",
        as: "script",
        href: readData(resource),
      });
    }
    function Pending() {
      for (const gate of gates) readPromise(gate.promise);
      return "ready";
    }
    const original = h("link", {
      rel: "preload",
      as: "script",
      href: "/old.js",
    });
    try {
      flushSync(() => root.render(original));
      const live = document.head.querySelector('link[href="/old.js"]');
      expect(live).not.toBeNull();
      flushSync(() =>
        root.render([
          original,
          h(
            Suspense,
            { fallback: "waiting" },
            h("section", null, h(Reader)),
            h(Pending),
          ),
        ]),
      );
      store.hydrate([{ key: ["asset"], value: "/intermediate.js" }]);
      gates[0].resolve();
      await waitForHostTurns();
      expect(container.textContent).toBe("waiting");
      expect(live?.getAttribute("href")).toBe("/old.js");
      expect(
        document.head.querySelector('link[href="/intermediate.js"]'),
      ).toBeNull();
      store.hydrate([{ key: ["asset"], value: "/new.js" }]);
      if (outcome === "discard") flushSync(() => root.render(original));
      gates[1].resolve();
      await waitForHostTurns();
      expect(errors).toEqual([]);
      expect(document.head.querySelector('link[href="/old.js"]')).toBe(live);
      expect(
        document.head.querySelector('link[href="/intermediate.js"]'),
      ).toBeNull();
      expect(
        document.head.querySelectorAll('link[href="/new.js"]'),
      ).toHaveLength(outcome === "reveal" ? 1 : 0);
      if (outcome === "reveal") {
        expect(container.textContent).toBe("ready");
        await insertAssetResources([
          preload("/old.js", "script"),
          preload("/new.js", "script"),
        ]);
        expect(document.head.querySelectorAll("link")).toHaveLength(2);
      }
    } finally {
      flushSync(() => root.unmount());
      document.head.replaceChildren();
    }
  },
);

it.each(["server", "payload"])(
  "attaches client behavior when adopting a %s asset without rewriting its attributes",
  async (source) => {
    if (source === "server") {
      document.head.innerHTML =
        '<link rel="preload" as="script" href="/adopted.js" crossorigin="anonymous">';
    } else {
      await insertAssetResources([
        preload("/adopted.js", "script", { crossorigin: "anonymous" }),
      ]);
    }
    const existing = document.head.querySelector("link")!;
    const container = document.createElement("div");
    const root = createRoot(container);
    const bind = vi.fn((_node: Element, _signal: AbortSignal) => {
      expect(container.textContent).toBe("ready");
    });
    const load = vi.fn();
    const error = vi.fn();
    try {
      flushSync(() =>
        root.render([
          h("link", {
            rel: "preload",
            as: "script",
            href: "/adopted.js",
            crossorigin: "use-credentials",
            bind,
            mix: [on("load", load), on("error", error)],
          }),
          h("output", null, "ready"),
        ]),
      );
      expect(document.head.querySelectorAll("link")).toHaveLength(1);
      expect(document.head.querySelector("link")).toBe(existing);
      expect(existing.getAttribute("crossorigin")).toBe("anonymous");
      expect(bind).toHaveBeenCalledTimes(2);
      expect(bind.mock.calls[1]?.[0]).toBe(existing);
      expect(bind.mock.calls[0]?.[1].aborted).toBe(true);
      expect(bind.mock.calls[1]?.[1].aborted).toBe(false);
      existing.dispatchEvent(new Event("load"));
      existing.dispatchEvent(new Event("error"));
      expect(load).toHaveBeenCalledTimes(1);
      expect(error).toHaveBeenCalledTimes(1);
    } finally {
      flushSync(() => root.unmount());
      document.head.replaceChildren();
    }
  },
);

it("keeps the first live definition and behavior when a behavior-free asset mounts", () => {
  const container = document.createElement("div");
  const root = createRoot(container);
  const bind = vi.fn();
  const load = vi.fn();
  const original = h("link", {
    rel: "preload",
    as: "script",
    href: "/shared.js",
    crossorigin: "anonymous",
    bind,
    mix: on("load", load),
  });
  try {
    flushSync(() => root.render(original));
    const live = document.head.querySelector("link");
    flushSync(() =>
      root.render([
        original,
        h("link", {
          rel: "preload",
          as: "script",
          href: "/shared.js",
          crossorigin: "use-credentials",
          bind: undefined,
          mix: [],
        }),
      ]),
    );
    expect(document.head.querySelectorAll("link")).toHaveLength(1);
    expect(live?.getAttribute("crossorigin")).toBe("anonymous");
    expect(bind).toHaveBeenCalledTimes(2);
    expect(bind.mock.calls[1]?.[1].aborted).toBe(false);
    live?.dispatchEvent(new Event("load"));
    expect(load).toHaveBeenCalledTimes(1);
  } finally {
    flushSync(() => root.unmount());
    document.head.replaceChildren();
  }
});

it("adopts an asset inserted while suspended without changing its live definition", async () => {
  const gate = deferred<void>();
  const container = document.createElement("div");
  const root = createRoot(container);
  const bind = vi.fn();
  const load = vi.fn();
  function Pending() {
    readPromise(gate.promise);
    return "ready";
  }
  try {
    flushSync(() =>
      root.render(
        h(
          Suspense,
          { fallback: "waiting" },
          h(
            "section",
            null,
            h("link", {
              rel: "preload",
              as: "script",
              href: "/late.js",
              crossorigin: "use-credentials",
              bind,
              mix: on("load", load),
            }),
          ),
          h(Pending),
        ),
      ),
    );
    expect(document.head.querySelector('link[href="/late.js"]')).toBeNull();
    await insertAssetResources([
      preload("/late.js", "script", { crossorigin: "anonymous" }),
    ]);
    const inserted = document.head.querySelector('link[href="/late.js"]');
    expect(bind).not.toHaveBeenCalled();
    inserted?.dispatchEvent(new Event("load"));
    expect(load).not.toHaveBeenCalled();
    gate.resolve();
    await waitForHostTurns();
    expect(container.textContent).toBe("ready");
    expect(
      document.head.querySelectorAll('link[href="/late.js"]'),
    ).toHaveLength(1);
    expect(document.head.querySelector('link[href="/late.js"]')).toBe(inserted);
    expect(inserted?.getAttribute("crossorigin")).toBe("anonymous");
    expect(bind).toHaveBeenCalledTimes(2);
    expect(bind.mock.calls[1]?.[0]).toBe(inserted);
    inserted?.dispatchEvent(new Event("load"));
    expect(load).toHaveBeenCalledTimes(1);
  } finally {
    flushSync(() => root.unmount());
    document.head.replaceChildren();
  }
});
