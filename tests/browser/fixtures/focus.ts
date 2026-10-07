import { Activity, createElement, useBeforePaint } from "@bgub/fig";
import { createRoot, flushSync } from "@bgub/fig-dom";

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
    };
  }
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
};
