import { isEmptyPropValue } from "./tree.ts";

declare const __FIG_DEV__: boolean | undefined;

const __DEV__ = typeof __FIG_DEV__ === "boolean" ? __FIG_DEV__ : false;

type StyleTarget = Record<string, unknown> & {
  readonly length?: number;
  item?: (index: number) => string;
  removeProperty?: (name: string) => void;
  setProperty?: (name: string, value: string) => void;
};

const warnedStyles = new Set<string>();

export function updateStyle(
  element: Element,
  previous: unknown,
  next: unknown,
): void {
  if (__DEV__ && typeof next === "string" && next !== "") {
    warnStyle(
      "string",
      "The style prop must be an object of properties; string styles are ignored.",
    );
  }

  const style = (element as Element & { style?: StyleTarget }).style;
  if (style === undefined) return;

  const previousStyle = styleProps(previous);
  const nextStyle = styleProps(next);

  for (const name of Object.keys(previousStyle)) {
    if (!(name in nextStyle)) clearStyle(style, name);
  }

  for (const [name, value] of Object.entries(nextStyle)) {
    if (isEmptyPropValue(value)) {
      clearStyle(style, name);
    } else {
      setStyle(style, name, value);
    }
  }
}

// CSSOM canonicalizes name casing and shorthand expansion, so hydration
// compares server and client style names only after both pass through it.
export function extraHydratedStyleNames(
  serverStyles: readonly string[],
  next: unknown,
): string[] {
  if (serverStyles.length === 0) return [];

  const scratch = document.createElement("div");
  updateStyle(scratch, {}, next);
  const expected = new Set(hydratedStyleNames(scratch));

  return serverStyles
    .filter((name) => !expected.has(name))
    .map((name) => `style.${name}`);
}

export function hydratedStyleNames(element: Element): string[] {
  const style = (element as Element & { style?: StyleTarget }).style;
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

function styleProps(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

function setStyle(style: StyleTarget, name: string, value: unknown): void {
  if (typeof value === "number" || typeof value === "bigint") {
    if (__DEV__) {
      warnStyle(
        `${name}:${typeof value}`,
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

function clearStyle(style: StyleTarget, name: string): void {
  if (name.startsWith("--") && typeof style.removeProperty === "function") {
    style.removeProperty(name);
  } else {
    style[name] = "";
  }
}

function warnStyle(key: string, message: string): void {
  if (warnedStyles.has(key)) return;
  warnedStyles.add(key);
  console.error(message);
}
