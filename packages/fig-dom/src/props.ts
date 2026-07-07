import type { Props } from "@bgub/fig";
import { updateBind } from "./bind.ts";
import { updateEvents } from "./events.ts";
import {
  elementName,
  isElementNode,
  isEmptyPropValue,
  isHtmlElement,
} from "./tree.ts";

declare const process: { env: { NODE_ENV?: string } };

interface SelectState {
  appliedDefault: boolean;
  controlled: boolean;
  value: unknown;
}

interface UpdateOptions {
  hydrating?: boolean;
  // The instance's first render: the only time defaultValue/defaultChecked
  // may live-write the element's value/checked state.
  initial?: boolean;
}

type StyleTarget = Record<string, unknown> & {
  readonly length?: number;
  item?: (index: number) => string;
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
  const type = elementName(element);
  const html = isHtmlElement(element);
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

    const previous = previousProps[name];
    const next = nextProps[name];

    if (name === "unsafeHTML") {
      if (options.hydrating === true) {
        unsafeHTMLValue(next);
        continue;
      }
      if (previous !== next) setUnsafeHTML(element, next);
      continue;
    }

    if (reserved(name)) {
      if (process.env.NODE_ENV !== "production" && event(name)) {
        warnDroppedProp(name, eventPropWarning(name, type, nextProps));
      }
      continue;
    }

    if (formProp(name)) {
      if (
        process.env.NODE_ENV !== "production" &&
        (name === "checked" || name === "defaultChecked") &&
        next !== undefined &&
        typeof next !== "boolean" &&
        next !== null
      ) {
        warnDroppedProp(
          `${name}:${typeof next}`,
          `The "${name}" prop received a ${typeof next} (${String(next)}); ` +
            "Fig treats only `true` as checked, so this renders unchecked.",
        );
      }
      setFormProperty(element, type, name, next, nextProps, options);
      continue;
    }

    if (previous === next) continue;
    if (name === "style") {
      if (
        process.env.NODE_ENV !== "production" &&
        typeof next === "string" &&
        next !== ""
      ) {
        warnDroppedProp(
          "style:string",
          "The style prop must be an object of properties; string styles " +
            "are ignored.",
        );
      }
      setStyle(element, previous, next);
    } else setAttribute(element, hostAttributeName(name, html), next);
  }

  updateSelectOptions(element, type, previousProps, nextProps, options);
  // Only option updates (value/text) can change which option a parent
  // select's stored value matches; skip the ancestor walk for everything
  // else.
  if (type === "option" || type === "optgroup") updateParentSelect(element);
}

// Dev-only, deduped by key: silently dropping a prop the author clearly
// intended (onClick, checked={1}, string styles) is the worst failure mode —
// nothing renders wrong, the behavior just never happens.
const warnedDroppedProps = new Set<string>();

function warnDroppedProp(key: string, message: string): void {
  if (warnedDroppedProps.has(key)) return;
  warnedDroppedProps.add(key);
  console.error(message);
}

function eventPropWarning(name: string, type: string, props: Props): string {
  // A trailing "Capture" is React's capture-phase suffix, except when it is
  // part of the event name itself (onGotPointerCapture/onLostPointerCapture
  // are bubble-phase props for gotpointercapture/lostpointercapture) or is
  // the entire name (an "onCapture" prop would leave an empty event name).
  const capture =
    name.endsWith("Capture") &&
    name.length > "onCapture".length &&
    name !== "onGotPointerCapture" &&
    name !== "onLostPointerCapture";
  const rawName = name.slice(2, capture ? -"Capture".length : undefined);
  const options = capture ? ", { capture: true }" : "";
  const suggest = (eventName: string) =>
    `Fig has no "${name}" event props; use ` +
    `events={[on("${eventName}", handler${options})]} instead.`;

  if (rawName === "DoubleClick") return suggest("dblclick");
  if (rawName === "Change" && reactChangeUsesInputEvent(type, props)) {
    return (
      suggest("input") +
      ` (React's onChange on text-editing controls fires per change like the` +
      ` native "input" event; on("change") fires only on commit.)`
    );
  }
  return suggest(rawName.toLowerCase());
}

// React backs onChange on text-editing controls with the native "input"
// event; only checkbox/radio/file inputs (and selects) match the native
// "change" timing, so everything else steers to on("input").
function reactChangeUsesInputEvent(type: string, props: Props): boolean {
  if (type === "textarea") return true;
  if (type !== "input") return false;
  const inputType = typeof props.type === "string" ? props.type : "text";
  return (
    inputType !== "checkbox" && inputType !== "radio" && inputType !== "file"
  );
}

export function hydrateElement(element: Element, nextProps: Props): void {
  // Snapshot before the update applies: updateElement writes the client
  // style prop into the same declaration and runs the bind callback (which
  // may set attributes), so a post-update enumeration could not tell
  // server-set names from client-set ones.
  const serverStyles =
    process.env.NODE_ENV !== "production" ? hydratedStyleNames(element) : [];
  const serverAttributes =
    process.env.NODE_ENV !== "production" ? attributeNames(element) : [];

  updateElement(element, {}, nextProps, { hydrating: true });

  if (
    process.env.NODE_ENV !== "production" &&
    nextProps.suppressHydrationWarning !== true
  ) {
    warnExtraHydratedAttributes(
      element,
      nextProps,
      serverStyles,
      serverAttributes,
    );
  }
}

// Server-only attributes and styles are preserved (extensions and internal
// markers make removal unsafe), so surface the divergence from a pure client
// render as a dev warning instead.
function warnExtraHydratedAttributes(
  element: Element,
  nextProps: Props,
  serverStyles: readonly string[],
  serverAttributes: readonly string[],
): void {
  if (serverAttributes.length === 0 && serverStyles.length === 0) return;

  const expectedAttributes = new Set<string>();
  const type = elementName(element);
  const html = isHtmlElement(element);

  for (const name of Object.keys(nextProps)) {
    if (name === "events" || name === "bind" || reserved(name)) continue;

    const attribute = hydratedAttributeName(type, name, html);
    if (attribute !== null) expectedAttributes.add(attribute);
  }

  const extra: string[] = [];
  for (const name of serverAttributes) {
    const attribute = hostAttributeName(name, html);
    if (attribute.startsWith("data-fig-")) continue;
    if (!expectedAttributes.has(attribute)) extra.push(name);
  }

  extra.push(...extraHydratedStyleNames(serverStyles, nextProps.style));

  if (extra.length === 0) return;

  console.error(
    `Hydration preserved extra server attributes or styles on <${type}>: ` +
      `${extra.sort().join(", ")}. They were preserved, so this element now ` +
      "differs from a pure client render.",
  );
}

// Writing the client style prop to a scratch declaration routes both name
// sets through the same CSSOM canonicalization (shorthand expansion, name
// casing), so server-set and client-produced names compare directly.
function extraHydratedStyleNames(
  serverStyles: readonly string[],
  next: unknown,
): string[] {
  if (serverStyles.length === 0) return [];

  const scratch = document.createElement("div");
  setStyle(scratch, {}, next);
  const expected = new Set(hydratedStyleNames(scratch));

  return serverStyles
    .filter((name) => !expected.has(name))
    .map((name) => `style.${name}`);
}

function hydratedStyleNames(element: Element): string[] {
  const style = (element as HTMLElement).style as unknown as
    | StyleTarget
    | undefined;
  if (style === undefined) return [];

  if (typeof style.length === "number" && typeof style.item === "function") {
    const names: string[] = [];
    for (let index = 0; index < style.length; index += 1) {
      const name = style.item(index);
      if (name !== "") names.push(name);
    }
    return names;
  }

  return Object.keys(style).filter((name) => style[name] !== "");
}

function hydratedAttributeName(
  type: string,
  name: string,
  html: boolean,
): string | null {
  if ((type === "textarea" || type === "select") && valueProp(name)) {
    return null;
  }

  if (name === "defaultValue") return "value";
  if (name === "defaultChecked") return "checked";
  return hostAttributeName(name, html);
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

function setFormProperty(
  element: Element,
  type: string,
  name: string,
  next: unknown,
  nextProps: Props,
  options: UpdateOptions,
): void {
  if (type === "select" && valueProp(name)) return;
  if (type === "option" && name === "value") {
    setAttribute(element, "value", formValue(next));
    return;
  }

  // Defaults live-write only on the instance's very first render (and never
  // during hydration, or when a controlling sibling prop wins): a
  // defaultValue/defaultChecked that APPEARS on a later update must not
  // clobber what the user typed or toggled since mount.
  const initial = options.initial === true && options.hydrating !== true;

  if (name === "value") {
    setFormValue(element, next, type, { live: true });
  } else if (name === "defaultValue") {
    setFormValue(element, next, type, {
      defaultValue: true,
      live: initial && nextProps.value === undefined,
    });
  } else if (name === "checked") {
    setChecked(element, next, { live: true });
  } else if (name === "defaultChecked") {
    setChecked(element, next, {
      defaultChecked: true,
      live: initial && nextProps.checked === undefined,
    });
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

  if (options.defaultValue === true && "defaultValue" in element) {
    (element as unknown as { defaultValue: string }).defaultValue = next ?? "";
  }
  if (options.defaultValue === true) {
    if (textArea) {
      element.textContent = next ?? "";
    } else {
      setAttribute(element, "value", next);
    }
  }

  if (
    options.live === true &&
    "value" in element &&
    (element as unknown as { value: string }).value !== (next ?? "")
  ) {
    (element as unknown as { value: string }).value = next ?? "";
  }
}

function formValue(value: unknown): string | null {
  return isEmptyPropValue(value) ? null : String(value);
}

function setChecked(
  element: Element,
  value: unknown,
  options: { defaultChecked?: boolean; live?: boolean },
): void {
  const checked = value === true;

  // The checked content attribute IS defaultChecked's reflection, so only
  // the defaultChecked prop may touch it — a controlled `checked` writes the
  // live property alone, mirroring value/defaultValue above.
  if (options.defaultChecked === true) {
    if ("defaultChecked" in element) {
      (element as unknown as { defaultChecked: boolean }).defaultChecked =
        checked;
    }
    setAttribute(element, "checked", checked);
  }

  if (options.live === true && "checked" in element) {
    (element as unknown as { checked: boolean }).checked = checked;
  }
}

function setUnsafeHTML(element: Element, value: unknown): void {
  const html = unsafeHTMLValue(value);
  if (!("innerHTML" in element)) return;

  (element as unknown as { innerHTML: string }).innerHTML = html ?? "";
}

function unsafeHTMLValue(value: unknown): string | null {
  if (isEmptyPropValue(value)) return null;
  if (typeof value === "string") return value;
  throw new Error("The unsafeHTML prop must be a string.");
}

function updateSelectOptions(
  element: Element,
  type: string,
  previousProps: Props,
  nextProps: Props,
  options: UpdateOptions = {},
): void {
  if (type !== "select") return;

  const controlled = nextProps.value !== undefined;
  const value = controlled ? nextProps.value : nextProps.defaultValue;
  if (value === undefined || value === null || value === false) {
    selectState.delete(element);
    return;
  }

  // A hydrating uncontrolled select trusts the server DOM's selection (the
  // user may have changed it before JS loaded); record the default as
  // applied so later updates don't re-apply it either. Controlled selects
  // still re-assert their value.
  const hydratingDefault = !controlled && options.hydrating === true;

  const state = selectState.get(element);
  const shouldApply =
    !hydratingDefault &&
    (controlled ||
      (previousProps.value === undefined &&
        previousProps.defaultValue === undefined &&
        state?.appliedDefault !== true));
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
    if (isElementNode(parent) && elementName(parent) === "select") {
      return parent;
    }
    parent = parent.parentNode;
  }

  return null;
}

function descendantOptions(element: Element): Element[] {
  const options: Element[] = [];
  for (const child of Array.from(element.childNodes)) {
    if (!isElementNode(child)) continue;

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
  if (value !== null) return value;

  // Spec-ish option.text: pretty-printed markup collapses to the visible
  // label, so implicit values match their authored form.
  return (option.textContent ?? "").replace(/\s+/g, " ").trim();
}

function attributeValue(element: Element, name: string): string | null {
  return element.getAttribute(name);
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
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

function setStyleProperty(
  style: StyleTarget,
  name: string,
  value: unknown,
): void {
  if (typeof value === "number" || typeof value === "bigint") {
    if (process.env.NODE_ENV !== "production") {
      warnDroppedProp(
        `style:${name}:${typeof value}`,
        `The style property "${name}" received a ${typeof value} ` +
          `(${String(value)}); Fig style values must be strings, so this ` +
          "style is ignored.",
      );
    }
    return;
  }

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

function hostAttributeName(name: string, html: boolean): string {
  return html ? name.toLowerCase() : name;
}

function setAttribute(
  element: Element,
  attribute: string,
  value: unknown,
): void {
  if (isEmptyPropValue(value)) {
    removeAttribute(element, attribute);
    return;
  }

  if (attribute === "xlink:href") {
    element.setAttributeNS(xlinkNamespace, attribute, String(value));
    return;
  }

  element.setAttribute(attribute, String(value));
}

function removeAttribute(element: Element, attribute: string): void {
  if (attribute === "xlink:href") {
    element.removeAttributeNS(xlinkNamespace, "href");
    return;
  }

  element.removeAttribute(attribute);
}

function formProp(name: string): boolean {
  return valueProp(name) || name === "checked" || name === "defaultChecked";
}

function valueProp(name: string): boolean {
  return name === "value" || name === "defaultValue";
}

function reserved(name: string): boolean {
  return (
    name === "children" ||
    name === "key" ||
    name === "suppressHydrationWarning" ||
    name === "unsafeHTML" ||
    event(name)
  );
}

function event(name: string): boolean {
  return /^on[A-Z]/.test(name);
}
