import type { Props } from "@bgub/fig";
import { updateBind } from "./bind.ts";
import { updateEvents } from "./events.ts";

interface SelectState {
  appliedDefault: boolean;
  controlled: boolean;
  value: unknown;
}

interface UpdateOptions {
  hydrating?: boolean;
}

type StyleTarget = Record<string, unknown> & {
  removeProperty?: (name: string) => void;
  setProperty?: (name: string, value: string) => void;
};

const selectState = new WeakMap<Element, SelectState>();
const xlinkNamespace = "http://www.w3.org/1999/xlink";

export function updateElement(
  element: Element,
  previousProps: Props,
  nextProps: Props,
  options: UpdateOptions = {},
): void {
  const names = new Set([
    ...Object.keys(previousProps),
    ...Object.keys(nextProps),
  ]);

  for (const name of names) {
    if (name === "events") {
      updateEvents(element, nextProps[name]);
      continue;
    }

    if (name === "bind") {
      updateBind(element, nextProps[name]);
      continue;
    }

    if (reserved(name)) continue;

    const previous = previousProps[name];
    const next = nextProps[name];

    if (formProp(name)) {
      setFormProperty(element, name, previous, next, previousProps, options);
      continue;
    }

    if (previous === next) continue;
    setProperty(element, name, previous, next);
  }

  updateSelectOptions(element, previousProps, nextProps);
  updateParentSelect(element);
}

export function hydrateElement(element: Element, nextProps: Props): void {
  removeExtraHydratedAttributes(element, nextProps);
  clearHydratedStyle(element);
  updateElement(element, {}, nextProps, { hydrating: true });
}

function removeExtraHydratedAttributes(
  element: Element,
  nextProps: Props,
): void {
  const expectedAttributes = new Set<string>();
  const type = elementName(element);

  for (const name of Object.keys(nextProps)) {
    if (name === "events" || name === "bind" || reserved(name)) continue;

    const attribute = hydratedAttributeName(type, name);
    if (attribute !== null) expectedAttributes.add(attribute);
  }

  for (const name of attributeNames(element)) {
    if (!expectedAttributes.has(name)) element.removeAttribute(name);
  }
}

function clearHydratedStyle(element: Element): void {
  element.removeAttribute("style");

  const style = (element as HTMLElement).style;
  if (style === undefined) return;

  if (typeof style.length === "number" && typeof style.item === "function") {
    const names: string[] = [];
    for (let index = 0; index < style.length; index += 1) {
      const name = style.item(index);
      if (name !== "") names.push(name);
    }

    for (const name of names) style.removeProperty(name);
    return;
  }

  const styleRecord = style as unknown as Record<string, unknown>;
  for (const name of Object.keys(styleRecord)) styleRecord[name] = "";
}

function attributeNames(element: Element): string[] {
  const attributes = element.attributes as
    | (NamedNodeMap & Iterable<Attr>)
    | Record<string, unknown>
    | undefined;

  if (attributes === undefined) return [];

  if (
    "length" in attributes &&
    typeof attributes.length === "number" &&
    "item" in attributes &&
    typeof attributes.item === "function"
  ) {
    const names: string[] = [];
    for (let index = 0; index < attributes.length; index += 1) {
      const attribute = attributes.item(index);
      if (attribute !== null) names.push(attribute.name);
    }
    return names;
  }

  if (Symbol.iterator in attributes) {
    return Array.from(
      attributes as Iterable<Attr>,
      (attribute) => attribute.name,
    );
  }

  return Object.keys(attributes);
}

function setProperty(
  element: Element,
  name: string,
  previous: unknown,
  next: unknown,
): void {
  if (name === "style") {
    setStyle(element, previous, next);
    return;
  }

  const attribute = attributeName(name);
  const namespaced = name === "xlinkHref";
  if (next === null || next === undefined || next === false) {
    removeDomAttribute(element, name, attribute);
    if (!namespaced && name in element) {
      (element as unknown as Record<string, unknown>)[name] = "";
    }
  } else if (!namespaced && name in element && typeof next !== "object") {
    (element as unknown as Record<string, unknown>)[name] = next;
  } else {
    setDomAttribute(element, name, attribute, next);
  }
}

function setFormProperty(
  element: Element,
  name: string,
  previous: unknown,
  next: unknown,
  previousProps: Props,
  options: UpdateOptions,
): void {
  const type = elementName(element);
  if (type === "select" && valueProp(name)) return;

  if (name === "value") {
    setFormValue(element, next, type, { live: true });
  } else if (name === "defaultValue") {
    setFormValue(element, next, type, {
      defaultValue: true,
      live:
        previous === undefined &&
        previousProps.value === undefined &&
        options.hydrating !== true,
    });
  } else if (name === "checked") {
    setChecked(element, next, { live: true });
  } else if (name === "defaultChecked") {
    setChecked(element, next, {
      defaultChecked: true,
      live:
        previous === undefined &&
        previousProps.checked === undefined &&
        options.hydrating !== true,
    });
  } else {
    setProperty(element, name, previous, next);
  }
}

function setFormValue(
  element: Element,
  value: unknown,
  type: string,
  options: { defaultValue?: boolean; live?: boolean },
): void {
  const textArea = type === "textarea";
  const next = formValue(value);

  if (next === null || textArea) element.removeAttribute("value");
  else element.setAttribute("value", next);

  if (options.defaultValue === true && "defaultValue" in element) {
    (element as unknown as { defaultValue: string }).defaultValue = next ?? "";
  }
  if (textArea) element.textContent = next ?? "";

  if (
    options.live === true &&
    "value" in element &&
    (element as unknown as { value: string }).value !== (next ?? "")
  ) {
    (element as unknown as { value: string }).value = next ?? "";
  }
}

function formValue(value: unknown): string | null {
  return value === null || value === undefined || value === false
    ? null
    : String(value);
}

function setChecked(
  element: Element,
  value: unknown,
  options: { defaultChecked?: boolean; live?: boolean },
): void {
  const checked = value === true;
  setBooleanAttribute(element, "checked", checked);
  if (options.defaultChecked === true && "defaultChecked" in element) {
    (element as unknown as { defaultChecked: boolean }).defaultChecked =
      checked;
  }
  if (options.live === true && "checked" in element) {
    (element as unknown as { checked: boolean }).checked = checked;
  }
}

function updateSelectOptions(
  element: Element,
  previousProps: Props,
  nextProps: Props,
): void {
  if (elementName(element) !== "select") return;

  const controlled = nextProps.value !== undefined;
  const value = controlled ? nextProps.value : nextProps.defaultValue;
  if (value === undefined || value === null || value === false) {
    selectState.delete(element);
    return;
  }

  const state = selectState.get(element);
  const shouldApply =
    controlled ||
    (previousProps.value === undefined &&
      previousProps.defaultValue === undefined &&
      state?.appliedDefault !== true);
  selectState.set(element, {
    appliedDefault: state?.appliedDefault === true || !controlled,
    controlled,
    value,
  });
  if (!shouldApply) return;

  setSelectValue(element, value);
}

export function updateParentSelect(
  element: Element,
  applyDefault = false,
): void {
  const select = closestParentSelect(element);
  if (select === null) return;

  const state = selectState.get(select);
  if (state === undefined) return;
  if (!state.controlled && state.appliedDefault && !applyDefault) return;

  setSelectValue(select, state.value);
  if (!state.controlled) state.appliedDefault = true;
}

function setSelectValue(element: Element, value: unknown): void {
  const values = new Set(
    Array.isArray(value) ? value.map(String) : [String(value)],
  );

  for (const option of descendantOptions(element)) {
    const optionValue = currentOptionValue(option);
    (option as unknown as { selected: boolean }).selected =
      values.has(optionValue);
  }
}

function closestParentSelect(element: Element): Element | null {
  let parent: Node | null = element.parentNode;
  while (parent !== null) {
    if (isElement(parent) && elementName(parent) === "select") return parent;
    parent = parent.parentNode;
  }

  return null;
}

function descendantOptions(element: Element): Element[] {
  const options: Element[] = [];
  for (const child of Array.from(element.childNodes)) {
    if (!isElement(child)) continue;

    if (elementName(child) === "option") {
      options.push(child);
    } else {
      options.push(...descendantOptions(child));
    }
  }
  return options;
}

function currentOptionValue(option: Element): string {
  const value = attributeValue(option, "value");
  return value === null ? (option.textContent ?? "") : value;
}

function attributeValue(element: Element, name: string): string | null {
  if ("getAttribute" in element) {
    return element.getAttribute(name);
  }

  const attributes = element.attributes as Record<string, unknown> | undefined;
  const value = attributes?.[name];
  return typeof value === "string" ? value : null;
}

function setBooleanAttribute(
  element: Element,
  name: string,
  value: boolean,
): void {
  if (value) element.setAttribute(name, "true");
  else element.removeAttribute(name);
}

function setStyle(element: Element, previous: unknown, next: unknown): void {
  const style = (element as HTMLElement).style as unknown as
    | StyleTarget
    | undefined;
  if (style === undefined) return;

  const previousStyle = styleProps(previous);
  const nextStyle = styleProps(next);

  for (const name of Object.keys(previousStyle)) {
    if (!(name in nextStyle)) clearStyleProperty(style, name);
  }

  for (const [name, value] of Object.entries(nextStyle)) {
    if (value === null || value === undefined || value === false) {
      clearStyleProperty(style, name);
    } else {
      setStyleProperty(style, name, value);
    }
  }
}

function styleProps(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? value : {};
}

function setStyleProperty(
  style: StyleTarget,
  name: string,
  value: unknown,
): void {
  if (name.startsWith("--") && typeof style.setProperty === "function") {
    style.setProperty(name, String(value));
  } else {
    style[name] = value;
  }
}

function clearStyleProperty(style: StyleTarget, name: string): void {
  if (name.startsWith("--") && typeof style.removeProperty === "function") {
    style.removeProperty(name);
  } else {
    style[name] = "";
  }
}

function attributeName(name: string): string {
  if (name === "className") return "class";
  if (name === "htmlFor") return "for";
  if (name === "tabIndex") return "tabindex";
  if (name === "xlinkHref") return "xlink:href";
  return name;
}

function setDomAttribute(
  element: Element,
  name: string,
  attribute: string,
  value: unknown,
): void {
  if (name === "xlinkHref") {
    element.setAttributeNS(xlinkNamespace, attribute, String(value));
    return;
  }

  element.setAttribute(attribute, String(value));
}

function removeDomAttribute(
  element: Element,
  name: string,
  attribute: string,
): void {
  if (name === "xlinkHref") {
    element.removeAttributeNS(xlinkNamespace, "href");
    return;
  }

  element.removeAttribute(attribute);
}

function hydratedAttributeName(type: string, name: string): string | null {
  if (type === "textarea" && (name === "value" || name === "defaultValue")) {
    return null;
  }

  if (type === "select" && (name === "value" || name === "defaultValue")) {
    return null;
  }

  if (name === "defaultValue") return "value";
  if (name === "defaultChecked") return "checked";
  return attributeName(name);
}

function formProp(name: string): boolean {
  return valueProp(name) || name === "checked" || name === "defaultChecked";
}

function valueProp(name: string): boolean {
  return name === "value" || name === "defaultValue";
}

function elementName(element: Element): string {
  return (
    "localName" in element && typeof element.localName === "string"
      ? element.localName
      : "tagName" in element && typeof element.tagName === "string"
        ? element.tagName
        : ""
  ).toLowerCase();
}

function isElement(value: unknown): value is Element {
  return (
    typeof value === "object" &&
    value !== null &&
    "nodeType" in value &&
    value.nodeType === 1
  );
}

function reserved(name: string): boolean {
  return name === "children" || name === "key" || event(name);
}

function event(name: string): boolean {
  return /^on[A-Z]/.test(name);
}
