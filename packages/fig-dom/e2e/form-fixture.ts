import { createElement, useBeforePaint, useState } from "@bgub/fig";
import { renderToHtml } from "@bgub/fig-server";
import { flushSync, hydrateRoot, on } from "../src/index.ts";

const uncontrolled = new URL(location.href).searchParams.has("uncontrolled");
const activation = new URL(location.href).searchParams.has("activation");
const rejectCheck = new URL(location.href).searchParams.has("reject");
const cancelClick = new URL(location.href).searchParams.has("cancel");
const nestedClick = new URL(location.href).searchParams.has("nested");
let inputCount = 0;
let changeCount = 0;
let clickCount = 0;
const container = document.getElementById("form")!;

function Form() {
  const [state, setState] = useState({
    text: "Server",
    notes: "Server",
    checked: false,
    choice: "a",
    single: "a",
    multiple: ["a"],
  });
  const [tick, setTick] = useState(0);
  useBeforePaint(() => {
    flushSync(() => setTick(1));
  }, []);
  const field = (
    id: keyof typeof state,
    value: unknown,
    checkable = false,
  ) => ({
    id,
    [checkable
      ? uncontrolled
        ? "defaultChecked"
        : "checked"
      : uncontrolled
        ? "defaultValue"
        : "value"]: value,
    mix: [
      on("input", (event) => {
        if (activation && checkable)
          document.body.dataset.inputCount = String(++inputCount);
        const target = event.target as HTMLInputElement | HTMLSelectElement;
        if (nestedClick && checkable && inputCount === 1)
          target.dispatchEvent(
            new MouseEvent("click", { bubbles: true, cancelable: true }),
          );
        const next = checkable
          ? !rejectCheck && (target as HTMLInputElement).checked
          : id === "multiple"
            ? Array.from(
                (target as HTMLSelectElement).selectedOptions,
                (option) => option.value,
              )
            : target.value;
        if (!uncontrolled) {
          const update = () =>
            setState((previous) => ({ ...previous, [id]: next }));
          if (rejectCheck && checkable) flushSync(update);
          else update();
        }
      }),
      on("change", () => {
        if (activation && checkable)
          document.body.dataset.changeCount = String(++changeCount);
      }),
      on("click", (event) => {
        if (cancelClick && checkable && ++clickCount === 1)
          event.preventDefault();
      }),
    ],
  });
  const optionNodes = () =>
    ["a", "b", "c"].map((value) => createElement("option", { value }, value));
  return createElement(
    "div",
    { "data-tick": tick },
    createElement("input", field("text", state.text)),
    createElement("textarea", field("notes", state.notes)),
    createElement("input", {
      ...field("checked", state.checked, true),
      type: "checkbox",
    }),
    ...["a", "b"].map((value) =>
      createElement("input", {
        type: "radio",
        name: "choice",
        id: `radio-${value}`,
        value,
        [uncontrolled ? "defaultChecked" : "checked"]: state.choice === value,
        mix: on("change", () => {
          if (!uncontrolled)
            setState((previous) => ({ ...previous, choice: value }));
        }),
      }),
    ),
    createElement("select", field("single", state.single), ...optionNodes()),
    createElement(
      "select",
      { ...field("multiple", state.multiple), multiple: true },
      ...optionNodes(),
    ),
    createElement("input", {
      id: "unchanged-range",
      type: "range",
      min: 80,
      max: 100,
      mix: on("input", () => {
        throw new Error("Unchanged range notified");
      }),
    }),
    createElement(
      "select",
      {
        id: "unchanged-options",
        mix: on("input", () => {
          throw new Error("Unchanged selected option notified");
        }),
      },
      createElement("option", { value: "a" }, "a"),
      createElement("option", { value: "b", selected: true }, "b"),
    ),
    createElement("output", { id: "state" }, JSON.stringify(state)),
  );
}

container.innerHTML = await renderToHtml(createElement(Form, null));
document.getElementById("hydrate")!.addEventListener("click", () => {
  if (activation) hydrateRoot(container, createElement(Form, null));
  else flushSync(() => hydrateRoot(container, createElement(Form, null)));
});
document.body.dataset.ready = "true";
