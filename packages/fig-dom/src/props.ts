import type { Props } from "@bgub/fig";
import { updateBind } from "./bind.ts";
import { updateEvents } from "./events.ts";
import {
  type HostUpdateOptions,
  hydratedFormAttributeName,
  isFormProp,
  updateFormControl,
  updateParentSelect,
  updateSelect,
} from "./form-controls.ts";
import {
  extraHydratedStyleNames,
  hydratedStyleNames,
  updateStyle,
} from "./styles.ts";
import { elementName, isEmptyPropValue, isHtmlElement } from "./tree.ts";

declare const __FIG_DEV__: boolean | undefined;

const __DEV__ = typeof __FIG_DEV__ === "boolean" ? __FIG_DEV__ : false;

const xlinkNamespace = "http://www.w3.org/1999/xlink";

export function updateElement(
  element: Element,
  previousProps: Props,
  nextProps: Props,
  options: HostUpdateOptions = {},
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
      if (__DEV__ && event(name)) {
        warnDroppedProp(name, eventPropWarning(name, type, nextProps));
      }
      continue;
    }

    if (isFormProp(name)) {
      if (
        __DEV__ &&
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
      updateFormControl(element, type, name, next, nextProps, options);
      continue;
    }

    if (previous === next) continue;
    if (name === "style") {
      updateStyle(element, previous, next);
    } else setAttribute(element, hostAttributeName(name, html), next);
  }

  updateSelect(element, type, nextProps, options);
  // Only option updates (value/text) can change which option a parent
  // select's stored value matches; skip the ancestor walk for everything
  // else.
  if (type === "option" || type === "optgroup") updateParentSelect(element);
}

// Dev-only, deduped by key: silently dropping a prop the author clearly
// intended (onClick, checked={1}) is the worst failure mode —
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
  const serverStyles = __DEV__ ? hydratedStyleNames(element) : [];
  const serverAttributes = __DEV__ ? attributeNames(element) : [];

  updateElement(element, {}, nextProps, { hydrating: true });

  if (__DEV__ && nextProps.suppressHydrationWarning !== true) {
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

function hydratedAttributeName(
  type: string,
  name: string,
  html: boolean,
): string | null {
  const formName = hydratedFormAttributeName(type, name);
  return formName === undefined ? hostAttributeName(name, html) : formName;
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
