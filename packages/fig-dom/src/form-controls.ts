import type { Props } from "@bgub/fig";
import { elementName, isElementNode, isEmptyPropValue } from "./tree.ts";

export interface HostUpdateOptions {
  hydrating?: boolean;
  // The instance's first render: the only time defaultValue/defaultChecked
  // may live-write the element's value/checked state.
  initial?: boolean;
}

interface SelectState {
  appliedDefault: boolean;
  applyDefaultToInsertedOptions: boolean;
  controlled: boolean;
  selectedValues: string | ReadonlySet<string>;
}

const pendingHydrationChanges = new WeakMap<Element, Map<string, () => void>>();

export function holdHydratedFormState(element: Element): void {
  if (!pendingHydrationChanges.has(element))
    pendingHydrationChanges.set(element, new Map());
}

export function releaseHydratedFormState(
  element: Element,
  applyUpdates = true,
): void {
  const updates = pendingHydrationChanges.get(element);
  pendingHydrationChanges.delete(element);
  if (applyUpdates && updates !== undefined)
    for (const update of updates.values()) update();
}

export type HydratedFormState =
  | { kind: "checked"; checked: boolean }
  | { kind: "value"; value: string }
  | { kind: "select"; values: readonly string[] };

// Read the SSR baseline before client props or binds can change defaults.
// A fresh browser control normalizes server attributes without carrying the
// live control's dirty flags, autofill, or selection into the comparison.
export function initialHydratedFormState(
  element: Element,
): HydratedFormState | null {
  const type = elementName(element);
  if (type === "select") {
    if (element.ownerDocument !== undefined) {
      const probe = element.ownerDocument.createElement("select");
      for (const name of ["multiple", "size"]) {
        const value = element.getAttribute(name);
        if (value !== null) probe.setAttribute(name, value);
      }
      probe.innerHTML = element.innerHTML;
      return { kind: "select", values: selectedOptionValues(probe) };
    }
    // Renderer test doubles have no ownerDocument or native normalization.
    const defaults: string[] = [];
    let fallback: string | null = null;
    visitDescendantOptions(element, (option) => {
      if (fallback === null && !optionDisabled(option))
        fallback = optionValue(option);
      if (option.getAttribute("selected") !== null)
        defaults.push(optionValue(option));
    });
    const multiple = element.getAttribute("multiple") !== null;
    return {
      kind: "select",
      values: multiple
        ? defaults
        : defaults.length > 0
          ? defaults.slice(-1)
          : Number(element.getAttribute("size") ?? 0) <= 1 && fallback !== null
            ? [fallback]
            : [],
    };
  }
  if (type !== "input" && type !== "textarea") return null;
  const inputType = (element.getAttribute("type") ?? "text").toLowerCase();
  if (type === "input" && (inputType === "checkbox" || inputType === "radio"))
    return {
      kind: "checked",
      checked: element.getAttribute("checked") !== null,
    };
  if (
    type === "input" &&
    ["file", "submit", "reset", "button", "hidden", "image"].includes(inputType)
  )
    return null;
  let value =
    type === "textarea"
      ? ((element as HTMLTextAreaElement).defaultValue ??
        element.textContent ??
        "")
      : (element.getAttribute("value") ?? "");
  if (type === "textarea") value = value.replace(/\r\n?/g, "\n");
  else if (element.ownerDocument !== undefined) {
    const probe = element.ownerDocument.createElement("input");
    probe.type = inputType;
    for (const name of ["min", "max", "step", "multiple"]) {
      const constraint = element.getAttribute(name);
      if (constraint !== null) probe.setAttribute(name, constraint);
    }
    probe.value = value;
    value = probe.value;
  }
  return { kind: "value", value };
}

export function hydratedFormChanged(
  element: Element,
  initial: HydratedFormState,
): boolean {
  if (initial.kind === "checked")
    return (element as HTMLInputElement).checked !== initial.checked;
  if (initial.kind === "value")
    return (element as HTMLInputElement).value !== initial.value;
  const values = selectedOptionValues(element);
  return (
    values.length !== initial.values.length ||
    values.some((value, index) => value !== initial.values[index])
  );
}

function selectedOptionValues(element: Element): string[] {
  const values: string[] = [];
  visitDescendantOptions(element, (option) => {
    if ((option as HTMLOptionElement).selected)
      values.push(optionValue(option));
  });
  return values;
}

function optionDisabled(option: Element): boolean {
  if (option.getAttribute("disabled") !== null) return true;
  const parent = option.parentNode;
  return (
    isElementNode(parent) &&
    elementName(parent) === "optgroup" &&
    parent.getAttribute("disabled") !== null
  );
}

const selectStates = new WeakMap<Element, SelectState>();

export function isFormProp(name: string): boolean {
  return isValueProp(name) || name === "checked" || name === "defaultChecked";
}

export function updateFormControl(
  element: Element,
  type: string,
  name: string,
  value: unknown,
  props: Props,
  options: HostUpdateOptions,
): void {
  if (type === "select" && isValueProp(name)) return;
  if (type === "option" && name === "value") {
    setAttribute(element, "value", formValue(value));
    return;
  }

  // Hydration adopts live browser state. Pending notifications also protect
  // other edited fields from a flushSync inside an adoption callback.
  const pendingUpdates = pendingHydrationChanges.get(element);
  if (pendingUpdates !== undefined) {
    if (options.hydrating === true) return;
    pendingUpdates.set(name, () =>
      updateFormControl(element, type, name, value, props, options),
    );
    return;
  }

  // Defaults live-write on initial mount or untouched hydration. A default
  // that appears later must not clobber user-edited state.
  const initial = options.initial === true || options.hydrating === true;

  if (name === "value") {
    if (!isEmptyPropValue(value)) setFormValue(element, value);
  } else if (name === "defaultValue") {
    setDefaultValue(element, value, type, initial && props.value === undefined);
  } else if (name === "checked") {
    if (value !== undefined) setLiveChecked(element, value);
  } else if (name === "defaultChecked") {
    setDefaultChecked(element, value, initial && props.checked === undefined);
  }
}

export function updateSelect(
  element: Element,
  type: string,
  props: Props,
  options: HostUpdateOptions,
): void {
  if (type !== "select") return;

  const pendingUpdates = pendingHydrationChanges.get(element);
  if (options.hydrating !== true && pendingUpdates !== undefined) {
    pendingUpdates.set("select", () =>
      updateSelect(element, type, props, options),
    );
  }
  const controlled = props.value !== undefined;
  const value = controlled ? props.value : props.defaultValue;
  if (isEmptyPropValue(value)) {
    selectStates.delete(element);
    return;
  }

  const preservingHydration = pendingUpdates !== undefined;
  const previous = selectStates.get(element);
  const state: SelectState = {
    appliedDefault: previous?.appliedDefault === true || !controlled,
    applyDefaultToInsertedOptions:
      !preservingHydration && !controlled && options.initial === true,
    controlled,
    selectedValues: Array.isArray(value)
      ? new Set(value.map(String))
      : String(value),
  };
  selectStates.set(element, state);

  if (
    !preservingHydration &&
    (controlled || options.initial === true || options.hydrating === true)
  ) {
    applySelectValue(element, state.selectedValues);
  }
}

export function updateParentSelect(
  element: Element,
  applyDefault = false,
): void {
  const select = closestParentSelect(element);
  if (select === null) return;

  const state = selectStates.get(select);
  if (state === undefined || pendingHydrationChanges.has(select)) return;
  if (!state.controlled && state.appliedDefault && !applyDefault) return;
  if (
    !state.controlled &&
    applyDefault &&
    !state.applyDefaultToInsertedOptions
  ) {
    return;
  }

  applySelectValue(element, state.selectedValues);
  if (!state.controlled) state.appliedDefault = true;
}

export function shouldRestoreControlledFormState(
  type: string,
  props: Props,
): boolean {
  return (
    (type === "input" || type === "textarea" || type === "select") &&
    (props.value !== undefined || props.checked !== undefined)
  );
}

export function hydratedFormAttributeName(
  type: string,
  name: string,
): string | null | undefined {
  if (!isFormProp(name)) return undefined;
  if ((type === "textarea" || type === "select") && isValueProp(name)) {
    return null;
  }
  if (name === "defaultValue") return "value";
  if (name === "defaultChecked") return "checked";
  return name;
}

export function optionMatchesInheritedSelectValue(option: Element): boolean {
  if (elementName(option) !== "option") return false;

  const select = closestParentSelect(option);
  const state = select === null ? undefined : selectStates.get(select);
  return (
    state !== undefined && optionMatchesValue(option, state.selectedValues)
  );
}

function setDefaultValue(
  element: Element,
  value: unknown,
  type: string,
  live: boolean,
): void {
  const attributeValue = formValue(value);
  const next = attributeValue ?? "";
  if ("defaultValue" in element) {
    (element as Element & { defaultValue: string }).defaultValue = next;
  }
  if (type === "textarea") element.textContent = next;
  else setAttribute(element, "value", attributeValue);
  if (live && "value" in element) setLiveValue(element, next);
}

function setFormValue(element: Element, value: unknown): void {
  const next = formValue(value);
  if (next === null) return;
  if ("value" in element) setLiveValue(element, next);
  else setAttribute(element, "value", next);
}

function setLiveValue(element: Element, value: string): void {
  const target = element as Element & { value: string };
  if (target.value !== value) target.value = value;
}

function setDefaultChecked(
  element: Element,
  value: unknown,
  live: boolean,
): void {
  const checked = value === true;

  if ("defaultChecked" in element) {
    (element as Element & { defaultChecked: boolean }).defaultChecked = checked;
  }
  setAttribute(element, "checked", checked);
  if (live) setLiveChecked(element, value);
}

function setLiveChecked(element: Element, value: unknown): void {
  const checked = value === true;
  if ("checked" in element) {
    (element as Element & { checked: boolean }).checked = checked;
  } else {
    setAttribute(element, "checked", checked);
  }
}

function formValue(value: unknown): string | null {
  return isEmptyPropValue(value) ? null : String(value);
}

function applySelectValue(
  element: Element,
  values: string | ReadonlySet<string>,
): void {
  if (elementName(element) === "option") {
    setOptionSelected(element, values);
    return;
  }

  visitDescendantOptions(element, (option) => {
    setOptionSelected(option, values);
  });
}

function setOptionSelected(
  option: Element,
  values: string | ReadonlySet<string>,
): void {
  (option as Element & { selected: boolean }).selected = optionMatchesValue(
    option,
    values,
  );
}

function optionMatchesValue(
  option: Element,
  values: string | ReadonlySet<string>,
): boolean {
  const value = optionValue(option);
  return typeof values === "string" ? value === values : values.has(value);
}

function optionValue(option: Element): string {
  return (
    option.getAttribute("value") ??
    (option.textContent ?? "").replace(/\s+/g, " ").trim()
  );
}

function closestParentSelect(element: Element): Element | null {
  let parent = element.parentNode;
  while (parent !== null) {
    if (isElementNode(parent) && elementName(parent) === "select")
      return parent;
    parent = parent.parentNode;
  }
  return null;
}

function visitDescendantOptions(
  element: Element,
  visitor: (option: Element) => void,
): void {
  for (let child = element.firstChild; child !== null;) {
    const next = child.nextSibling;
    if (isElementNode(child)) {
      if (elementName(child) === "option") visitor(child);
      else visitDescendantOptions(child, visitor);
    }
    child = next;
  }
}

function isValueProp(name: string): boolean {
  return name === "value" || name === "defaultValue";
}

function setAttribute(
  element: Element,
  name: string,
  value: string | boolean | null,
): void {
  if (isEmptyPropValue(value)) element.removeAttribute(name);
  else element.setAttribute(name, String(value));
}
