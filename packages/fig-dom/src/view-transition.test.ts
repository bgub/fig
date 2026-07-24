// @vitest-environment happy-dom
// @vitest-environment-options { "settings": { "disableCSSFileLoading": true } }
import {
  createElement,
  readPromise,
  Suspense,
  transition,
  useTransition,
  useBeforePaint,
  useSyncExternalStore,
  useState,
  ViewTransition,
  type StateSetter,
  type StartTransition,
  type ViewTransitionEvent,
} from "@bgub/fig";
import { describe, expect, it, vi } from "vitest";
import { act } from "./act.ts";
import { createRoot, hydrateRoot } from "./index.ts";
import {
  enableViewTransitions,
  getViewTransitionPseudoElements,
} from "./view-transitions.ts";

enableViewTransitions();

interface MockViewTransitionDocument {
  startViewTransition?: (update: () => void) => {
    finished: Promise<unknown>;
    ready: Promise<unknown>;
  };
}

type MockViewTransitionInput =
  | (() => void)
  | { update: () => void; types: string[] };

// happy-dom has no layout: getBoundingClientRect returns zeros, so the
// measurement pass would cancel every move. Give elements document-order
// positions (recomputed per call) so reorders read as real moves.
function stubDomOrderRects(container: HTMLElement, selector: string): void {
  for (const element of Array.from(
    container.querySelectorAll<HTMLElement>(selector),
  )) {
    element.getBoundingClientRect = () => {
      const ordered = Array.from(container.querySelectorAll(selector));
      const y = ordered.indexOf(element) * 100;
      return {
        bottom: y + 50,
        height: 50,
        left: 0,
        right: 100,
        top: y,
        width: 100,
        x: 0,
        y,
        toJSON: () => ({}),
      } as DOMRect;
    };
  }
}

describe("ViewTransition", () => {
  it("passes unioned types to the browser and scopes lifecycle surfaces to the animation", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    let setLabel: StateSetter<string> | null = null;
    let startTransition: StartTransition | null = null;
    let resolveReady = (): void => undefined;
    let resolveFinished = (): void => undefined;
    const ready = new Promise<void>((resolve) => {
      resolveReady = resolve;
    });
    const finished = new Promise<void>((resolve) => {
      resolveFinished = resolve;
    });
    const events: ViewTransitionEvent[] = [];
    const signals: AbortSignal[] = [];
    const nativeInputs: MockViewTransitionInput[] = [];
    const animations: KeyframeAnimationOptions[] = [];
    const ownerDocument = document as unknown as MockViewTransitionDocument;
    const previousStart = ownerDocument.startViewTransition;
    const rootElement = document.documentElement;
    const previousAnimate = Object.getOwnPropertyDescriptor(
      rootElement,
      "animate",
    );

    rootElement.animate = ((_keyframes, options) => {
      animations.push(options as KeyframeAnimationOptions);
      return {} as Animation;
    }) as typeof rootElement.animate;
    ownerDocument.startViewTransition = ((input: MockViewTransitionInput) => {
      nativeInputs.push(input);
      const update = typeof input === "function" ? input : input.update;
      update();
      return { finished, ready };
    }) as MockViewTransitionDocument["startViewTransition"];

    function App() {
      const [label, set] = useState("First");
      const [, start] = useTransition();
      setLabel = set;
      startTransition = start;
      return createElement(
        ViewTransition,
        {
          name: "card",
          onTransition(event: ViewTransitionEvent, signal: AbortSignal) {
            events.push(event);
            signals.push(signal);
            getViewTransitionPseudoElements(event.surfaces[0]).new?.animate(
              { opacity: [0, 1] },
              120,
            );
          },
        },
        createElement("section", null, label),
        createElement("aside", null, "Metadata"),
      );
    }

    try {
      const root = createRoot(container);
      await act(() => root.render(createElement(App, null)));
      await act(() =>
        transition(
          () =>
            transition(() => setLabel?.("Second"), {
              types: ["forward", "navigation"],
            }),
          { types: ["navigation"] },
        ),
      );

      expect(nativeInputs).toHaveLength(1);
      expect(nativeInputs[0]).toMatchObject({
        types: ["navigation", "forward"],
      });
      expect(events).toEqual([]);

      resolveReady();
      await Promise.resolve();
      await Promise.resolve();

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        phase: "update",
        types: ["navigation", "forward"],
      });
      expect(events[0].surfaces.map((surface) => surface.name)).toEqual([
        "card",
        "card_1",
      ]);
      expect(signals[0].aborted).toBe(false);
      expect(animations).toContainEqual({
        duration: 120,
        pseudoElement: "::view-transition-new(card)",
      });

      const pseudos = getViewTransitionPseudoElements(events[0].surfaces[0]);
      expect(pseudos.group.selector).toBe("::view-transition-group(card)");
      expect(pseudos.imagePair.selector).toBe(
        "::view-transition-image-pair(card)",
      );
      expect(pseudos.old?.selector).toBe("::view-transition-old(card)");
      expect(pseudos.new?.selector).toBe("::view-transition-new(card)");

      resolveFinished();
      await Promise.resolve();
      await Promise.resolve();
      expect(signals[0].aborted).toBe(true);

      await act(() =>
        startTransition?.(() => setLabel?.("Third"), { types: ["refresh"] }),
      );
      expect(nativeInputs[1]).toMatchObject({ types: ["refresh"] });
    } finally {
      resolveReady();
      resolveFinished();
      await Promise.resolve();
      await Promise.resolve();
      ownerDocument.startViewTransition = previousStart;
      if (previousAnimate === undefined) {
        Reflect.deleteProperty(rootElement, "animate");
      } else {
        Object.defineProperty(rootElement, "animate", previousAnimate);
      }
      container.remove();
    }
  });

  it("reports enter, share, and exit from the boundary that owns each phase", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    let setStep: StateSetter<number> | null = null;
    const phases: Array<{
      label: string;
      new: boolean;
      old: boolean;
      phase: ViewTransitionEvent["phase"];
    }> = [];
    const signals: AbortSignal[] = [];
    const ownerDocument = document as unknown as MockViewTransitionDocument;
    const previousStart = ownerDocument.startViewTransition;

    ownerDocument.startViewTransition = (update) => {
      update();
      return { finished: Promise.resolve(), ready: Promise.resolve() };
    };

    function App() {
      const [step, set] = useState(0);
      setStep = set;
      if (step === 0 || step === 3) return null;

      const label = step === 1 ? "old" : "new";
      return createElement(
        ViewTransition,
        {
          key: label,
          name: "hero",
          onTransition(event: ViewTransitionEvent, signal: AbortSignal) {
            const pseudos = getViewTransitionPseudoElements(event.surfaces[0]);
            phases.push({
              label,
              new: pseudos.new !== null,
              old: pseudos.old !== null,
              phase: event.phase,
            });
            signals.push(signal);
          },
        },
        createElement("article", null, label),
      );
    }

    try {
      const root = createRoot(container);
      await act(() => root.render(createElement(App, null)));
      await act(() => transition(() => setStep?.(1)));
      await Promise.resolve();
      await act(() => transition(() => setStep?.(2)));
      await Promise.resolve();
      await act(() => transition(() => setStep?.(3)));
      await Promise.resolve();

      expect(phases).toEqual([
        { label: "old", new: true, old: false, phase: "enter" },
        { label: "new", new: true, old: true, phase: "share" },
        { label: "new", new: false, old: true, phase: "exit" },
      ]);
      expect(signals.every((signal) => signal.aborted)).toBe(true);
    } finally {
      ownerDocument.startViewTransition = previousStart;
      container.remove();
    }
  });

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

  it("falls back when the browser rejects a transition before mutation", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const errors: string[] = [];
    let setLabel: StateSetter<string> | null = null;
    let starts = 0;
    const ownerDocument = document as unknown as MockViewTransitionDocument;
    const previousStart = ownerDocument.startViewTransition;

    ownerDocument.startViewTransition = () => {
      starts += 1;
      throw new Error("transition unavailable");
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
      const root = createRoot(container, {
        onUncaughtError(error) {
          errors.push(error instanceof Error ? error.message : String(error));
        },
      });
      await act(() => root.render(createElement(App, null)));
      await act(() => transition(() => setLabel?.("Second")));

      expect(starts).toBe(1);
      expect(errors).toEqual([]);
      expect(container.textContent).toBe("Second");
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
      // The solo sibling is optimistically named in the old capture (the
      // swap may shift it) and canceled by measurement before the new one.
      await act(() => transition(() => setStep?.("paired")));
      expect(starts).toEqual([
        ["hero-old:hero:hero-share", "solo:solo-card:"],
        ["hero-new:hero:hero-share"],
      ]);
      expect(container.textContent).toBe("HeroSolo");
    } finally {
      ownerDocument.startViewTransition = previousStart;
      container.remove();
    }
  });

  it("does not re-enter a bailed-out boundary on unrelated commits", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const starts: string[][] = [];
    let setLabel: StateSetter<string> | null = null;
    const ownerDocument = document as unknown as MockViewTransitionDocument;
    const previousStart = ownerDocument.startViewTransition;

    const namedSurfaces = (): string[] =>
      Array.from(container.querySelectorAll<HTMLElement>("section"))
        .filter((element) => Boolean(element.style.viewTransitionName))
        .map((element) => `${element.id}:${element.style.viewTransitionName}`)
        .sort();

    ownerDocument.startViewTransition = (update) => {
      const before = namedSurfaces();
      update();
      starts.push(before, namedSurfaces());
      return { finished: Promise.resolve(), ready: Promise.resolve() };
    };

    function Stable() {
      return createElement(
        ViewTransition,
        { default: "fade", name: "stable-card" },
        createElement("section", { id: "stable" }, "Stable"),
      );
    }

    // A stable element identity makes the subtree bail out on every later
    // render: with in-place reuse its fibers never gain an alternate, and a
    // missing alternate must not read as "mounted this commit".
    const stable = createElement(Stable, null);

    function App() {
      const [label, set] = useState("First");
      setLabel = set;
      return createElement(
        "main",
        null,
        createElement(
          ViewTransition,
          { default: "fade", name: "live-card" },
          createElement("section", { id: "live" }, label),
        ),
        stable,
      );
    }

    try {
      const root = createRoot(container);
      await act(() => root.render(createElement(App, null)));

      await act(() => transition(() => setLabel?.("Next")));

      // Only the boundary whose content changed participates; the bailed-out
      // sibling neither enters again nor gets named.
      expect(starts).toEqual([["live:live-card"], ["live:live-card"]]);
      expect(container.textContent).toBe("NextStable");
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

  it("updates boundaries whose ancestor layout changed around them", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const snapshots: string[] = [];
    let setDense: StateSetter<boolean> | null = null;
    const ownerDocument = document as unknown as MockViewTransitionDocument;
    const previousStart = ownerDocument.startViewTransition;

    ownerDocument.startViewTransition = (update) => {
      const card = container.querySelector("#card") as HTMLElement;
      snapshots.push(card.style.viewTransitionName || "");
      update();
      snapshots.push(card.style.viewTransitionName || "");
      return { finished: Promise.resolve(), ready: Promise.resolve() };
    };

    function App() {
      const [dense, set] = useState(false);
      setDense = set;
      // The card's own subtree never changes; only the container's class
      // does. The layout change moves the card, so it must still be named
      // in both captures (an update morph), like React's nested-boundary
      // measurement pass.
      return createElement(
        "main",
        { class: dense ? "gap-2" : "gap-3" },
        createElement(
          ViewTransition,
          { name: "card" },
          createElement("section", { id: "card" }, "Card"),
        ),
      );
    }

    try {
      const root = createRoot(container);
      await act(() => root.render(createElement(App, null)));
      // Layout follows the container's gap class: the card sits higher when
      // dense. Measurement must see the ancestor-driven move.
      const card = container.querySelector("#card") as HTMLElement;
      const main = container.querySelector("main") as HTMLElement;
      card.getBoundingClientRect = () => {
        const y = main.className === "gap-2" ? 8 : 12;
        return {
          bottom: y + 50,
          height: 50,
          left: 0,
          right: 100,
          top: y,
          width: 100,
          x: 0,
          y,
          toJSON: () => ({}),
        } as DOMRect;
      };
      await act(() => transition(() => setDense?.(true)));

      expect(snapshots).toEqual(["card", "card"]);
    } finally {
      ownerDocument.startViewTransition = previousStart;
      container.remove();
    }
  });

  it("hides canceled groups at ready and keeps moved ones", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const snapshots: string[][] = [];
    const pseudoAnimations: string[] = [];
    let setShifted: StateSetter<boolean> | null = null;
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

    const namedSurfaces = (): string[] =>
      Array.from(container.querySelectorAll<HTMLElement>("section"))
        .filter((element) => Boolean(element.style.viewTransitionName))
        .map((element) => element.id)
        .sort();

    ownerDocument.startViewTransition = (update) => {
      const before = namedSurfaces();
      update();
      snapshots.push(before, namedSurfaces());
      return { finished: Promise.resolve(), ready: Promise.resolve() };
    };

    function App() {
      const [shifted, set] = useState(false);
      setShifted = set;
      return createElement(
        "main",
        { class: shifted ? "shifted" : "" },
        createElement(
          ViewTransition,
          { name: "mover" },
          createElement("section", { id: "mover" }, "Mover"),
        ),
        createElement(
          ViewTransition,
          { name: "still" },
          createElement("section", { id: "still" }, "Still"),
        ),
      );
    }

    const rectAt = (y: number): DOMRect =>
      ({
        bottom: y + 50,
        height: 50,
        left: 0,
        right: 100,
        top: y,
        width: 100,
        x: 0,
        y,
        toJSON: () => ({}),
      }) as DOMRect;

    try {
      const root = createRoot(container);
      await act(() => root.render(createElement(App, null)));
      const main = container.querySelector("main") as HTMLElement;
      const mover = container.querySelector("#mover") as HTMLElement;
      const still = container.querySelector("#still") as HTMLElement;
      mover.getBoundingClientRect = () =>
        rectAt(main.className === "shifted" ? 100 : 0);
      still.getBoundingClientRect = () => rectAt(200);

      await act(() => transition(() => setShifted?.(true)));

      // Both were optimistically named in the old capture; only the mover
      // survived measurement into the new one.
      expect(snapshots).toEqual([["mover", "still"], ["mover"]]);
      await Promise.resolve();
      // The still boundary's already-captured old group is hidden at ready
      // (its old snapshot cannot be un-captured). The root snapshot stays:
      // the class change on <main> is a mutation outside any boundary.
      expect(pseudoAnimations).toEqual(["::view-transition-group(still)"]);
    } finally {
      ownerDocument.startViewTransition = previousStart;
      documentElement.animate = previousAnimate;
      container.remove();
    }
  });

  it("skips enters outside the viewport", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const snapshots: string[] = [];
    let setShowCard: StateSetter<boolean> | null = null;
    const ownerDocument = document as unknown as MockViewTransitionDocument;
    const previousStart = ownerDocument.startViewTransition;

    ownerDocument.startViewTransition = (update) => {
      update();
      const card = container.querySelector("#card") as HTMLElement;
      snapshots.push(card.style.viewTransitionName || "");
      return { finished: Promise.resolve(), ready: Promise.resolve() };
    };

    // The entering instance only exists mid-mutation, so its measurement
    // stub must sit on the prototype to be visible when the reconciler
    // measures it inside the update callback.
    const elementPrototype = Element.prototype as {
      getBoundingClientRect: () => DOMRect;
    };
    const originalGetRect = elementPrototype.getBoundingClientRect;
    elementPrototype.getBoundingClientRect = function (this: Element) {
      if ((this as HTMLElement).id !== "card") {
        return originalGetRect.call(this);
      }
      return {
        bottom: 5050,
        height: 50,
        left: 0,
        right: 100,
        top: 5000,
        width: 100,
        x: 0,
        y: 5000,
        toJSON: () => ({}),
      } as DOMRect;
    };

    function App() {
      const [showCard, set] = useState(false);
      setShowCard = set;
      return createElement(
        "main",
        null,
        createElement("p", null, showCard ? "with card" : "without card"),
        showCard
          ? createElement(
              ViewTransition,
              { enter: "reveal", name: "card" },
              createElement("section", { id: "card" }, "Card"),
            )
          : null,
      );
    }

    try {
      const root = createRoot(container);
      await act(() => root.render(createElement(App, null)));
      await act(() => transition(() => setShowCard?.(true)));

      // The transition ran (outside content changed too), but the offscreen
      // enter never received a name.
      expect(snapshots).toEqual([""]);
      expect(container.textContent).toBe("with cardCard");
    } finally {
      elementPrototype.getBoundingClientRect = originalGetRect;
      ownerDocument.startViewTransition = previousStart;
      container.remove();
    }
  });

  it("keeps the root snapshot when a contained update resizes its surface", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const rootNames: string[] = [];
    let setTall: StateSetter<boolean> | null = null;
    const ownerDocument = document as unknown as MockViewTransitionDocument;
    const previousStart = ownerDocument.startViewTransition;
    const documentElement = document.documentElement as HTMLElement;

    ownerDocument.startViewTransition = (update) => {
      update();
      rootNames.push(documentElement.style.viewTransitionName || "");
      return { finished: Promise.resolve(), ready: Promise.resolve() };
    };

    function App() {
      const [tall, set] = useState(false);
      setTall = set;
      return createElement(
        ViewTransition,
        { name: "card" },
        createElement("section", { id: "card" }, tall ? "Tall" : "Short"),
      );
    }

    try {
      const root = createRoot(container);
      await act(() => root.render(createElement(App, null)));
      const card = container.querySelector("#card") as HTMLElement;
      card.getBoundingClientRect = () => {
        const height = card.textContent === "Tall" ? 100 : 50;
        return {
          bottom: height,
          height,
          left: 0,
          right: 100,
          top: 0,
          width: 100,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        } as DOMRect;
      };

      await act(() => transition(() => setTall?.(true)));

      // The change is contained, but the boundary grew: statically
      // positioned surfaces relayout their parent, so unannotated siblings
      // shift and the root cross-fade must stay (React's
      // AffectedParentLayout).
      expect(rootNames).toEqual([""]);
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

  it("does not animate the first re-render of hydrated single-text content", async () => {
    const container = document.createElement("div");
    container.innerHTML = "<main><p>0</p><section>Static</section></main>";
    document.body.append(container);
    const starts: string[][] = [];
    let setCount: StateSetter<number> | null = null;
    const ownerDocument = document as unknown as MockViewTransitionDocument;
    const previousStart = ownerDocument.startViewTransition;

    ownerDocument.startViewTransition = (update) => {
      const section = container.querySelector("section") as HTMLElement;
      const before = section.style.viewTransitionName || "";
      update();
      starts.push([before, section.style.viewTransitionName || ""]);
      return { finished: Promise.resolve(), ready: Promise.resolve() };
    };

    function App() {
      const [count, set] = useState(0);
      setCount = set;
      return createElement(
        "main",
        null,
        createElement("p", null, String(count)),
        createElement(
          ViewTransition,
          { name: "card" },
          createElement("section", null, "Static"),
        ),
      );
    }

    try {
      await act(() => hydrateRoot(container, createElement(App, null)));

      // The boundary's content is untouched; only the sibling <p> changes.
      // Hydration adopted the section's text as a child fiber — collapsing
      // that shape here used to read as a content mutation and animate a
      // no-op morph on the first post-hydration commit.
      await act(() => transition(() => setCount?.(1)));

      expect(starts).toEqual([]);
      expect(container.textContent).toBe("1Static");
    } finally {
      ownerDocument.startViewTransition = previousStart;
      container.remove();
    }
  });

  it("updates hydrated single-text content through its kept text fiber", async () => {
    const container = document.createElement("div");
    container.innerHTML = "<section>First</section>";
    document.body.append(container);
    let setLabel: StateSetter<string> | null = null;

    function App() {
      const [label, set] = useState("First");
      setLabel = set;
      return createElement("section", null, label);
    }

    try {
      await act(() => hydrateRoot(container, createElement(App, null)));
      const section = container.querySelector("section") as HTMLElement;
      const textNode = section.firstChild;

      await act(() => setLabel?.("Second"));

      expect(container.textContent).toBe("Second");
      // The adopted text node itself was updated, not replaced wholesale.
      expect(section.firstChild).toBe(textNode);
    } finally {
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

  it("keeps the root name canceled until the transition finishes", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    let setLabel: StateSetter<string> | null = null;
    const ownerDocument = document as unknown as MockViewTransitionDocument;
    const previousStart = ownerDocument.startViewTransition;
    const documentElement = document.documentElement as HTMLElement & {
      animate?: unknown;
    };
    const previousAnimate = documentElement.animate;
    const cancelled: string[] = [];

    documentElement.animate = ((
      _keyframes: unknown,
      options: { pseudoElement?: string },
    ) => ({
      cancel: () => cancelled.push(options.pseudoElement ?? ""),
    })) as unknown as typeof documentElement.animate;

    let resolveFinished: () => void = () => undefined;
    const finished = new Promise<void>((done) => {
      resolveFinished = done;
    });

    ownerDocument.startViewTransition = (update) => {
      update();
      return { finished, ready: Promise.resolve() };
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
      await Promise.resolve();

      // Ready resolved but the transition still runs: restoring the root
      // name mid-flight can re-associate the live root with its hidden
      // captured group and blank the page, so the cancel must hold...
      expect(documentElement.style.viewTransitionName).toBe("none");
      expect(cancelled).toEqual([]);

      resolveFinished();
      await Promise.resolve();
      await Promise.resolve();

      // ...and the author's style plus the hide animations release only
      // once the pseudo tree is gone.
      expect(documentElement.style.viewTransitionName || "").toBe("");
      expect(cancelled).toEqual([
        "::view-transition-group(root)",
        "::view-transition",
      ]);
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

  it("keeps rendering during an animation and commits the latest state once", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const renders: string[] = [];
    const commits: string[] = [];
    let setLabel: StateSetter<string> | null = null;
    let releaseFirst: () => void = () => undefined;
    const firstFinished = new Promise<void>((done) => {
      releaseFirst = done;
    });
    const ownerDocument = document as unknown as MockViewTransitionDocument & {
      __figViewTransition?: unknown;
    };
    const previousStart = ownerDocument.startViewTransition;

    ownerDocument.startViewTransition = (update) => {
      const first = commits.length === 0;
      update();
      commits.push(container.textContent ?? "");
      return first
        ? { finished: firstFinished, ready: Promise.resolve() }
        : { finished: Promise.resolve(), ready: Promise.resolve() };
    };

    function App() {
      const [label, set] = useState("A");
      setLabel = set;
      renders.push(label);
      return createElement(
        ViewTransition,
        { name: "card" },
        createElement("section", null, label),
      );
    }

    try {
      const root = createRoot(container);
      await act(() => root.render(createElement(App, null)));
      await act(() => transition(() => setLabel?.("B")));

      expect(commits).toEqual(["B"]);

      // Two more updates while the first transition is still animating.
      // The commits park, but RENDERING must stay live (React's
      // suspend-commits model: only the commit waits, never the work) —
      // the old behavior froze the root and neither C nor D rendered here.
      await act(() => transition(() => setLabel?.("C")));
      await act(() => transition(() => setLabel?.("D")));

      expect(renders).toContain("C");
      expect(renders).toContain("D");
      expect(container.textContent).toBe("B");
      expect(commits).toEqual(["B"]);

      // The animation ends: the LATEST parked state commits in a single
      // transition. C was superseded and never commits (batching, not
      // sequencing — the toast rationale from react#32002).
      releaseFirst();
      await act(async () => {
        await firstFinished;
      });

      expect(commits).toEqual(["B", "D"]);
      expect(container.textContent).toBe("D");
    } finally {
      ownerDocument.startViewTransition = previousStart;
      ownerDocument.__figViewTransition = null;
      container.remove();
    }
  });

  it("commits after 60 seconds when an animation never finishes", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const container = document.createElement("div");
    document.body.append(container);
    let setLabel: StateSetter<string> | null = null;
    const neverFinished = new Promise<void>(() => undefined);
    const ownerDocument = document as unknown as MockViewTransitionDocument & {
      __figViewTransition?: unknown;
    };
    const previousStart = ownerDocument.startViewTransition;
    let started = 0;

    ownerDocument.startViewTransition = (update) => {
      started += 1;
      update();
      return started === 1
        ? { finished: neverFinished, ready: Promise.resolve() }
        : { finished: Promise.resolve(), ready: Promise.resolve() };
    };

    function App() {
      const [label, set] = useState("A");
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
      await act(() => transition(() => setLabel?.("B")));
      await act(() => transition(() => setLabel?.("C")));

      expect(container.textContent).toBe("B");
      await act(() => vi.advanceTimersByTimeAsync(60_000));
      expect(container.textContent).toBe("C");
      expect(started).toBe(2);
    } finally {
      vi.useRealTimers();
      ownerDocument.startViewTransition = previousStart;
      ownerDocument.__figViewTransition = null;
      container.remove();
    }
  });

  it("lets urgent updates commit while a transition commit is parked", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    let setLabel: StateSetter<string> | null = null;
    let setCount: StateSetter<number> | null = null;
    let releaseFirst: () => void = () => undefined;
    const firstFinished = new Promise<void>((done) => {
      releaseFirst = done;
    });
    const ownerDocument = document as unknown as MockViewTransitionDocument & {
      __figViewTransition?: unknown;
    };
    const previousStart = ownerDocument.startViewTransition;

    ownerDocument.startViewTransition = (update) => {
      const first = ownerDocument.__figViewTransition == null;
      update();
      return first
        ? { finished: firstFinished, ready: Promise.resolve() }
        : { finished: Promise.resolve(), ready: Promise.resolve() };
    };

    function App() {
      const [label, setL] = useState("A");
      const [count, setC] = useState(0);
      setLabel = setL;
      setCount = setC;
      return createElement(
        "main",
        null,
        createElement("p", null, String(count)),
        createElement(
          ViewTransition,
          { name: "card" },
          createElement("section", null, label),
        ),
      );
    }

    try {
      const root = createRoot(container);
      await act(() => root.render(createElement(App, null)));
      await act(() => transition(() => setLabel?.("B"))); // animating
      await act(() => transition(() => setLabel?.("C"))); // parked

      expect(container.textContent).toBe("0B");

      // A default-lane update is not view-transition eligible: it must not
      // wait behind the animation (React commits urgent work through too).
      // The parked transition state stays parked and lands afterwards.
      await act(() => setCount?.(1));

      expect(container.textContent).toBe("1B");

      releaseFirst();
      await act(async () => {
        await firstFinished;
      });

      expect(container.textContent).toBe("1C");
    } finally {
      ownerDocument.startViewTransition = previousStart;
      ownerDocument.__figViewTransition = null;
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
      snapshots.push(
        `${stays.style.viewTransitionName || ""}:${
          stays.style.viewTransitionClass || ""
        }`,
      );
      update();
      snapshots.push(stays.style.viewTransitionName || "");
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

      // The deleted boundary exits with its own class. The kept sibling is
      // a layout-driven update candidate (the deletion may shift it), never
      // an exit dragged in through stale sibling pointers — and since
      // measurement shows it did not move, its name is withdrawn before the
      // new capture.
      expect(snapshots).toEqual(["vt-gone", "vt-stays:", ""]);
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
      stubDomOrderRects(container, "section");
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
      stubDomOrderRects(container, "section");
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

  it("deletes hoisted assets cloned across transition commits", async () => {
    // Regression guard for the clone flag mask in createWorkInProgress:
    // hoisted placement is resolved once per fiber, so a clone that drops
    // HoistedStaticFlag sends the deletion through host.removeChild at the
    // fiber position — a NotFoundError in a real DOM, because the instance
    // lives in <head>. The re-render between mount and deletion is what
    // forces the link fiber through the clone path.
    const container = document.createElement("div");
    document.body.append(container);
    let starts = 0;
    let setStep: StateSetter<number> | null = null;
    const ownerDocument = document as unknown as MockViewTransitionDocument;
    const previousStart = ownerDocument.startViewTransition;

    ownerDocument.startViewTransition = (update) => {
      starts += 1;
      update();
      return { finished: Promise.resolve(), ready: Promise.resolve() };
    };

    function App() {
      const [step, set] = useState(0);
      setStep = set;
      return createElement(
        ViewTransition,
        { default: "fade", name: "panel" },
        createElement(
          "section",
          null,
          step < 2
            ? [
                createElement("link", {
                  href: "/panel.css",
                  key: "panel-css",
                  rel: "stylesheet",
                }),
                createElement("p", { key: "label" }, `Panel ${step}`),
              ]
            : "Emptied",
        ),
      );
    }

    try {
      const root = createRoot(container);
      await act(() => root.render(createElement(App, null)));
      expect(
        document.head.querySelectorAll('link[href="/panel.css"]'),
      ).toHaveLength(1);

      await act(() => transition(() => setStep?.(1)));
      await act(() => transition(() => setStep?.(2)));

      expect(starts).toBe(2);
      expect(container.textContent).toBe("Emptied");
      // Stylesheets persist once inserted; the deletion releases the
      // registry share instead of touching the fiber-position parent.
      expect(
        document.head.querySelectorAll('link[href="/panel.css"]'),
      ).toHaveLength(1);
    } finally {
      ownerDocument.startViewTransition = previousStart;
      document.head.querySelector('link[href="/panel.css"]')?.remove();
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
