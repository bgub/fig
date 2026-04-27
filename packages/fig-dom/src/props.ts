import type { Props } from "@bgub/fig";
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

    if (reserved(name)) continue;

    const previous = previousProps[name];
    const next = nextProps[name];

    if (previous === next) continue;

    setProperty(element, name, previous, next);
  }
}

function setProperty(
  element: Element,
  name: string,
  previous: unknown,
  next: unknown,
): void {
  const attribute = name === "className" ? "class" : name;

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

function reserved(name: string): boolean {
  return (
    name === "children" || name === "key" || name === "events" || event(name)
  );
}

function event(name: string): boolean {
  return /^on[A-Z]/.test(name);
}
