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

  // Defaults live-write only on the instance's first client render. A
  // default that appears later must not clobber user-edited state.
  const initial = options.initial === true && options.hydrating !== true;

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

  const controlled = props.value !== undefined;
  const value = controlled ? props.value : props.defaultValue;
  if (isEmptyPropValue(value)) {
    selectStates.delete(element);
    return;
  }

  // Hydration trusts an uncontrolled selection that the user may already
  // have changed. Controlled selects always reassert their value.
  const hydratingDefault = !controlled && options.hydrating === true;
  const previous = selectStates.get(element);
  const state: SelectState = {
    appliedDefault: previous?.appliedDefault === true || !controlled,
    applyDefaultToInsertedOptions:
      !hydratingDefault && !controlled && options.initial === true,
    controlled,
    selectedValues: Array.isArray(value)
      ? new Set(value.map(String))
      : String(value),
  };
  selectStates.set(element, state);

  if (!hydratingDefault && (controlled || options.initial === true)) {
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
  if (state === undefined) return;
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
  const explicitValue = option.getAttribute("value");
  const value =
    explicitValue ?? (option.textContent ?? "").replace(/\s+/g, " ").trim();
  (option as Element & { selected: boolean }).selected =
    typeof values === "string" ? value === values : values.has(value);
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
