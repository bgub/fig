import {
  type FigAssetResource,
  type FigAssetResourceList,
  type Props,
} from "@bgub/fig";
import {
  assetResourceFromHostAttributes,
  assetResourceFromHostProps,
  assetResourceHostAttributes,
  assetResourceKey,
  isFigAssetResource,
} from "@bgub/fig/internal";
import { attachSubtree, detachSubtree } from "./attachment.ts";
import { updateElement } from "./props.ts";
import { elementName, isElementNode } from "./tree.ts";

interface DocumentResourceEntry {
  count: number;
  element: Element;
  ready: Promise<void> | null;
}

interface DocumentResourceMeta {
  key: string;
  kind: FigAssetResource["kind"];
}

interface DocumentResources {
  readonly entries: Map<string, DocumentResourceEntry>;
  readonly head: Element;
}

const registries = new WeakMap<Element, DocumentResources>();
const resourceMeta = new WeakMap<Element, DocumentResourceMeta>();

export function commitAssetResources(
  previous: FigAssetResourceList | null,
  next: FigAssetResourceList | null,
): void {
  const registry = currentDocumentResources();
  if (registry === null) return;

  const previousByKey = canonicalResources(previous);
  const nextByKey = canonicalResources(next);

  for (const [key] of previousByKey) {
    if (!nextByKey.has(key)) releaseDeclaredResource(registry, key);
  }

  for (const [key, resource] of nextByKey) {
    if (!previousByKey.has(key)) {
      acquireDeclaredResource(registry, resource);
    } else if (resource.kind === "title" || resource.kind === "meta") {
      updateDeclaredMetadata(registry, key, resource);
    }
  }
}

// Render-phase find-or-create only. Acquisition waits for commit because a
// render can be discarded; the zero-count entry still dedupes sibling work.
export function adoptDocumentResource(
  type: string,
  props: Props,
): Element | null {
  const registry = currentDocumentResources();
  const resource = assetResourceFromHostProps(type, props);
  if (registry === null || resource === null) return null;

  const key = assetResourceKey(resource);
  const entry = registry.entries.get(key);
  const element =
    entry?.element ??
    findDocumentResource(registry, key) ??
    document.createElement(type);

  if (entry === undefined) {
    registry.entries.set(key, { count: 0, element, ready: null });
    resourceMeta.set(element, { key, kind: resource.kind });
  }
  return element;
}

export function acquireDocumentResource(element: Element): Element {
  const registry = currentDocumentResources();
  if (registry === null) return element;

  // Deletions commit before placements, so a sibling's release in the same
  // commit may have dropped the element from the registry; re-derive its
  // identity from its attributes and revive it.
  let meta = resourceMeta.get(element);
  if (meta === undefined) {
    const resource = resourceFromElement(element);
    if (resource === null) return element;
    meta = { key: assetResourceKey(resource), kind: resource.kind };
    resourceMeta.set(element, meta);
  }

  const entry = registry.entries.get(meta.key);

  // A payload insertion may have claimed the key while this render was
  // suspended. Its live element is authoritative.
  if (entry !== undefined && entry.element !== element) {
    entry.count += 1;
    return attachDocumentResource(registry, entry.element);
  }

  if (entry === undefined) {
    registry.entries.set(meta.key, { count: 1, element, ready: null });
  } else {
    entry.count += 1;
  }
  return attachDocumentResource(registry, element);
}

export function releaseDocumentResource(element: Element): void {
  const registry = currentDocumentResources();
  const meta = resourceMeta.get(element);
  if (registry === null || meta === undefined) return;

  const entry = registry.entries.get(meta.key);

  // An element displaced by a rekey collision is untracked. Remove it with
  // its owner unless another key still references it.
  if (entry === undefined || entry.element !== element) {
    if (registryReferencesElement(registry, element)) return;
    resourceMeta.delete(element);
    if (removableResourceKind(meta.kind)) removeReleasedResource(element);
    return;
  }

  if (entry.count > 0) entry.count -= 1;
  if (entry.count > 0 || !removableResourceKind(meta.kind)) return;

  // Loads, scripts, and styles persist; removal cannot undo their effects.
  registry.entries.delete(meta.key);
  resourceMeta.delete(element);
  removeReleasedResource(element);
}

export function updateHoistedResource(
  element: Element,
  previousProps: Props,
  nextProps: Props,
): Element {
  const type = elementName(element);
  const resource = assetResourceFromHostProps(type, nextProps);
  const meta = resourceMeta.get(element);
  const key = resource === null ? null : assetResourceKey(resource);

  if (key === null || meta === undefined || key === meta.key) {
    updateElement(element, previousProps, nextProps);
    return element;
  }

  releaseDocumentResource(element);

  const registry = currentDocumentResources();
  const entry = registry?.entries.get(key);
  const claimed =
    entry !== undefined && entry.count > 0 ? entry.element : undefined;
  const next = adoptDocumentResource(type, nextProps) ?? element;
  if (next === element) {
    updateElement(element, previousProps, nextProps);
    return element;
  }

  // A shared committed element is key-authoritative; only style a fresh or
  // otherwise unclaimed element.
  if (claimed !== next) updateElement(next, {}, nextProps);
  return acquireDocumentResource(next);
}

/**
 * Inserts render-discovered asset resources into the document head. Returns a
 * promise that settles when every newly discovered critical stylesheet loads
 * or errors; hints, scripts, fonts, and non-blocking styles never gate reveal.
 */
export function insertAssetResources(
  resources: readonly FigAssetResource[],
): Promise<void> {
  const registry = currentDocumentResources();
  if (registry === null) return Promise.resolve();

  const gates: Promise<void>[] = [];
  for (const resource of resources) {
    if (!isFigAssetResource(resource)) continue;
    if (resource.kind === "title" || resource.kind === "meta") continue;

    const asset = asInsertableResource(resource);
    const key = assetResourceKey(asset);
    // A registry entry only counts as present while its element is attached:
    // a discarded render can leave a detached zero-count element built from
    // host props that need not match this descriptor (media, explicit-key
    // href), so a stale entry is discarded and replaced by a fresh element
    // created from the descriptor below.
    const tracked = registry.entries.get(key)?.element;
    const existing =
      (tracked?.parentNode === registry.head ? tracked : null) ??
      findDocumentResource(registry, key);

    if (existing !== null) {
      // Already present (SSR, a host-rendered element, or a prior call):
      // adopt it into the registry for O(1) future lookups. If it is still
      // loading, dependents join that pending gate. In dev, Vite may insert
      // a CSS link first; claim that still-loading element too so route
      // reveal waits for the stylesheet instead of committing a blank
      // payload slot.
      let entry = registry.entries.get(key);
      if (entry?.element !== existing) {
        entry = { count: 1, element: existing, ready: null };
        registry.entries.set(key, entry);
        resourceMeta.set(existing, { key, kind: asset.kind });
      }
      const gate = gateExistingStylesheet(registry, asset, key, entry);
      if (gate !== null) gates.push(gate);
      continue;
    }

    const element = createAssetResourceElement(asset);
    const entry: DocumentResourceEntry = {
      count: 1,
      element,
      ready: null,
    };
    entry.ready = isCriticalStylesheet(asset)
      ? whenResourceSettled(element).then(() => {
          if (registry.entries.get(key) === entry) entry.ready = null;
        })
      : null;
    registry.entries.set(key, entry);
    resourceMeta.set(element, { key, kind: asset.kind });
    insertDocumentResource(registry, element);
    if (entry.ready !== null) gates.push(entry.ready);
  }

  return gates.length === 0
    ? Promise.resolve()
    : Promise.all(gates).then(() => undefined);
}

function currentDocumentResources(): DocumentResources | null {
  if (typeof document === "undefined" || document.head == null) return null;

  let registry = registries.get(document.head);
  if (registry === undefined) {
    registry = { entries: new Map(), head: document.head };
    registries.set(document.head, registry);
  }
  return registry;
}

function canonicalResources(
  resources: FigAssetResourceList | null,
): Map<string, FigAssetResource> {
  const result = new Map<string, FigAssetResource>();
  if (resources === null) return result;

  const list = Array.isArray(resources) ? resources : [resources];
  for (const value of list) {
    if (!isFigAssetResource(value)) continue;
    const resource = asInsertableResource(value);
    const key = assetResourceKey(resource);
    if (!result.has(key) || resource.kind === "title") {
      result.set(key, resource);
    }
  }
  return result;
}

function acquireDeclaredResource(
  registry: DocumentResources,
  resource: FigAssetResource,
): void {
  const key = assetResourceKey(resource);
  const tracked = registry.entries.get(key)?.element;
  const element =
    tracked ??
    findDocumentResource(registry, key) ??
    createAssetResourceElement(resource);

  if (tracked === undefined) {
    registry.entries.set(key, { count: 0, element, ready: null });
    resourceMeta.set(element, { key, kind: resource.kind });
  }

  if (resource.kind === "title" || resource.kind === "meta") {
    applyMetadataResource(element, resource);
  }
  acquireDocumentResource(element);
}

function updateDeclaredMetadata(
  registry: DocumentResources,
  key: string,
  resource: FigAssetResource & { kind: "title" | "meta" },
): void {
  const entry = registry.entries.get(key);
  if (entry === undefined) {
    acquireDeclaredResource(registry, resource);
    return;
  }
  applyMetadataResource(entry.element, resource);
}

function releaseDeclaredResource(
  registry: DocumentResources,
  key: string,
): void {
  const entry = registry.entries.get(key);
  if (entry !== undefined) releaseDocumentResource(entry.element);
}

function attachDocumentResource(
  registry: DocumentResources,
  element: Element,
): Element {
  if (element.parentNode !== registry.head) {
    insertDocumentResource(registry, element);
  }
  attachSubtree(element);
  return element;
}

// Stylesheets are grouped by precedence. Bucket order is set by first
// discovery; later members join before the next bucket.
function insertDocumentResource(
  registry: DocumentResources,
  element: Element,
): void {
  const precedence = stylesheetPrecedence(element);
  if (precedence === null) {
    registry.head.appendChild(element);
    return;
  }

  let foundBucket = false;
  for (
    let child = registry.head.firstChild;
    child !== null;
    child = child.nextSibling
  ) {
    const current = isElementNode(child) ? stylesheetPrecedence(child) : null;
    if (current !== null) {
      if (current === precedence) foundBucket = true;
      else if (foundBucket) {
        registry.head.insertBefore(element, child);
        return;
      }
    }
  }
  registry.head.appendChild(element);
}

function findDocumentResource(
  registry: DocumentResources,
  key: string,
): Element | null {
  for (
    let child = registry.head.firstChild;
    child !== null;
    child = child.nextSibling
  ) {
    if (isElementNode(child)) {
      const resource = resourceFromElement(child);
      if (resource !== null && assetResourceKey(resource) === key) return child;
    }
  }
  return null;
}

function registryReferencesElement(
  registry: DocumentResources,
  element: Element,
): boolean {
  for (const entry of registry.entries.values()) {
    if (entry.element === element) return true;
  }
  return false;
}

function gateExistingStylesheet(
  registry: DocumentResources,
  resource: FigAssetResource,
  key: string,
  entry: DocumentResourceEntry,
): Promise<void> | null {
  if (!isCriticalStylesheet(resource)) return null;
  if (entry.ready !== null) return entry.ready;
  if (!isPendingStylesheetElement(entry.element)) return null;

  const gate = whenResourceSettled(entry.element).then(() => {
    if (registry.entries.get(key) === entry) entry.ready = null;
  });
  entry.ready = gate;
  return gate;
}

function resourceFromElement(element: Element): FigAssetResource | null {
  return assetResourceFromHostAttributes(elementName(element), (name) =>
    element.getAttribute(name),
  );
}

function removeReleasedResource(element: Element): void {
  detachSubtree(element);
  element.parentNode?.removeChild(element);
}

function removableResourceKind(kind: FigAssetResource["kind"]): boolean {
  return kind === "title" || kind === "meta";
}

function stylesheetPrecedence(element: Element): string | null {
  if (elementName(element) !== "link") return null;
  const resource = resourceFromElement(element);
  return resource?.kind === "stylesheet" ? (resource.precedence ?? "") : null;
}

// A font is delivered as <link rel="preload" as="font">, which parses back
// to a preload resource. Normalize it to that shape so its key and DOM
// round-trip match and it dedupes against SSR/host-rendered font preloads
// (otherwise the font:<href> lookup key never matches the preload:font:<href>
// a head <link> parses to, and a duplicate is appended).
function asInsertableResource(resource: FigAssetResource): FigAssetResource {
  if (resource.kind !== "font") return resource;
  return {
    as: "font",
    crossorigin: resource.crossorigin ?? "anonymous",
    fetchpriority: resource.fetchpriority,
    href: resource.href,
    key: resource.key,
    kind: "preload",
    type: resource.type,
  };
}

function isCriticalStylesheet(resource: FigAssetResource): boolean {
  if (resource.kind !== "stylesheet" || resource.blocking === "none") {
    return false;
  }
  if (resource.media === undefined || resource.media === "") return true;
  return typeof matchMedia !== "function" || matchMedia(resource.media).matches;
}

function isPendingStylesheetElement(element: Element): boolean {
  return (
    elementName(element) === "link" &&
    element.getAttribute("rel") === "stylesheet" &&
    "sheet" in element &&
    (element as { sheet: StyleSheet | null }).sheet === null
  );
}

function whenResourceSettled(element: Element): Promise<void> {
  return new Promise<void>((resolve) => {
    const settle = () => {
      element.removeEventListener("load", settle);
      element.removeEventListener("error", settle);
      resolve();
    };
    // Resolve on error too: a failed stylesheet must not block reveal forever.
    element.addEventListener("load", settle);
    element.addEventListener("error", settle);
  });
}

function createAssetResourceElement(resource: FigAssetResource): Element {
  if (resource.kind === "title" || resource.kind === "meta") {
    const element = document.createElement(resource.kind);
    applyMetadataResource(element, resource);
    return element;
  }

  const element = document.createElement(
    resource.kind === "script" ? "script" : "link",
  );
  for (const [name, value] of assetResourceHostAttributes(resource)) {
    element.setAttribute(name, value === true ? "" : value);
  }
  return element;
}

function applyMetadataResource(
  element: Element,
  resource: FigAssetResource & { kind: "title" | "meta" },
): void {
  if (resource.kind === "title") {
    element.textContent = resource.value;
    return;
  }

  const names = [
    "charset",
    "name",
    "property",
    "http-equiv",
    "content",
    "data-fig-resource-key",
  ];
  for (const name of names) element.removeAttribute(name);

  const attributes = [
    ["charset", resource.charset],
    ["name", resource.name],
    ["property", resource.property],
    ["http-equiv", resource["http-equiv"]],
    ["content", resource.content],
    ["data-fig-resource-key", resource.key],
  ] as const;
  for (const [name, value] of attributes) {
    if (value !== undefined) element.setAttribute(name, value);
  }
}
