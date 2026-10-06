import { createElement } from "@bgub/fig";
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
      ): void;
      reverse(): void;
      nativeMoves(): number;
    };
  }
}

window.focusFixture = {
  mount(kind, ancestor, fallback) {
    const root = createRoot(document.getElementById("root")!);
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
    const render = (keys: string[]) =>
      root.render(
        createElement(
          "div",
          { id: "list" },
          keys.map((key) =>
            key === "other"
              ? createElement(
                  "button",
                  { key, id: "other", "data-key": key },
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
    flushSync(() => render(["moved", "other"]));
    const parent = document.getElementById("list")!;
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
  },
  reverse() {},
  nativeMoves: () => 0,
};
