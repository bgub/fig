// @vitest-environment happy-dom
import {
  createElement,
  readPromise,
  Suspense,
  transition,
  useBeforePaint,
  useSyncExternalStore,
  useState,
  ViewTransition,
  type StateSetter,
} from "@bgub/fig";
import { describe, expect, it } from "vite-plus/test";
import { act } from "./act.ts";
import { createRoot } from "./index.ts";

interface MockViewTransitionDocument {
  startViewTransition?: (update: () => void) => {
    finished: Promise<unknown>;
    ready: Promise<unknown>;
  };
}

describe("ViewTransition", () => {
  it("wraps transition commits and restores temporary names", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const snapshots: string[] = [];
    let setLabel: StateSetter<string> | null = null;
    const ownerDocument = document as unknown as MockViewTransitionDocument;
    const previousStart = ownerDocument.startViewTransition;

    ownerDocument.startViewTransition = (update) => {
      snapshots.push(surfaceStyle(container).viewTransitionName ?? "");
      snapshots.push(surfaceStyle(container).viewTransitionClass ?? "");
      update();
      snapshots.push(surfaceStyle(container).viewTransitionName ?? "");
      snapshots.push(surfaceStyle(container).viewTransitionClass ?? "");
      return { finished: Promise.resolve(), ready: Promise.resolve() };
    };

    function App() {
      const [label, set] = useState("First");
      setLabel = set;
      return createElement(
        ViewTransition,
        { default: "fade", name: "card" },
        createElement("section", null, label),
      );
    }

    try {
      const root = createRoot(container);
      await act(() => root.render(createElement(App, null)));
      await act(() => setLabel?.("Sync"));

      expect(snapshots).toEqual([]);

      await act(() => transition(() => setLabel?.("Transition")));

      expect(snapshots).toEqual(["card", "fade", "card", "fade"]);
      await Promise.resolve();
      expect(surfaceStyle(container).viewTransitionName).toBe("");
      expect(surfaceStyle(container).viewTransitionClass).toBe("");
      expect(container.textContent).toBe("Transition");
    } finally {
      ownerDocument.startViewTransition = previousStart;
      container.remove();
    }
  });

  it("keeps the commit alive for async native update callbacks", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const snapshots: string[] = [];
    let setLabel: StateSetter<string> | null = null;
    let returned = false;
    const ownerDocument = document as unknown as MockViewTransitionDocument;
    const previousStart = ownerDocument.startViewTransition;

    ownerDocument.startViewTransition = (update) => {
      queueMicrotask(() => {
        snapshots.push(returned ? "async" : "sync");
        snapshots.push(surfaceStyle(container).viewTransitionName ?? "");
        update();
        snapshots.push(container.textContent ?? "");
        snapshots.push(surfaceStyle(container).viewTransitionName ?? "");
      });
      returned = true;
      return { finished: Promise.resolve(), ready: Promise.resolve() };
    };

    function App() {
      const [label, set] = useState("First");
      setLabel = set;
      return createElement(
        ViewTransition,
        { default: "fade", name: "card" },
        createElement("section", null, label),
      );
    }

    try {
      const root = createRoot(container);
      await act(() => root.render(createElement(App, null)));
      await act(() => transition(() => setLabel?.("Second")));

      expect(snapshots).toEqual(["async", "card", "Second", "card"]);
      expect(container.textContent).toBe("Second");
      await Promise.resolve();
      expect(surfaceStyle(container).viewTransitionName).toBe("");
    } finally {
      ownerDocument.startViewTransition = previousStart;
      container.remove();
    }
  });

  it("animates client-side Suspense reveals (retry lane)", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const snapshots: string[] = [];
    let resolve: (value: string) => void = () => undefined;
    const promise = new Promise<string>((done) => {
      resolve = done;
    });
    const ownerDocument = document as unknown as MockViewTransitionDocument;
    const previousStart = ownerDocument.startViewTransition;

    ownerDocument.startViewTransition = (update) => {
      update();
      const surface = container.querySelector(
        "#revealed",
      ) as HTMLElement | null;
      snapshots.push(surface?.style.viewTransitionName ?? "");
      snapshots.push(surface?.style.viewTransitionClass ?? "");
      return { finished: Promise.resolve(), ready: Promise.resolve() };
    };

    function Content() {
      const value = readPromise(promise);
      return createElement(
        ViewTransition,
        { enter: "reveal", name: "card" },
        createElement("section", { id: "revealed" }, value),
      );
    }

    try {
      const root = createRoot(container);
      await act(() =>
        root.render(
          createElement(
            Suspense,
            { fallback: createElement("p", null, "Loading") },
            createElement(Content, null),
          ),
        ),
      );

      expect(container.textContent).toBe("Loading");
      expect(snapshots).toEqual([]);

      await act(async () => {
        resolve("Loaded");
        await promise;
      });

      expect(container.textContent).toBe("Loaded");
      expect(snapshots).toEqual(["card", "reveal"]);
    } finally {
      ownerDocument.startViewTransition = previousStart;
      container.remove();
    }
  });

  it("suppresses unpaired mounts with enter=none but keeps share pairing", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const starts: string[][] = [];
    let setStep: StateSetter<"solo" | "paired" | "start"> | null = null;
    const ownerDocument = document as unknown as MockViewTransitionDocument;
    const previousStart = ownerDocument.startViewTransition;

    const namedSurfaces = (): string[] =>
      Array.from(container.querySelectorAll<HTMLElement>("section, aside"))
        .filter((element) => Boolean(element.style.viewTransitionName))
        .map(
          (element) =>
            `${element.id}:${element.style.viewTransitionName}:${
              element.style.viewTransitionClass || ""
            }`,
        )
        .sort();

    ownerDocument.startViewTransition = (update) => {
      const before = namedSurfaces();
      update();
      starts.push(before, namedSurfaces());
      return { finished: Promise.resolve(), ready: Promise.resolve() };
    };

    function App() {
      const [step, set] = useState<"solo" | "paired" | "start">("start");
      setStep = set;
      return createElement(
        "main",
        null,
        step === "paired"
          ? createElement(
              ViewTransition,
              { key: "new", enter: "none", name: "hero", share: "hero-share" },
              createElement("section", { id: "hero-new" }, "Hero"),
            )
          : createElement(
              ViewTransition,
              { key: "old", enter: "none", name: "hero", share: "hero-share" },
              createElement("section", { id: "hero-old" }, "Hero"),
            ),
        // An unpaired boundary mounting with enter="none" contributes no
        // surfaces.
        step === "start"
          ? null
          : createElement(
              ViewTransition,
              { enter: "none", name: "solo-card" },
              createElement("aside", { id: "solo" }, "Solo"),
            ),
      );
    }

    try {
      const root = createRoot(container);
      await act(() => root.render(createElement(App, null)));

      await act(() => transition(() => setStep?.("solo")));
      // Only the solo mount happened; enter="none" left the plan empty, so
      // no transition ran at all.
      expect(starts).toEqual([]);

      // enter="none" must not opt out of share pairing: a mount matching an
      // exiting explicit name goes through the share phase on both sides.
      await act(() => transition(() => setStep?.("paired")));
      expect(starts).toEqual([
        ["hero-old:hero:hero-share"],
        ["hero-new:hero:hero-share"],
      ]);
      expect(container.textContent).toBe("HeroSolo");
    } finally {
      ownerDocument.startViewTransition = previousStart;
      container.remove();
    }
  });

  it("uses the share phase for named insert/delete pairs", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const snapshots: string[] = [];
    let setShowFirst: StateSetter<boolean> | null = null;
    const ownerDocument = document as unknown as MockViewTransitionDocument;
    const previousStart = ownerDocument.startViewTransition;

    ownerDocument.startViewTransition = (update) => {
      const oldSurface = container.querySelector("#old") as HTMLElement | null;
      snapshots.push(oldSurface?.style.viewTransitionName ?? "");
      snapshots.push(oldSurface?.style.viewTransitionClass ?? "");
      update();
      const newSurface = container.querySelector("#new") as HTMLElement | null;
      snapshots.push(newSurface?.style.viewTransitionName ?? "");
      snapshots.push(newSurface?.style.viewTransitionClass ?? "");
      return { finished: Promise.resolve(), ready: Promise.resolve() };
    };

    function App() {
      const [showFirst, set] = useState(true);
      setShowFirst = set;
      return showFirst
        ? createElement(
            "div",
            null,
            createElement(
              ViewTransition,
              { exit: "none", name: "card", share: "shared" },
              createElement("section", { id: "old" }, "Old"),
            ),
          )
        : createElement(
            "article",
            null,
            createElement(
              ViewTransition,
              { name: "card", share: "shared" },
              createElement("section", { id: "new" }, "New"),
            ),
          );
    }

    try {
      const root = createRoot(container);
      await act(() => root.render(createElement(App, null)));
      await act(() => transition(() => setShowFirst?.(false)));

      expect(snapshots).toEqual(["card", "shared", "card", "shared"]);
      expect(container.textContent).toBe("New");
    } finally {
      ownerDocument.startViewTransition = previousStart;
      container.remove();
    }
  });

  it("lets the innermost boundary own updates (outer update=none must not disable it)", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const snapshots: string[] = [];
    let setLabel: StateSetter<string> | null = null;
    const ownerDocument = document as unknown as MockViewTransitionDocument;
    const previousStart = ownerDocument.startViewTransition;

    ownerDocument.startViewTransition = (update) => {
      update();
      const outer = container.querySelector("#outer") as HTMLElement;
      const inner = container.querySelector("#inner") as HTMLElement;
      snapshots.push(outer.style.viewTransitionName ?? "");
      snapshots.push(inner.style.viewTransitionName ?? "");
      snapshots.push(inner.style.viewTransitionClass ?? "");
      return { finished: Promise.resolve(), ready: Promise.resolve() };
    };

    function App() {
      const [label, set] = useState("First");
      setLabel = set;
      return createElement(
        ViewTransition,
        { name: "outer", update: "none" },
        createElement(
          "article",
          { id: "outer" },
          createElement(
            ViewTransition,
            { name: "inner", update: "inner-update" },
            createElement("section", { id: "inner" }, label),
          ),
        ),
      );
    }

    try {
      const root = createRoot(container);
      await act(() => root.render(createElement(App, null)));
      await act(() => transition(() => setLabel?.("Second")));

      // The inner boundary owns the change; the outer one stays silent both
      // because update is "none" and because nothing changed outside inner.
      expect(snapshots).toEqual(["", "inner", "inner-update"]);
    } finally {
      ownerDocument.startViewTransition = previousStart;
      container.remove();
    }
  });

  it("does not animate an outer boundary when only nested content changed", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const snapshots: string[] = [];
    let setLabel: StateSetter<string> | null = null;
    const ownerDocument = document as unknown as MockViewTransitionDocument;
    const previousStart = ownerDocument.startViewTransition;

    ownerDocument.startViewTransition = (update) => {
      update();
      const outer = container.querySelector("#outer") as HTMLElement;
      const inner = container.querySelector("#inner") as HTMLElement;
      snapshots.push(outer.style.viewTransitionName ?? "");
      snapshots.push(inner.style.viewTransitionName ?? "");
      return { finished: Promise.resolve(), ready: Promise.resolve() };
    };

    function App() {
      const [label, set] = useState("First");
      setLabel = set;
      return createElement(
        ViewTransition,
        { name: "outer", update: "outer-update" },
        createElement(
          "article",
          { id: "outer" },
          createElement(
            ViewTransition,
            { name: "inner" },
            createElement("section", { id: "inner" }, label),
          ),
        ),
      );
    }

    try {
      const root = createRoot(container);
      await act(() => root.render(createElement(App, null)));
      await act(() => transition(() => setLabel?.("Second")));

      expect(snapshots).toEqual(["", "inner"]);
    } finally {
      ownerDocument.startViewTransition = previousStart;
      container.remove();
    }
  });

  it("pairs named boundaries nested inside deleted subtrees", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const snapshots: string[] = [];
    let setShowFirst: StateSetter<boolean> | null = null;
    const ownerDocument = document as unknown as MockViewTransitionDocument;
    const previousStart = ownerDocument.startViewTransition;

    ownerDocument.startViewTransition = (update) => {
      const oldHero = container.querySelector("#old-hero") as HTMLElement;
      snapshots.push(oldHero.style.viewTransitionName ?? "");
      snapshots.push(oldHero.style.viewTransitionClass ?? "");
      update();
      const newHero = container.querySelector("#new-hero") as HTMLElement;
      snapshots.push(newHero.style.viewTransitionName ?? "");
      snapshots.push(newHero.style.viewTransitionClass ?? "");
      return { finished: Promise.resolve(), ready: Promise.resolve() };
    };

    function App() {
      const [showFirst, set] = useState(true);
      setShowFirst = set;
      return showFirst
        ? createElement(
            ViewTransition,
            { key: "page-one", name: "page-one" },
            createElement(
              "div",
              null,
              createElement(
                ViewTransition,
                { name: "hero", share: "hero-share" },
                createElement("section", { id: "old-hero" }, "Hero"),
              ),
            ),
          )
        : createElement(
            ViewTransition,
            { key: "page-two", name: "page-two" },
            createElement(
              "article",
              null,
              createElement(
                ViewTransition,
                { name: "hero", share: "hero-share" },
                createElement("section", { id: "new-hero" }, "Hero"),
              ),
            ),
          );
    }

    try {
      const root = createRoot(container);
      await act(() => root.render(createElement(App, null)));
      await act(() => transition(() => setShowFirst?.(false)));

      expect(snapshots).toEqual(["hero", "hero-share", "hero", "hero-share"]);
    } finally {
      ownerDocument.startViewTransition = previousStart;
      container.remove();
    }
  });

  it("rejects the reserved names none and empty string in dev", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const errors: string[] = [];

    try {
      const root = createRoot(container, {
        onUncaughtError(error) {
          errors.push(error instanceof Error ? error.message : String(error));
        },
      });
      await act(() =>
        root.render(
          createElement(
            ViewTransition,
            { name: "none" },
            createElement("section", null, "Card"),
          ),
        ),
      );

      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain('reserved name "none"');
    } finally {
      container.remove();
    }
  });

  it("warns in dev when two boundaries resolve to one name in a commit", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const warnings: string[] = [];
    let setLabel: StateSetter<string> | null = null;
    const ownerDocument = document as unknown as MockViewTransitionDocument;
    const previousStart = ownerDocument.startViewTransition;
    const originalError = console.error;

    ownerDocument.startViewTransition = (update) => {
      update();
      return { finished: Promise.resolve(), ready: Promise.resolve() };
    };
    console.error = (...args: unknown[]) => {
      warnings.push(args.map(String).join(" "));
    };

    function App() {
      const [label, set] = useState("First");
      setLabel = set;
      return createElement(
        "main",
        null,
        createElement(
          ViewTransition,
          { name: "dup" },
          createElement("section", null, label),
        ),
        createElement(
          ViewTransition,
          { name: "dup" },
          createElement("article", null, label),
        ),
      );
    }

    try {
      const root = createRoot(container);
      await act(() => root.render(createElement(App, null)));
      await act(() => transition(() => setLabel?.("Second")));

      expect(
        warnings.filter((warning) => warning.includes('the name "dup"')),
      ).not.toHaveLength(0);
    } finally {
      console.error = originalError;
      ownerDocument.startViewTransition = previousStart;
      container.remove();
    }
  });

  it("cancels the root snapshot when all changes are inside boundaries", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const rootNames: string[] = [];
    const pseudoAnimations: string[] = [];
    let setLabel: StateSetter<string> | null = null;
    const ownerDocument = document as unknown as MockViewTransitionDocument;
    const previousStart = ownerDocument.startViewTransition;
    const documentElement = document.documentElement as HTMLElement & {
      animate?: unknown;
    };
    const previousAnimate = documentElement.animate;

    documentElement.animate = ((
      _keyframes: unknown,
      options: { pseudoElement?: string },
    ) => {
      pseudoAnimations.push(options.pseudoElement ?? "");
    }) as typeof documentElement.animate;

    ownerDocument.startViewTransition = (update) => {
      update();
      rootNames.push(documentElement.style.viewTransitionName || "");
      return { finished: Promise.resolve(), ready: Promise.resolve() };
    };

    function App() {
      const [label, set] = useState("First");
      setLabel = set;
      return createElement(
        ViewTransition,
        { name: "card" },
        createElement("section", null, label),
      );
    }

    try {
      const root = createRoot(container);
      await act(() => root.render(createElement(App, null)));
      await act(() => transition(() => setLabel?.("Second")));

      // Between mutate and the new capture the root opted out...
      expect(rootNames).toEqual(["none"]);
      await Promise.resolve();
      // ...the captured old root group was hidden and the overlay
      // zero-sized so the page stays interactive...
      expect(pseudoAnimations).toEqual([
        "::view-transition-group(root)",
        "::view-transition",
      ]);
      // ...and the author's inline style came back after cleanup.
      expect(documentElement.style.viewTransitionName || "").toBe("");
    } finally {
      ownerDocument.startViewTransition = previousStart;
      documentElement.animate = previousAnimate;
      container.remove();
    }
  });

  it("keeps the root snapshot when changes land outside boundaries", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const rootNames: string[] = [];
    let setLabel: StateSetter<string> | null = null;
    const ownerDocument = document as unknown as MockViewTransitionDocument;
    const previousStart = ownerDocument.startViewTransition;
    const documentElement = document.documentElement as HTMLElement;

    ownerDocument.startViewTransition = (update) => {
      update();
      rootNames.push(documentElement.style.viewTransitionName || "");
      return { finished: Promise.resolve(), ready: Promise.resolve() };
    };

    function App() {
      const [label, set] = useState("First");
      setLabel = set;
      return createElement(
        "main",
        null,
        createElement(
          ViewTransition,
          { name: "card" },
          createElement("section", null, label),
        ),
        createElement("p", null, `outside ${label}`),
      );
    }

    try {
      const root = createRoot(container);
      await act(() => root.render(createElement(App, null)));
      await act(() => transition(() => setLabel?.("Second")));

      // The <p> outside any boundary changed too: the browser must keep the
      // root cross-fade, so the root never opts out.
      expect(rootNames).toEqual([""]);
    } finally {
      ownerDocument.startViewTransition = previousStart;
      container.remove();
    }
  });

  it("serializes transitions per document instead of skipping the running one", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    let setLabel: StateSetter<string> | null = null;
    const updates: string[] = [];
    let releaseFirst: () => void = () => undefined;
    const firstFinished = new Promise<void>((done) => {
      releaseFirst = done;
    });
    const ownerDocument = document as unknown as MockViewTransitionDocument & {
      __figViewTransition?: unknown;
    };
    const previousStart = ownerDocument.startViewTransition;

    ownerDocument.startViewTransition = (update) => {
      const first = updates.length === 0;
      update();
      updates.push(container.textContent ?? "");
      return first
        ? { finished: firstFinished, ready: Promise.resolve() }
        : { finished: Promise.resolve(), ready: Promise.resolve() };
    };

    function App() {
      const [label, set] = useState("First");
      setLabel = set;
      return createElement(
        ViewTransition,
        { name: "card" },
        createElement("section", null, label),
      );
    }

    try {
      const root = createRoot(container);
      await act(() => root.render(createElement(App, null)));
      await act(() => transition(() => setLabel?.("Second")));

      expect(updates).toEqual(["Second"]);

      // The first transition is still animating (finished pending): the next
      // commit must wait for it instead of starting a second transition that
      // would abruptly skip the running one.
      await act(() => transition(() => setLabel?.("Third")));

      expect(updates).toEqual(["Second"]);
      expect(container.textContent).toBe("Second");

      releaseFirst();
      await act(async () => {
        await firstFinished;
        await Promise.resolve();
      });

      expect(updates).toEqual(["Second", "Third"]);
      expect(container.textContent).toBe("Third");
    } finally {
      ownerDocument.startViewTransition = previousStart;
      ownerDocument.__figViewTransition = null;
      container.remove();
    }
  });

  it("routes deferred-commit errors to onUncaughtError", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const errors: string[] = [];
    let setLabel: StateSetter<string> | null = null;
    const ownerDocument = document as unknown as MockViewTransitionDocument;
    const previousStart = ownerDocument.startViewTransition;

    // An async update callback forces the deferred commit path: the commit
    // body runs inside the browser's callback, outside any performRoot frame.
    ownerDocument.startViewTransition = (update) => {
      queueMicrotask(update);
      return { finished: Promise.resolve(), ready: Promise.resolve() };
    };

    function App() {
      const [label, set] = useState("First");
      setLabel = set;
      useBeforePaint(() => {
        if (label === "Second") throw new Error("commit boom");
      }, [label]);
      return createElement(
        ViewTransition,
        { name: "card" },
        createElement("section", null, label),
      );
    }

    try {
      const root = createRoot(container, {
        onUncaughtError(error) {
          errors.push(error instanceof Error ? error.message : String(error));
        },
      });
      await act(() => root.render(createElement(App, null)));
      await act(() => transition(() => setLabel?.("Second")));

      expect(errors).toEqual(["commit boom"]);
      // The uncaught-error path cleared the committed UI, exactly like a
      // synchronous commit failure would.
      expect(container.textContent).toBe("");
    } finally {
      ownerDocument.startViewTransition = previousStart;
      container.remove();
    }
  });

  it("does not collect exits for kept siblings of a deletion", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const snapshots: string[] = [];
    let setShowGone: StateSetter<boolean> | null = null;
    const ownerDocument = document as unknown as MockViewTransitionDocument;
    const previousStart = ownerDocument.startViewTransition;

    ownerDocument.startViewTransition = (update) => {
      const gone = container.querySelector("#gone") as HTMLElement;
      const stays = container.querySelector("#stays") as HTMLElement;
      snapshots.push(gone.style.viewTransitionName || "");
      snapshots.push(stays.style.viewTransitionName || "");
      update();
      return { finished: Promise.resolve(), ready: Promise.resolve() };
    };

    function App() {
      const [showGone, set] = useState(true);
      setShowGone = set;
      return createElement(
        "main",
        null,
        showGone
          ? createElement(
              ViewTransition,
              { key: "gone", exit: "fade", name: "vt-gone" },
              createElement("section", { id: "gone" }, "Gone"),
            )
          : null,
        createElement(
          ViewTransition,
          { key: "stays", name: "vt-stays" },
          createElement("section", { id: "stays" }, "Stays"),
        ),
      );
    }

    try {
      const root = createRoot(container);
      await act(() => root.render(createElement(App, null)));
      await act(() => transition(() => setShowGone?.(false)));

      // The deleted boundary exits; its kept sibling must not be dragged
      // into the old capture through stale sibling pointers.
      expect(snapshots).toEqual(["vt-gone", ""]);
      expect(container.textContent).toBe("Stays");
    } finally {
      ownerDocument.startViewTransition = previousStart;
      container.remove();
    }
  });

  it("morphs moved boundaries by naming both the old and new capture", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const snapshots: string[][] = [];
    let setOrder: StateSetter<"ab" | "ba"> | null = null;
    const ownerDocument = document as unknown as MockViewTransitionDocument;
    const previousStart = ownerDocument.startViewTransition;

    const namedSurfaces = (): string[] =>
      Array.from(container.querySelectorAll<HTMLElement>("section"))
        .filter((element) => Boolean(element.style.viewTransitionName))
        .map((element) => `${element.id}:${element.style.viewTransitionName}`)
        .sort();

    ownerDocument.startViewTransition = (update) => {
      snapshots.push(namedSurfaces());
      update();
      snapshots.push(namedSurfaces());
      return { finished: Promise.resolve(), ready: Promise.resolve() };
    };

    function App() {
      const [order, set] = useState<"ab" | "ba">("ab");
      setOrder = set;
      const cards =
        order === "ab" ? (["a", "b"] as const) : (["b", "a"] as const);
      return createElement(
        "main",
        null,
        ...cards.map((id) =>
          createElement(
            ViewTransition,
            { key: id, name: `card-${id}` },
            createElement("section", { id }, id.toUpperCase()),
          ),
        ),
      );
    }

    try {
      const root = createRoot(container);
      await act(() => root.render(createElement(App, null)));
      await act(() => transition(() => setOrder?.("ba")));

      expect(snapshots).toHaveLength(2);
      const [before, after] = snapshots;
      // The DOM-moved boundary is named in BOTH captures so the browser
      // pairs old and new position (a morph), not an enter-only fade.
      expect(before.length).toBeGreaterThan(0);
      expect(after).toEqual(before);
      expect(container.textContent).toBe("BA");
    } finally {
      ownerDocument.startViewTransition = previousStart;
      container.remove();
    }
  });

  it("keeps unrelated explicit names that share a prefix", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const snapshots: string[] = [];
    let setShowFirst: StateSetter<boolean> | null = null;
    const ownerDocument = document as unknown as MockViewTransitionDocument;
    const previousStart = ownerDocument.startViewTransition;

    ownerDocument.startViewTransition = (update) => {
      const prefixSurface = container.querySelector(
        "#prefix",
      ) as HTMLElement | null;
      const oldSurface = container.querySelector(
        "#old-card",
      ) as HTMLElement | null;
      snapshots.push(prefixSurface?.style.viewTransitionName ?? "");
      snapshots.push(prefixSurface?.style.viewTransitionClass ?? "");
      snapshots.push(oldSurface?.style.viewTransitionName ?? "");
      snapshots.push(oldSurface?.style.viewTransitionClass ?? "");
      update();
      const newSurface = container.querySelector(
        "#new-card",
      ) as HTMLElement | null;
      snapshots.push(newSurface?.style.viewTransitionName ?? "");
      snapshots.push(newSurface?.style.viewTransitionClass ?? "");
      return { finished: Promise.resolve(), ready: Promise.resolve() };
    };

    function App() {
      const [showFirst, set] = useState(true);
      setShowFirst = set;
      return showFirst
        ? createElement(
            "main",
            null,
            createElement(
              ViewTransition,
              { exit: "fade", key: "prefix", name: "card_1" },
              createElement("section", { id: "prefix" }, "Prefix"),
            ),
            createElement(
              ViewTransition,
              {
                key: "old-card",
                name: "card",
                share: "shared",
              },
              createElement("section", { id: "old-card" }, "Old"),
            ),
          )
        : createElement(
            "main",
            null,
            createElement(
              ViewTransition,
              {
                key: "new-card",
                name: "card",
                share: "shared",
              },
              createElement("section", { id: "new-card" }, "New"),
            ),
          );
    }

    try {
      const root = createRoot(container);
      await act(() => root.render(createElement(App, null)));
      await act(() => transition(() => setShowFirst?.(false)));

      expect(snapshots).toEqual([
        "card_1",
        "fade",
        "card",
        "shared",
        "card",
        "shared",
      ]);
      expect(container.textContent).toBe("New");
    } finally {
      ownerDocument.startViewTransition = previousStart;
      container.remove();
    }
  });

  it("collects boundaries inside bailed-out (memoized) moved subtrees", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const snapshots: string[] = [];
    let setOrder: StateSetter<"ab" | "ba"> | null = null;
    const ownerDocument = document as unknown as MockViewTransitionDocument;
    const previousStart = ownerDocument.startViewTransition;

    ownerDocument.startViewTransition = (update) => {
      update();
      for (const id of ["card-a", "card-b"]) {
        const surface = container.querySelector(`#${id}`) as HTMLElement;
        snapshots.push(surface.style.viewTransitionName ?? "");
      }
      return { finished: Promise.resolve(), ready: Promise.resolve() };
    };

    // Stable element identities: the moved wrappers bail out and adopt their
    // committed children, so the boundaries are only reachable through
    // persisted static flags.
    const cardA = createElement(
      "div",
      { key: "a" },
      createElement(
        ViewTransition,
        { name: "vt-card-a" },
        createElement("section", { id: "card-a" }, "A"),
      ),
    );
    const cardB = createElement(
      "div",
      { key: "b" },
      createElement(
        ViewTransition,
        { name: "vt-card-b" },
        createElement("section", { id: "card-b" }, "B"),
      ),
    );

    function App() {
      const [order, set] = useState<"ab" | "ba">("ab");
      setOrder = set;
      return createElement(
        "main",
        null,
        ...(order === "ab" ? [cardA, cardB] : [cardB, cardA]),
      );
    }

    try {
      const root = createRoot(container);
      await act(() => root.render(createElement(App, null)));
      await act(() => transition(() => setOrder?.("ba")));

      expect(snapshots).toEqual(["vt-card-a", "vt-card-b"]);
      expect(container.textContent).toBe("BA");
    } finally {
      ownerDocument.startViewTransition = previousStart;
      container.remove();
    }
  });

  it("restores updated author styles after transition cleanup", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    let setVariant: StateSetter<"first" | "second"> | null = null;
    const ownerDocument = document as unknown as MockViewTransitionDocument;
    const previousStart = ownerDocument.startViewTransition;

    ownerDocument.startViewTransition = (update) => {
      update();
      return { finished: Promise.resolve(), ready: Promise.resolve() };
    };

    function App() {
      const [variant, set] = useState<"first" | "second">("first");
      setVariant = set;
      return createElement(
        ViewTransition,
        { name: "card", update: "fade" },
        createElement(
          "section",
          {
            style: {
              viewTransitionClass:
                variant === "first" ? "author-a" : "author-b",
              viewTransitionName: variant === "first" ? "author-a" : "author-b",
            },
          },
          variant,
        ),
      );
    }

    try {
      const root = createRoot(container);
      await act(() => root.render(createElement(App, null)));
      expect(surfaceStyle(container).viewTransitionName).toBe("author-a");
      expect(surfaceStyle(container).viewTransitionClass).toBe("author-a");

      await act(() => transition(() => setVariant?.("second")));
      await Promise.resolve();

      expect(surfaceStyle(container).viewTransitionName).toBe("author-b");
      expect(surfaceStyle(container).viewTransitionClass).toBe("author-b");
      expect(container.textContent).toBe("second");
    } finally {
      ownerDocument.startViewTransition = previousStart;
      container.remove();
    }
  });

  it("preserves transition priority for external store updates", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const snapshots: string[] = [];
    const listeners = new Set<() => void>();
    let value = "First";
    const ownerDocument = document as unknown as MockViewTransitionDocument;
    const previousStart = ownerDocument.startViewTransition;

    ownerDocument.startViewTransition = (update) => {
      snapshots.push(surfaceStyle(container).viewTransitionName ?? "");
      snapshots.push(surfaceStyle(container).viewTransitionClass ?? "");
      update();
      snapshots.push(surfaceStyle(container).viewTransitionName ?? "");
      snapshots.push(surfaceStyle(container).viewTransitionClass ?? "");
      return { finished: Promise.resolve(), ready: Promise.resolve() };
    };

    function notify() {
      for (const listener of listeners) listener();
    }

    function App() {
      const label = useSyncExternalStore(
        (listener) => {
          listeners.add(listener);
          return () => {
            listeners.delete(listener);
          };
        },
        () => value,
        () => value,
      );
      return createElement(
        ViewTransition,
        { default: "fade", name: "card" },
        createElement("section", null, label),
      );
    }

    try {
      const root = createRoot(container);
      await act(() => root.render(createElement(App, null)));
      await act(() => {
        value = "Sync";
        notify();
      });

      expect(snapshots).toEqual([]);

      await act(() =>
        transition(() => {
          value = "Transition";
          notify();
        }),
      );

      expect(snapshots).toEqual(["card", "fade", "card", "fade"]);
      expect(container.textContent).toBe("Transition");
    } finally {
      ownerDocument.startViewTransition = previousStart;
      container.remove();
    }
  });
});

function surfaceStyle(container: Element): CSSStyleDeclaration & {
  viewTransitionClass?: string;
  viewTransitionName?: string;
} {
  const surface = container.firstElementChild;
  if (surface === null) throw new Error("Expected a surface element.");
  return (surface as HTMLElement).style;
}
