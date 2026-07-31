import type { Props } from "@bgub/fig";
import { isPortal } from "@bgub/fig/internal";
import { escapeAttribute, escapeText } from "./escaping.ts";

export {
  escapeAttribute,
  escapeScriptJson,
  escapeScriptText,
  escapeText,
} from "./escaping.ts";

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

const attributeNamePattern = /[\s"'<>/=]/;
const eventPropPattern = /^on[A-Z]/;
const styleNamePattern = /[A-Z]/g;
const tagNamePattern = /^[A-Za-z][A-Za-z0-9:._-]*$/;

function hyphenateStyleLetter(letter: string): string {
  return `-${letter.toLowerCase()}`;
}

export function writeText(value: string, sink: HtmlSink): void {
  sink.write(escapeText(value));
}

export function writeElementStart(
  type: string,
  props: Props,
  sink: HtmlSink,
  selectProps: Props | null = null,
): void {
  validateTagName(type);
  sink.write(`<${type}${serializeAttributes(type, props, selectProps)}>`);
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
  return node !== null && node !== undefined && typeof node !== "boolean";
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
  selectProps: Props | null,
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
    optionSelected(optionValue(props), selectProps)
  ) {
    attributes += " selected";
  }

  return attributes;
}

function serializeProp(type: string, name: string, value: unknown): string {
  const isValueProp = name === "value" || name === "defaultValue";
  if ((type === "textarea" || type === "select") && isValueProp) {
    return "";
  }

  let attributeName = name;
  let attributeValue = value;

  if (isValueProp) {
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

function optionSelected(value: unknown, selectProps: Props | null): boolean {
  if (selectProps === null) return false;

  const selectValue =
    selectProps.value !== undefined
      ? selectProps.value
      : selectProps.defaultValue;
  if (emptyValue(selectValue)) return false;

  const optionValue = formString(value);
  if (optionValue === null) return false;

  if (!Array.isArray(selectValue)) return String(selectValue) === optionValue;
  for (const selectedValue of selectValue) {
    if (String(selectedValue) === optionValue) return true;
  }
  return false;
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

function serializeAttribute(name: string, value: string): string {
  return ` ${name}="${escapeAttribute(value)}"`;
}

function serializeStyle(value: unknown): string {
  if (emptyValue(value)) return "";
  if (typeof value !== "object" || value === null) {
    throw new Error("The style prop must be an object during server render.");
  }

  const styles = value as Record<string, unknown>;
  let serialized = "";
  for (const name of Object.keys(styles)) {
    const item = styles[name];
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
    eventPropPattern.test(name)
  );
}

function styleName(name: string): string {
  if (name.startsWith("--")) return name;
  return name.replace(styleNamePattern, hyphenateStyleLetter);
}

function validateTagName(name: string): void {
  if (!tagNamePattern.test(name)) {
    throw new Error(`Invalid HTML tag name "${name}".`);
  }
}

function validateAttributeName(name: string): void {
  if (attributeNamePattern.test(name)) {
    throw new Error(`Invalid HTML attribute name "${name}".`);
  }
}
