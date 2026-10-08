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
import { expect, it } from "vitest";
import { createRoot, flushSync, insertAssetResources } from "./index.ts";
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

it("keeps the first live definition when an equivalent asset mounts", () => {
  const container = document.createElement("div");
  const root = createRoot(container);
  const original = h("link", {
    rel: "preload",
    as: "script",
    href: "/shared.js",
    crossorigin: "anonymous",
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
        }),
      ]),
    );
    expect(document.head.querySelectorAll("link")).toHaveLength(1);
    expect(live?.getAttribute("crossorigin")).toBe("anonymous");
  } finally {
    flushSync(() => root.unmount());
    document.head.replaceChildren();
  }
});

it("adopts an asset inserted while suspended without changing its live definition", async () => {
  const gate = deferred<void>();
  const container = document.createElement("div");
  const root = createRoot(container);
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
    gate.resolve();
    await waitForHostTurns();
    expect(container.textContent).toBe("ready");
    expect(
      document.head.querySelectorAll('link[href="/late.js"]'),
    ).toHaveLength(1);
    expect(document.head.querySelector('link[href="/late.js"]')).toBe(inserted);
    expect(inserted?.getAttribute("crossorigin")).toBe("anonymous");
  } finally {
    flushSync(() => root.unmount());
    document.head.replaceChildren();
  }
});
