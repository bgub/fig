import { createElement, useBeforePaint, useState } from "@bgub/fig";
import { renderToHtml } from "@bgub/fig-server";
import { adoptFormState, flushSync, hydrateRoot, on } from "../src/index.ts";

const uncontrolled = new URL(location.href).searchParams.has("uncontrolled");
const adoption = !new URL(location.href).searchParams.has("no-adoption");
const activation = new URL(location.href).searchParams.has("activation");
const rejectCheck = new URL(location.href).searchParams.has("reject");
const cancelClick = new URL(location.href).searchParams.has("cancel");
const nestedClick = new URL(location.href).searchParams.has("nested");
const trustedClick = new URL(location.href).searchParams.has("trusted");
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
  const field = (id: keyof typeof state, value: unknown, checkable = false) => {
    const update = (
      target: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
    ) => {
      const next = checkable
        ? !rejectCheck && (target as HTMLInputElement).checked
        : id === "multiple"
          ? Array.from(
              (target as HTMLSelectElement).selectedOptions,
              (option) => option.value,
            )
          : target.value;
      if (!uncontrolled) {
        const apply = () =>
          setState((previous) => ({ ...previous, [id]: next }));
        if (rejectCheck && checkable) flushSync(apply);
        else apply();
      }
    };
    return {
      id,
      [checkable
        ? uncontrolled
          ? "defaultChecked"
          : "checked"
        : uncontrolled
          ? "defaultValue"
          : "value"]: value,
      mix: [
        adoption &&
          adoptFormState((node) => {
            if (checkable)
              document.body.dataset.adoptionCount = String(
                Number(document.body.dataset.adoptionCount ?? 0) + 1,
              );
            update(node);
          }),
        on("input", (event) => {
          if (checkable)
            document.body.dataset.inputCount = String(++inputCount);
          const target = event.target as HTMLInputElement | HTMLSelectElement;
          if (nestedClick && checkable && inputCount === 1)
            target.dispatchEvent(
              new MouseEvent("click", { bubbles: true, cancelable: true }),
            );
          update(target);
        }),
        on("change", () => {
          if (id === "text")
            document.body.dataset.textChangeCount = String(
              Number(document.body.dataset.textChangeCount ?? 0) + 1,
            );
          if (checkable)
            document.body.dataset.changeCount = String(++changeCount);
        }),
        on("click", (event) => {
          if (cancelClick && checkable && ++clickCount === 1) {
            // Re-entrant work must not adopt the tentative click state.
            flushSync(() => setTick(2));
            event.preventDefault();
          }
        }),
      ],
    };
  };
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
        mix: [
          adoption &&
            adoptFormState(() => {
              document.body.dataset.radioAdoptionCount = String(
                Number(document.body.dataset.radioAdoptionCount ?? 0) + 1,
              );
              if (!uncontrolled)
                setState((previous) => ({ ...previous, choice: value }));
            }),
          on("click", (event) => {
            if (cancelClick && value === "b") {
              flushSync(() => setTick(2));
              event.preventDefault();
            }
          }),
          on("change", () => {
            if (!uncontrolled)
              setState((previous) => ({ ...previous, choice: value }));
          }),
        ],
      }),
    ),
    createElement("select", field("single", state.single), ...optionNodes()),
    createElement(
      "select",
      { ...field("multiple", state.multiple), multiple: true },
      ...optionNodes(),
    ),
    createElement(
      "textarea",
      {
        id: "unchanged-children",
        mix: [
          adoptFormState(() => {
            throw new Error("Unchanged textarea adopted");
          }),
          on("input", () => {
            throw new Error("Unchanged textarea input");
          }),
          on("change", () => {
            throw new Error("Unchanged textarea change");
          }),
        ],
      },
      "Server",
    ),
    createElement("input", {
      id: "unchanged-email",
      type: "email",
      multiple: true,
      value: "a@example.com, b@example.com",
      mix: adoptFormState(() => {
        throw new Error("Unchanged email adopted");
      }),
    }),
    createElement("input", {
      id: "unchanged-range",
      type: "range",
      min: 80,
      max: 100,
      mix: adoptFormState(() => {
        throw new Error("Unchanged range notified");
      }),
    }),
    createElement(
      "select",
      {
        id: "unchanged-options",
        mix: adoptFormState(() => {
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
if (trustedClick)
  document.addEventListener(
    "click",
    (event) => {
      if ((event.target as Element).id === "checked")
        hydrateRoot(container, createElement(Form, null));
    },
    { capture: true, once: true },
  );
document.getElementById("hydrate")!.addEventListener("click", () => {
  if (activation) hydrateRoot(container, createElement(Form, null));
  else flushSync(() => hydrateRoot(container, createElement(Form, null)));
});
document.body.dataset.inputCount = "0";
document.body.dataset.changeCount = "0";
document.body.dataset.adoptionCount = "0";
document.body.dataset.radioAdoptionCount = "0";
document.body.dataset.textChangeCount = "0";
document.body.dataset.ready = "true";
