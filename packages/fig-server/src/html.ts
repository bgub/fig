import type { Props } from "@bgub/fig";
import type { HtmlSink } from "./sinks.ts";

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
): void {
  validateTagName(type);
  sink.write(`<${type}`);
  writeAttributes(props, sink);
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
  return node !== null && node !== undefined && typeof node !== "boolean";
}

function writeAttributes(props: Props, sink: HtmlSink): void {
  for (const [name, value] of Object.entries(props)) {
    if (reservedProp(name)) continue;

    if (name === "style") {
      const style = serializeStyle(value);
      if (style !== "") writeAttribute(sink, "style", style);
      continue;
    }

    if (value === null || value === undefined || value === false) continue;

    const attribute = attributeName(name);
    validateAttributeName(attribute);

    if (value === true) {
      sink.write(` ${attribute}`);
      continue;
    }

    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "bigint"
    ) {
      writeAttribute(sink, attribute, String(value));
      continue;
    }

    throw new Error(`Cannot serialize prop "${name}" to HTML.`);
  }
}

function writeAttribute(sink: HtmlSink, name: string, value: string): void {
  sink.write(` ${name}="${escapeAttribute(value)}"`);
}

function serializeStyle(value: unknown): string {
  if (value === null || value === undefined || value === false) return "";
  if (typeof value !== "object") {
    throw new Error("The style prop must be an object during server render.");
  }

  const declarations: string[] = [];
  for (const [name, item] of Object.entries(value)) {
    if (item === null || item === undefined || item === false) continue;
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
    /^on[A-Z]/.test(name)
  );
}

function attributeName(name: string): string {
  if (name === "className") return "class";
  if (name === "htmlFor") return "for";
  return name;
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
