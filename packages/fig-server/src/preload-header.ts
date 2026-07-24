import type { FigAssetResource } from "@bgub/fig";
import type {
  ServerPreloadHeaderOptions,
  ServerPreloadHeaderResource,
} from "./types.ts";

type DeliveryResource = Exclude<FigAssetResource, { kind: "meta" | "title" }>;

export interface PreloadHeaderEntry {
  readonly resource: ServerPreloadHeaderResource;
  readonly value: string;
}

const DEFAULT_LENGTH = 2_000;
const HEX_ESCAPE = /^[0-9A-Fa-f]{2}$/;
const PARAMETER_TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const URI_REFERENCE_PUNCTUATION = "-._~:/?#[]@!$&'()*+,;=";

export function createPreloadHeaderEntries(
  resources: Iterable<DeliveryResource>,
): PreloadHeaderEntry[] {
  const preconnects: PreloadHeaderEntry[] = [];
  const criticalPreloads: PreloadHeaderEntry[] = [];
  const stylesheets: PreloadHeaderEntry[] = [];
  const remaining: PreloadHeaderEntry[] = [];

  for (const resource of resources) {
    if (resource.kind === "script") continue;
    const value = preloadHeaderValue(resource);
    if (value === null) continue;
    const entry = { resource, value };

    if (resource.kind === "preconnect") {
      preconnects.push(entry);
    } else if (
      resource.kind === "font" ||
      (resource.kind === "preload" &&
        (resource.as === "font" ||
          (resource.as === "image" && resource.fetchpriority === "high")))
    ) {
      criticalPreloads.push(entry);
    } else if (resource.kind === "stylesheet") {
      stylesheets.push(entry);
    } else {
      remaining.push(entry);
    }
  }

  return [...preconnects, ...criticalPreloads, ...stylesheets, ...remaining];
}

export function formatPreloadHeader(
  entries: readonly PreloadHeaderEntry[],
  options: ServerPreloadHeaderOptions = {},
): string | undefined {
  const maxLength = normalizedLength(options.maxLength);
  if (maxLength === 0) return undefined;

  const seen = new Set<string>();
  const values: string[] = [];
  let length = 0;

  for (const entry of entries) {
    if (options.filter !== undefined && !options.filter(entry.resource)) {
      continue;
    }
    if (seen.has(entry.value)) continue;

    const addedLength = entry.value.length + (values.length === 0 ? 0 : 2);
    if (length + addedLength > maxLength) continue;

    seen.add(entry.value);
    values.push(entry.value);
    length += addedLength;
  }

  return values.length === 0 ? undefined : values.join(", ");
}

function preloadHeaderValue(
  resource: ServerPreloadHeaderResource,
): string | null {
  switch (resource.kind) {
    case "stylesheet":
      return serializeLink(resource.href, [
        ["rel", "preload"],
        ["as", "style"],
        ["crossorigin", resource.crossorigin],
        ["media", resource.media],
      ]);
    case "preload":
      return serializeLink(resource.href, [
        ["rel", "preload"],
        ["as", resource.as],
        ["crossorigin", resource.crossorigin],
        ["type", resource.type],
        ["fetchpriority", resource.fetchpriority],
      ]);
    case "modulepreload":
      return serializeLink(resource.href, [
        ["rel", "modulepreload"],
        ["as", "script"],
        ["crossorigin", resource.crossorigin],
        ["fetchpriority", resource.fetchpriority],
      ]);
    case "font":
      return serializeLink(resource.href, [
        ["rel", "preload"],
        ["as", "font"],
        ["crossorigin", resource.crossorigin ?? "anonymous"],
        ["type", resource.type],
        ["fetchpriority", resource.fetchpriority],
      ]);
    case "preconnect":
      return serializeLink(resource.href, [
        ["rel", "preconnect"],
        ["crossorigin", resource.crossorigin],
      ]);
  }
}

function serializeLink(
  target: string,
  parameters: ReadonlyArray<readonly [name: string, value?: string]>,
): string | null {
  const encodedTarget = encodeLinkTarget(target);
  if (encodedTarget === null) return null;

  const parts = [`<${encodedTarget}>`];
  for (const [name, value] of parameters) {
    if (value === undefined) continue;
    const parameter = serializeParameter(name, value);
    if (parameter === null) return null;
    parts.push(parameter);
  }
  return parts.join("; ");
}

function serializeParameter(name: string, value: string): string | null {
  if (value === "") return name;
  if (hasInvalidParameterCharacter(value)) return null;
  if (PARAMETER_TOKEN.test(value)) return `${name}=${value}`;
  return `${name}="${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function encodeLinkTarget(value: string): string | null {
  if (value === "") return null;
  let encoded = "";

  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x20 || code === 0x7f) return null;

    const character = value[index];
    if (
      character === "%" &&
      HEX_ESCAPE.test(value.slice(index + 1, index + 3))
    ) {
      encoded += value.slice(index, index + 3);
      index += 2;
      continue;
    }
    if (
      (code >= 0x30 && code <= 0x39) ||
      (code >= 0x41 && code <= 0x5a) ||
      (code >= 0x61 && code <= 0x7a) ||
      URI_REFERENCE_PUNCTUATION.includes(character)
    ) {
      encoded += character;
      continue;
    }

    const codePoint = value.codePointAt(index);
    if (codePoint === undefined) return null;
    const symbol = String.fromCodePoint(codePoint);
    if (symbol.length === 2) index += 1;
    try {
      encoded += encodeURIComponent(symbol);
    } catch {
      return null;
    }
  }
  return encoded;
}

function hasInvalidParameterCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x20 || code === 0x7f || code > 0xff) return true;
  }
  return false;
}

function normalizedLength(value: number | undefined): number {
  if (value === undefined || Number.isNaN(value)) return DEFAULT_LENGTH;
  return Math.max(0, Math.floor(value));
}
