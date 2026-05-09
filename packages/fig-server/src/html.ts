import { isPortal, type Props } from "@bgub/fig";

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
  sink.write(`<${type}`);
  writeAttributes(type, props, inheritedProps, sink);
  sink.write(">");
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

function writeAttributes(
  type: string,
  props: Props,
  inheritedProps: Props,
  sink: HtmlSink,
): void {
  for (const [name, value] of Object.entries(props)) {
    if (reservedProp(name)) continue;

    if (name === "style") {
      const style = serializeStyle(value);
      if (style !== "") writeAttribute(sink, "style", style);
      continue;
    }

    const attribute = formAttribute(type, name, value);
    if (attribute === null) continue;

    const [attributeNameValue, attributeValue] = attribute;
    validateAttributeName(attributeNameValue);

    if (attributeValue === true) {
      sink.write(` ${attributeNameValue}`);
      continue;
    }

    if (serializableAttributeValue(attributeValue)) {
      writeAttribute(sink, attributeNameValue, String(attributeValue));
      continue;
    }

    throw new Error(`Cannot serialize prop "${name}" to HTML.`);
  }

  if (
    type === "option" &&
    props.selected === undefined &&
    optionSelected(optionValue(props), inheritedProps)
  ) {
    sink.write(" selected");
  }
}

function formAttribute(
  type: string,
  name: string,
  value: unknown,
): [string, unknown] | null {
  if ((type === "textarea" || type === "select") && valueProp(name)) {
    return null;
  }

  if (valueProp(name)) {
    return valueAttribute(value);
  }

  if (name === "defaultChecked") {
    return value === true ? ["checked", true] : null;
  }

  if (type === "option" && name === "selected") {
    return value === true ? ["selected", true] : null;
  }

  return attributeValue(name, value);
}

function attributeValue(
  name: string,
  value: unknown,
): [string, unknown] | null {
  return emptyValue(value) ? null : [name, value];
}

function valueAttribute(value: unknown): [string, unknown] | null {
  if (emptyValue(value)) return null;
  if (serializableAttributeValue(value)) return ["value", String(value)];
  return ["value", value];
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

function writeAttribute(sink: HtmlSink, name: string, value: string): void {
  sink.write(` ${name}="${escapeAttribute(value)}"`);
}

function serializeStyle(value: unknown): string {
  if (emptyValue(value)) return "";
  if (typeof value !== "object") {
    throw new Error("The style prop must be an object during server render.");
  }

  const declarations: string[] = [];
  for (const [name, item] of Object.entries(value)) {
    if (emptyValue(item)) continue;
    if (
      typeof item !== "string" &&
      typeof item !== "number" &&
      typeof item !== "bigint"
    ) {
      throw new Error(`Cannot serialize style property "${name}" to HTML.`);
    }

    declarations.push(`${styleName(name)}:${String(item)}`);
  }

  return declarations.join(";");
}

function reservedProp(name: string): boolean {
  return (
    name === "children" ||
    name === "key" ||
    name === "events" ||
    name === "bind" ||
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

function escapeText(value: string): string {
  return value.replace(/[&<>]/g, (character) => {
    if (character === "&") return "&amp;";
    if (character === "<") return "&lt;";
    return "&gt;";
  });
}

function escapeAttribute(value: string): string {
  return value.replace(/[&"<>]/g, (character) => {
    if (character === "&") return "&amp;";
    if (character === '"') return "&quot;";
    if (character === "<") return "&lt;";
    return "&gt;";
  });
}
