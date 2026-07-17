import type { Props } from "@bgub/fig";
import { isPortal } from "@bgub/fig/internal";

interface HtmlSink {
  write(chunk: string): void;
}

const voidElements = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

export function writeText(value: string, sink: HtmlSink): void {
  sink.write(escapeText(value));
}

export function writeElementStart(
  type: string,
  props: Props,
  sink: HtmlSink,
  inheritedProps: Props = {},
): void {
  validateTagName(type);
  sink.write(`<${type}${serializeAttributes(type, props, inheritedProps)}>`);
}

export function writeElementEnd(type: string, sink: HtmlSink): void {
  sink.write(`</${type}>`);
}

export function isVoidElement(type: string): boolean {
  return voidElements.has(type);
}

export function hasRenderableChild(node: unknown): boolean {
  if (Array.isArray(node)) return node.some(hasRenderableChild);
  if (isPortal(node)) return false;
  return !emptyChild(node);
}

export function formTextContent(type: string, props: Props): string | null {
  if (type !== "textarea") return null;

  const value = props.value !== undefined ? props.value : props.defaultValue;
  return formString(value);
}

export function unsafeHTMLContent(props: Props): string | null {
  const value = props.unsafeHTML;
  if (emptyValue(value)) return null;
  if (typeof value === "string") return value;
  throw new Error("The unsafeHTML prop must be a string during server render.");
}

function serializeAttributes(
  type: string,
  props: Props,
  inheritedProps: Props,
): string {
  let attributes = "";

  for (const name of Object.keys(props)) {
    const value = props[name];
    if (reservedProp(name)) continue;
    if (name === "value" && props.defaultValue !== undefined) continue;
    if (name === "checked" && props.defaultChecked !== undefined) continue;

    if (name === "style") {
      const style = serializeStyle(value);
      if (style !== "") attributes += serializeAttribute("style", style);
      continue;
    }

    attributes += serializeProp(type, name, value);
  }

  if (
    type === "option" &&
    props.selected === undefined &&
    optionSelected(optionValue(props), inheritedProps)
  ) {
    attributes += " selected";
  }

  return attributes;
}

function serializeProp(type: string, name: string, value: unknown): string {
  if ((type === "textarea" || type === "select") && valueProp(name)) {
    return "";
  }

  let attributeName = name;
  let attributeValue = value;

  if (valueProp(name)) {
    attributeName = "value";
    if (serializableAttributeValue(value)) attributeValue = String(value);
  } else if (name === "defaultChecked") {
    attributeName = "checked";
    attributeValue = value === true ? true : null;
  } else if (type === "option" && name === "selected") {
    attributeValue = value === true ? true : null;
  }

  if (emptyValue(attributeValue)) return "";

  validateAttributeName(attributeName);
  if (attributeValue === true) return ` ${attributeName}`;
  if (serializableAttributeValue(attributeValue)) {
    return serializeAttribute(attributeName, String(attributeValue));
  }

  throw new Error(`Cannot serialize prop "${name}" to HTML.`);
}

function optionSelected(value: unknown, selectProps: Props): boolean {
  const selectValue =
    selectProps.value !== undefined
      ? selectProps.value
      : selectProps.defaultValue;
  if (emptyValue(selectValue)) return false;

  const optionValue = formString(value);
  if (optionValue === null) return false;

  return selectedValueSet(selectValue).has(optionValue);
}

function optionValue(props: Props): string | null {
  return props.value === undefined
    ? optionTextValue(props.children)
    : formString(props.value);
}

function optionTextValue(node: unknown): string | null {
  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }
  if (Array.isArray(node)) {
    let text = "";
    for (const child of node) {
      const childText = optionTextValue(child);
      if (childText === null) return null;
      text += childText;
    }
    return text;
  }
  return null;
}

function formString(value: unknown): string | null {
  if (emptyValue(value)) return null;
  if (serializableAttributeValue(value)) return String(value);
  return null;
}

function selectedValueSet(value: unknown): Set<string> {
  return new Set(Array.isArray(value) ? value.map(String) : [String(value)]);
}

function serializableAttributeValue(value: unknown): boolean {
  return (
    value === true ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "bigint"
  );
}

function emptyValue(value: unknown): boolean {
  return value === null || value === undefined || value === false;
}

function emptyChild(value: unknown): boolean {
  return value === null || value === undefined || typeof value === "boolean";
}

function serializeAttribute(name: string, value: string): string {
  return ` ${name}="${escapeAttribute(value)}"`;
}

function serializeStyle(value: unknown): string {
  if (emptyValue(value)) return "";
  if (typeof value !== "object" || value === null) {
    throw new Error("The style prop must be an object during server render.");
  }

  let serialized = "";
  for (const [name, item] of Object.entries(value)) {
    if (emptyValue(item)) continue;
    if (
      typeof item !== "string" &&
      typeof item !== "number" &&
      typeof item !== "bigint"
    ) {
      throw new Error(`Cannot serialize style property "${name}" to HTML.`);
    }

    if (serialized !== "") serialized += ";";
    serialized += `${styleName(name)}:${String(item)}`;
  }

  return serialized;
}

function reservedProp(name: string): boolean {
  return (
    name === "children" ||
    name === "key" ||
    name === "mix" ||
    name === "bind" ||
    name === "suppressHydrationWarning" ||
    name === "unsafeHTML" ||
    /^on[A-Z]/.test(name)
  );
}

function valueProp(name: string): boolean {
  return name === "value" || name === "defaultValue";
}

function styleName(name: string): string {
  if (name.startsWith("--")) return name;
  return name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

function validateTagName(name: string): void {
  if (!/^[A-Za-z][A-Za-z0-9:._-]*$/.test(name)) {
    throw new Error(`Invalid HTML tag name "${name}".`);
  }
}

function validateAttributeName(name: string): void {
  if (/[\s"'<>/=]/.test(name)) {
    throw new Error(`Invalid HTML attribute name "${name}".`);
  }
}

export function escapeText(value: string): string {
  return value.replace(/[&<>]/g, (character) => {
    if (character === "&") return "&amp;";
    if (character === "<") return "&lt;";
    return "&gt;";
  });
}

export function escapeAttribute(value: string): string {
  return value.replace(/[&"<>]/g, (character) => {
    if (character === "&") return "&amp;";
    if (character === '"') return "&quot;";
    if (character === "<") return "&lt;";
    return "&gt;";
  });
}
