import {
  Activity,
  createElement,
  createMixin,
  readPromise,
  Suspense,
  useBeforeLayout,
  useBeforePaint,
} from "@bgub/fig";
import {
  createRoot,
  flushSync,
  hostBinding,
  hydrateRoot,
  on,
  type Bind,
  type FigRoot,
} from "@bgub/fig-dom";

type EditorKind =
  | "input"
  | "textarea"
  | "contenteditable"
  | "dialog"
  | "popover";

declare global {
  interface Window {
    focusFixture: {
      mount(
        kind: EditorKind,
        ancestor: boolean | "custom",
        fallback: boolean,
        container?: Element | ShadowRoot,
      ): void;
      reverse(): void;
      nativeMoves(): number;
      beforePaint: (() => void) | null;
      reorder(keys: string[]): void;
      remove(): void;
      hide(): void;
      mountChildren(fallback: boolean): void;
      updateChildren(keys: string[]): void;
      renderBinding(
        kind: "callback" | "host",
        action: "focus" | "selection" | "blur" | "none",
        hidden?: boolean,
        hydrate?: boolean,
      ): void;
      bindingObservations: string[];
      mountHydrationCommit(
        phase: "bind" | "before-layout" | "before-paint",
        event: "focus" | "click",
      ): void;
      runHydrationCommit(): void;
      hydrationAttempts: number;
      hydrationCalls: string[];
      hydrationErrors: string[];
    };
  }
}

let bindingRoot: FigRoot | undefined;
const bindingOwner = {};
const behavior = createMixin((context, callback: Bind) => ({
  bind: hostBinding(context, bindingOwner, callback),
}));
function BindingApp({
  kind,
  action,
  hidden,
}: {
  kind: "callback" | "host";
  action: "focus" | "selection" | "blur" | "none";
  hidden?: boolean;
}) {
  useBeforePaint(() => {
    window.focusFixture.beforePaint?.();
  });
  const callback: Bind = (node) => {
    const input = node as HTMLInputElement;
    window.focusFixture.bindingObservations.push(
      document.getElementById("binding-output")?.textContent ?? "missing",
    );
    if (action === "focus") input.focus();
    else if (action === "selection") input.setSelectionRange(0, 3);
    else if (action === "blur") input.blur();
  };
  const children = [
    createElement("input", {
      id: "binding-target",
      defaultValue: "Selected text",
      bind: kind === "callback" ? callback : undefined,
      mix: [
        kind === "host" && behavior(callback),
        on("focus", () => {
          window.focusFixture.bindingObservations.push("focus-event");
        }),
      ],
    }),
    createElement("output", { id: "binding-output" }, action),
  ];
  return hidden === undefined
    ? children
    : createElement(
        Activity,
        { mode: hidden ? "hidden" : "visible" },
        children,
      );
}

window.focusFixture = {
  mount(
    kind,
    ancestor,
    fallback,
    container = document.getElementById("root")!,
  ) {
    const root = createRoot(container);
    let moves = 0;
    const editor = () => {
      const props = { id: "editor", key: "moved", "data-key": "moved" };
      switch (kind) {
        case "input":
        case "textarea":
          return createElement(kind, {
            ...props,
            defaultValue: "Selected text",
          });
        case "contenteditable":
          return createElement(
            "div",
            { ...props, contenteditable: "true" },
            "Selected text",
          );
        case "dialog":
          return createElement(
            "dialog",
            props,
            createElement("input", { defaultValue: "Selected text" }),
          );
        case "popover":
          return createElement(
            "div",
            { ...props, popover: "manual", tabindex: 0 },
            "Popover",
          );
      }
    };
    function List({
      keys,
      hidden = false,
    }: {
      keys: string[];
      hidden?: boolean;
    }) {
      useBeforePaint(() => {
        window.focusFixture.beforePaint?.();
      }, [keys, hidden]);
      return createElement(
        Activity,
        { mode: hidden ? "hidden" : "visible" },
        createElement(
          "div",
          { id: "list" },
          keys.map((key) =>
            key !== "moved"
              ? createElement(
                  "button",
                  { key, id: key, "data-key": key },
                  "Other",
                )
              : ancestor
                ? createElement(
                    ancestor === "custom" ? "move-editor" : "section",
                    { key, "data-key": key },
                    editor(),
                  )
                : editor(),
          ),
        ),
      );
    }
    const render = (keys: string[], hidden = false) =>
      root.render(createElement(List, { keys, hidden }));
    flushSync(() => render(["moved", "other"]));
    const parent = container.querySelector("#list")!;
    if (fallback) {
      Object.defineProperty(parent, "moveBefore", { value: undefined });
    } else {
      const move = parent.moveBefore.bind(parent);
      parent.moveBefore = (child, before) => {
        moves += 1;
        move(child, before);
      };
    }
    window.focusFixture.reverse = () =>
      flushSync(() => render(["other", "moved"]));
    window.focusFixture.nativeMoves = () => moves;
    window.focusFixture.reorder = (keys) => flushSync(() => render(keys));
    window.focusFixture.remove = () => flushSync(() => render(["other"]));
    window.focusFixture.hide = () =>
      flushSync(() => render(["moved", "other"], true));
  },
  reverse() {},
  nativeMoves: () => 0,
  beforePaint: null,
  reorder() {},
  remove() {},
  hide() {},
  mountChildren(fallback) {
    const root = createRoot(document.getElementById("root")!);
    window.focusFixture.updateChildren = (keys) =>
      flushSync(() =>
        root.render(
          createElement(
            "div",
            { id: "editor", contenteditable: "true" },
            keys.map((key) => createElement("span", { key }, key)),
          ),
        ),
      );
    window.focusFixture.updateChildren(["AA", "BB", "CC"]);
    if (fallback)
      Object.defineProperty(document.getElementById("editor"), "moveBefore", {
        value: undefined,
      });
  },
  updateChildren() {},
  hydrationAttempts: 0,
  hydrationCalls: [],
  hydrationErrors: [],
  runHydrationCommit() {},
  mountHydrationCommit(phase, event) {
    const fixture = window.focusFixture;
    const container = document.getElementById("root")!;
    container.innerHTML =
      '<input><!--fig:suspense:completed--><button id="lazy">Lazy</button><!--/fig:suspense--><output>old</output>';
    let ready = false;
    let fired = false;
    const pending = new Promise<void>(() => {});
    function Deferred() {
      fixture.hydrationAttempts++;
      if (!ready) readPromise(pending);
      return createElement(
        "button",
        {
          id: "lazy",
          mix: on("click", () => {
            fixture.hydrationCalls.push("click");
          }),
        },
        "Lazy",
      );
    }
    const boundary = createElement(
      Suspense,
      { fallback: "waiting" },
      createElement(Deferred),
    );
    function fire() {
      if (fired) return;
      fired = true;
      container.querySelector<HTMLButtonElement>("#lazy")![event]();
      fixture.hydrationCalls.push("after-event");
    }
    function App({ activate = false }: { activate?: boolean }) {
      useBeforeLayout(() => {
        if (activate && phase === "before-layout") fire();
      }, [activate]);
      useBeforePaint(() => {
        if (activate && phase === "before-paint") fire();
        if (activate) fixture.hydrationCalls.push("effect");
      }, [activate]);
      return [
        createElement("input", {
          bind: activate && phase === "bind" ? fire : undefined,
        }),
        boundary,
        createElement("output", null, activate ? "new" : "old"),
      ];
    }
    const root = flushSync(() =>
      hydrateRoot(container, createElement(App), {
        onUncaughtError(error) {
          fixture.hydrationErrors.push(String(error));
        },
        onRecoverableError(error) {
          fixture.hydrationErrors.push(String(error));
        },
      }),
    );
    fixture.runHydrationCommit = () => {
      ready = true;
      flushSync(() => root.render(createElement(App, { activate: true })));
    };
  },
  bindingObservations: [],
  renderBinding(kind, action, hidden, hydrate = false) {
    const node = createElement(BindingApp, { kind, action, hidden });
    const container = document.getElementById("root")!;
    flushSync(() => {
      if (bindingRoot) bindingRoot.render(node);
      else if (hydrate) bindingRoot = hydrateRoot(container, node);
      else {
        bindingRoot = createRoot(container);
        bindingRoot.render(node);
      }
    });
  },
};
