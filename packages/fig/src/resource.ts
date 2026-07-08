import {
  Assets,
  createElement,
  type FigClientReference,
  type FigElement,
  type FigNode,
  type Props,
} from "./element.ts";

export type AssetResourceBlocking = "reveal" | "none";
export type CrossOrigin = "anonymous" | "use-credentials" | "";
export type FetchPriority = "high" | "low" | "auto";
export type AssetResourceDestination = "head" | "stream";

export type FigAssetResource =
  | StylesheetResource
  | PreloadResource
  | ModulePreloadResource
  | ScriptResource
  | FontResource
  | PreconnectResource
  | TitleResource
  | MetaResource;

interface ResourceBase {
  key?: string;
}

export interface StylesheetResource extends ResourceBase {
  blocking?: AssetResourceBlocking;
  crossOrigin?: CrossOrigin;
  href: string;
  kind: "stylesheet";
  media?: string;
  precedence?: string;
}

export interface PreloadResource extends ResourceBase {
  as: string;
  crossOrigin?: CrossOrigin;
  fetchPriority?: FetchPriority;
  href: string;
  kind: "preload";
  type?: string;
}

export interface ModulePreloadResource extends ResourceBase {
  crossOrigin?: CrossOrigin;
  fetchPriority?: FetchPriority;
  href: string;
  kind: "modulepreload";
}

export interface ScriptResource extends ResourceBase {
  async?: boolean;
  crossOrigin?: CrossOrigin;
  defer?: boolean;
  kind: "script";
  module?: boolean;
  src: string;
}

export interface FontResource extends ResourceBase {
  crossOrigin?: CrossOrigin;
  fetchPriority?: FetchPriority;
  href: string;
  kind: "font";
  type: string;
}

export interface PreconnectResource extends ResourceBase {
  crossOrigin?: CrossOrigin;
  href: string;
  kind: "preconnect";
}

export interface TitleResource extends ResourceBase {
  kind: "title";
  value: string;
}

export interface MetaResource extends ResourceBase {
  charset?: string;
  content?: string;
  httpEquiv?: string;
  kind: "meta";
  name?: string;
  property?: string;
}

export type FigAssetResourceList =
  | FigAssetResource
  | readonly FigAssetResource[];

// Asset resources a client reference contributes when it renders. Eager for
// hand-written lists; a thunk for bundler-manifest resolution that may not be
// available until serialization time, or that maps paths differently per build.
export type ClientReferenceAssets =
  | FigAssetResourceList
  | (() => FigAssetResourceList);

export interface AssetsProps {
  assets: FigAssetResourceList;
  children?: FigNode;
}

export function assets(
  value: FigAssetResourceList,
  children?: FigNode,
): FigElement<AssetsProps> {
  return createElement(Assets, { assets: value }, children);
}

export function stylesheet(
  href: string,
  options: Omit<StylesheetResource, "href" | "kind"> = {},
): StylesheetResource {
  return { ...options, href, kind: "stylesheet" };
}

export function preload(
  href: string,
  as: string,
  options: Omit<PreloadResource, "as" | "href" | "kind"> = {},
): PreloadResource {
  return { ...options, as, href, kind: "preload" };
}

export function modulepreload(
  href: string,
  options: Omit<ModulePreloadResource, "href" | "kind"> = {},
): ModulePreloadResource {
  return { ...options, href, kind: "modulepreload" };
}

export function script(
  src: string,
  options: Omit<ScriptResource, "kind" | "src"> = {},
): ScriptResource {
  return { ...options, kind: "script", src };
}

export function font(
  href: string,
  type: string,
  options: Omit<FontResource, "href" | "kind" | "type"> = {},
): FontResource {
  return { ...options, href, kind: "font", type };
}

export function preconnect(
  href: string,
  options: Omit<PreconnectResource, "href" | "kind"> = {},
): PreconnectResource {
  return { ...options, href, kind: "preconnect" };
}

export function title(value: string): TitleResource {
  return { kind: "title", value };
}

export function meta(options: Omit<MetaResource, "kind">): MetaResource {
  return { ...options, kind: "meta" };
}

export function isFigAssetResource(value: unknown): value is FigAssetResource {
  if (typeof value !== "object" || value === null) return false;

  switch ((value as { kind?: unknown }).kind) {
    case "stylesheet":
    case "preload":
    case "modulepreload":
    case "script":
    case "font":
    case "preconnect":
    case "title":
    case "meta":
      return true;
    default:
      return false;
  }
}

export function clientReferenceAssets(
  reference: FigClientReference,
): readonly FigAssetResource[] {
  const value = reference.assets;
  if (value === undefined) return [];

  // Resolved on each call rather than memoized: a lazy resolver may read a
  // manifest that is not loaded until serialization, and a consumer that wants
  // to cache can do so against the stable reference identity.
  const list = typeof value === "function" ? value() : value;
  if (isFigAssetResource(list)) return [list];
  // A thunk that yields nothing (e.g. a missing manifest entry) normalizes to an
  // empty list rather than leaking a non-array through the readonly contract.
  return Array.isArray(list) ? list : [];
}

export function assetResourceKey(resource: FigAssetResource): string {
  // A document carries a single <title>; collapse every title to one key even
  // when an author supplies an explicit key, so the singleton invariant cannot
  // be bypassed into emitting multiple <title> elements (invalid HTML).
  if (resource.kind === "title") return "title";

  // A font is serialized and inserted as <link rel="preload" as="font">, so an
  // explicit key must also live in the preload key space.
  if (resource.kind === "font" && resource.key !== undefined)
    return `preload:${resource.key}`;

  if (resource.key !== undefined) return `${resource.kind}:${resource.key}`;

  switch (resource.kind) {
    case "stylesheet":
      return `stylesheet:${resource.href}`;
    case "preload":
      return `preload:${resource.as}:${resource.href}`;
    case "modulepreload":
      return `modulepreload:${resource.href}`;
    case "script":
      return `script:${resource.src}`;
    case "font":
      // A font is loaded as <link rel="preload" as="font">, so it must share the
      // preload-font key space across every package (SSR registry, payload record,
      // client insert) — otherwise a font() and an equivalent preload(href,
      // "font") would key separately and fail to dedupe.
      return `preload:font:${resource.href}`;
    case "preconnect":
      return `preconnect:${resource.href}`;
    case "meta":
      return metaResourceKey(resource);
  }
}

export function assetResourceDestination(
  resource: FigAssetResource,
): AssetResourceDestination {
  return resource.kind === "title" || resource.kind === "meta"
    ? "head"
    : "stream";
}

export function assetResourceFromHostProps(
  type: string,
  props: Props,
): FigAssetResource | null {
  return resourceFromHost(type, (name) => props[name], props.children);
}

export function assetResourceFromHostAttributes(
  type: string,
  getAttribute: (name: string) => unknown,
): FigAssetResource | null {
  return resourceFromHost(type, getAttribute);
}

export type AssetResourceHostAttribute = readonly [
  name: string,
  value: string | true,
];

// Canonical attribute serialization for hoisted asset-resource elements,
// shared by the server's registry writer and the client's head insertion so
// the two renders cannot drift. `true` marks a boolean attribute (bare on
// the server, empty-string in the DOM). Server-only attributes (id, nonce)
// stay with the server writer; title/meta are written by their own paths.
export function assetResourceHostAttributes(
  resource: FigAssetResource,
): AssetResourceHostAttribute[] {
  const pairs: Array<readonly [string, string | true | undefined]> = [];

  switch (resource.kind) {
    case "stylesheet":
      pairs.push(
        ["rel", "stylesheet"],
        ["href", resource.href],
        ["data-fig-resource-key", resource.key],
        ["data-precedence", resource.precedence],
        ["media", resource.media],
        ["crossorigin", resource.crossOrigin],
      );
      break;
    case "preload":
      pairs.push(
        ["rel", "preload"],
        ["href", resource.href],
        ["as", resource.as],
        ["data-fig-resource-key", resource.key],
        ["type", resource.type],
        ["crossorigin", resource.crossOrigin],
        ["fetchpriority", resource.fetchPriority],
      );
      break;
    case "modulepreload":
      pairs.push(
        ["rel", "modulepreload"],
        ["href", resource.href],
        ["data-fig-resource-key", resource.key],
        ["crossorigin", resource.crossOrigin],
        ["fetchpriority", resource.fetchPriority],
      );
      break;
    case "font":
      pairs.push(
        ["rel", "preload"],
        ["href", resource.href],
        ["as", "font"],
        ["data-fig-resource-key", resource.key],
        ["type", resource.type],
        ["crossorigin", resource.crossOrigin ?? "anonymous"],
        ["fetchpriority", resource.fetchPriority],
      );
      break;
    case "preconnect":
      pairs.push(
        ["rel", "preconnect"],
        ["href", resource.href],
        ["data-fig-resource-key", resource.key],
        ["crossorigin", resource.crossOrigin],
      );
      break;
    case "script":
      pairs.push(
        ["src", resource.src],
        ["type", resource.module === true ? "module" : undefined],
        ["data-fig-resource-key", resource.key],
        // Hoisted scripts default to async, but an explicit defer opts into
        // ordered execution and must not be overridden (async wins over
        // defer in browsers).
        [
          "async",
          (resource.async ?? resource.defer !== true) ? true : undefined,
        ],
        ["defer", resource.defer === true ? true : undefined],
        ["crossorigin", resource.crossOrigin],
      );
      break;
    case "title":
    case "meta":
      break;
  }

  return pairs.filter(
    (pair): pair is readonly [string, string | true] => pair[1] !== undefined,
  );
}

function resourceFromHost(
  type: string,
  prop: (name: string) => unknown,
  children?: FigNode,
): FigAssetResource | null {
  const withKey = (resource: FigAssetResource): FigAssetResource => {
    const key = readProp(prop, "data-fig-resource-key");
    return key === undefined ? resource : { ...resource, key };
  };

  switch (type.toLowerCase()) {
    case "title":
      return withKey({ kind: "title", value: textResourceValue(children) });
    case "meta":
      if (readProp(prop, "itemProp", "itemprop") !== undefined) return null;
      return withKey({
        charset: readProp(prop, "charset", "charSet"),
        content: readProp(prop, "content"),
        httpEquiv: readProp(prop, "httpEquiv", "http-equiv"),
        kind: "meta",
        name: readProp(prop, "name"),
        property: readProp(prop, "property"),
      });
    case "link":
      return withNullableKey(linkResourceFromHost(prop), withKey);
    case "script": {
      const src = readProp(prop, "src");
      if (src === undefined) return null;
      return withKey({
        async:
          prop("async") === true
            ? true
            : prop("async") === false
              ? false
              : undefined,
        crossOrigin: readCrossOrigin(prop),
        defer: prop("defer") === true,
        kind: "script",
        module: prop("module") === true || prop("type") === "module",
        src,
      });
    }
    default:
      return null;
  }
}

function withNullableKey(
  resource: FigAssetResource | null,
  withKey: (resource: FigAssetResource) => FigAssetResource,
): FigAssetResource | null {
  return resource === null ? null : withKey(resource);
}

function linkResourceFromHost(
  prop: (name: string) => unknown,
): FigAssetResource | null {
  const rel = readProp(prop, "rel")?.toLowerCase();
  const href = readProp(prop, "href");
  if (
    rel === undefined ||
    href === undefined ||
    readProp(prop, "itemProp", "itemprop") !== undefined
  ) {
    return null;
  }

  if (rel === "stylesheet") {
    return {
      blocking: prop("blocking") === "none" ? "none" : undefined,
      crossOrigin: readCrossOrigin(prop),
      href,
      kind: "stylesheet",
      media: readProp(prop, "media"),
      // Hoisted elements serialize the canonical data-precedence attribute;
      // host-rendered <link precedence> keeps the author-facing prop name.
      precedence: readProp(prop, "precedence", "data-precedence"),
    };
  }

  if (rel === "modulepreload") {
    return {
      crossOrigin: readCrossOrigin(prop),
      fetchPriority: fetchPriorityProp(
        readProp(prop, "fetchPriority", "fetchpriority"),
      ),
      href,
      kind: "modulepreload",
    };
  }

  if (rel === "preload") {
    const as = readProp(prop, "as");
    if (as === undefined) return null;
    return {
      as,
      crossOrigin: readCrossOrigin(prop),
      fetchPriority: fetchPriorityProp(
        readProp(prop, "fetchPriority", "fetchpriority"),
      ),
      href,
      kind: "preload",
      type: readProp(prop, "type"),
    };
  }

  if (rel === "preconnect") {
    return {
      crossOrigin: readCrossOrigin(prop),
      href,
      kind: "preconnect",
    };
  }

  return null;
}

function readProp(
  prop: (name: string) => unknown,
  ...names: string[]
): string | undefined {
  for (const name of names) {
    const value = stringProp(prop(name));
    if (value !== undefined) return value;
  }

  return undefined;
}

function stringProp(value: unknown): string | undefined {
  if (value === undefined || value === null || value === false)
    return undefined;
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "bigint" ||
    value === true
  ) {
    return String(value);
  }

  throw new Error(
    "Resource host props must be serializable during server render.",
  );
}

function readCrossOrigin(
  prop: (name: string) => unknown,
): CrossOrigin | undefined {
  return crossOriginProp(readProp(prop, "crossOrigin", "crossorigin"));
}

function crossOriginProp(value: unknown): CrossOrigin | undefined {
  return value === "anonymous" || value === "use-credentials" || value === ""
    ? value
    : undefined;
}

function fetchPriorityProp(value: unknown): FetchPriority | undefined {
  return value === "high" || value === "low" || value === "auto"
    ? value
    : undefined;
}

function textResourceValue(node: FigNode): string {
  if (node === null || node === undefined || typeof node === "boolean") {
    return "";
  }
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textResourceValue).join("");

  throw new Error("<title> can only contain text during server render.");
}

function metaResourceKey(resource: MetaResource): string {
  if (resource.charset !== undefined) return `meta:charset:${resource.charset}`;
  if (resource.name !== undefined) return `meta:name:${resource.name}`;
  if (resource.property !== undefined)
    return `meta:property:${resource.property}`;
  if (resource.httpEquiv !== undefined) {
    return `meta:http-equiv:${resource.httpEquiv}`;
  }

  return `meta:${resource.content ?? ""}`;
}
