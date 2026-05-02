import type { Props } from "@bgub/fig";
import { updateBind } from "./bind.ts";
import { updateEvents } from "./events.ts";

export function updateElement(
  element: Element,
  previousProps: Props,
  nextProps: Props,
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

    if (previous === next) continue;

    setProperty(element, name, previous, next);
  }
}

export function hydrateElement(element: Element, nextProps: Props): void {
  removeExtraHydratedAttributes(element, nextProps);
  clearHydratedStyle(element);
  updateElement(element, {}, nextProps);
}

function removeExtraHydratedAttributes(
  element: Element,
  nextProps: Props,
): void {
  const expectedAttributes = new Set<string>();

  for (const name of Object.keys(nextProps)) {
    if (name === "events" || name === "bind" || reserved(name)) continue;
    expectedAttributes.add(attributeName(name));
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
  const attribute = attributeName(name);

  if (name === "style") {
    setStyle(element, previous, next);
  } else if (next === null || next === undefined || next === false) {
    element.removeAttribute(attribute);
    if (name in element) {
      (element as unknown as Record<string, unknown>)[name] = "";
    }
  } else if (name in element && typeof next !== "object") {
    (element as unknown as Record<string, unknown>)[name] = next;
  } else {
    element.setAttribute(attribute, String(next));
  }
}

function setStyle(element: Element, previous: unknown, next: unknown): void {
  const style = (element as HTMLElement).style as unknown as Record<
    string,
    unknown
  >;
  const previousStyle = styleProps(previous);
  const nextStyle = styleProps(next);

  for (const name of Object.keys(previousStyle)) {
    if (!(name in nextStyle)) style[name] = "";
  }

  Object.assign(style, nextStyle);
}

function styleProps(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? value : {};
}

function attributeName(name: string): string {
  return name === "className" ? "class" : name;
}

function reserved(name: string): boolean {
  return name === "children" || name === "key" || event(name);
}

function event(name: string): boolean {
  return /^on[A-Z]/.test(name);
}
