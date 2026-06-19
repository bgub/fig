import {
  createElement,
  type FigClientReference,
  type FigElement,
  type FigNode,
  type Props,
  Resources,
} from "./element.ts";

export type ResourceBlocking = "reveal" | "none";
export type CrossOrigin = "anonymous" | "use-credentials" | "";
export type FetchPriority = "high" | "low" | "auto";
export type ResourceDestination = "head" | "stream";

export type FigResource =
  | StylesheetResource
  | PreloadResource
  | ScriptResource
  | FontResource
  | PreconnectResource
  | TitleResource
  | MetaResource;

interface ResourceBase {
  key?: string;
}

export interface StylesheetResource extends ResourceBase {
  blocking?: ResourceBlocking;
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

export type FigResourceList = FigResource | readonly FigResource[];

// Asset resources a client reference contributes when it renders. Eager for
// hand-written lists; a thunk for bundler-manifest resolution that may not be
// available until serialization time, or that maps paths differently per build.
export type ClientReferenceResources =
  | FigResourceList
  | (() => FigResourceList);

export interface ResourcesOptions {
  children?: FigNode;
  resources: FigResourceList;
}

export function resources(
  value: FigResourceList,
  children?: FigNode,
): FigElement<ResourcesOptions> {
  return createElement(Resources, { resources: value }, children);
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

export function title(value: string, key?: string): TitleResource {
  return key === undefined
    ? { kind: "title", value }
    : { key, kind: "title", value };
}

export function meta(options: Omit<MetaResource, "kind">): MetaResource {
  return { ...options, kind: "meta" };
}

export function isFigResource(value: unknown): value is FigResource {
  if (typeof value !== "object" || value === null) return false;

  switch ((value as { kind?: unknown }).kind) {
    case "stylesheet":
    case "preload":
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

export function clientReferenceResources(
  reference: FigClientReference,
): readonly FigResource[] {
  const value = reference.resources;
  if (value === undefined) return [];

  // Resolved on each call rather than memoized: a lazy resolver may read a
  // manifest that is not loaded until serialization, and a consumer that wants
  // to cache can do so against the stable reference identity.
  const list = typeof value === "function" ? value() : value;
  return isFigResource(list) ? [list] : list;
}

export function figResourceKey(resource: FigResource): string {
  if (resource.key !== undefined) return `${resource.kind}:${resource.key}`;

  switch (resource.kind) {
    case "stylesheet":
      return `stylesheet:${resource.href}`;
    case "preload":
      return `preload:${resource.as}:${resource.href}`;
    case "script":
      return `script:${resource.src}`;
    case "font":
      return `font:${resource.href}`;
    case "preconnect":
      return `preconnect:${resource.href}`;
    case "title":
      return "title";
    case "meta":
      return metaResourceKey(resource);
  }
}

export function resourceDestination(
  resource: FigResource,
): ResourceDestination {
  return resource.kind === "title" || resource.kind === "meta"
    ? "head"
    : "stream";
}

export function resourceFromHostProps(
  type: string,
  props: Props,
): FigResource | null {
  return resourceFromHost(type, (name) => props[name], props.children);
}

export function resourceFromHostAttributes(
  type: string,
  getAttribute: (name: string) => unknown,
): FigResource | null {
  return resourceFromHost(type, getAttribute);
}

function resourceFromHost(
  type: string,
  prop: (name: string) => unknown,
  children?: FigNode,
): FigResource | null {
  switch (type.toLowerCase()) {
    case "title":
      return { kind: "title", value: textResourceValue(children) };
    case "meta":
      if (readProp(prop, "itemProp", "itemprop") !== undefined) return null;
      return {
        charset: readProp(prop, "charset", "charSet"),
        content: readProp(prop, "content"),
        httpEquiv: readProp(prop, "httpEquiv", "http-equiv"),
        kind: "meta",
        name: readProp(prop, "name"),
        property: readProp(prop, "property"),
      };
    case "link":
      return linkResourceFromHost(prop);
    case "script": {
      const src = readProp(prop, "src");
      if (src === undefined) return null;
      return {
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
      };
    }
    default:
      return null;
  }
}

function linkResourceFromHost(
  prop: (name: string) => unknown,
): FigResource | null {
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
      precedence: readProp(prop, "precedence"),
    };
  }

  if (rel === "preload" || rel === "modulepreload") {
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
