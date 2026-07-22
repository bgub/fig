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
import type { AssetResourceOwner } from "@bgub/fig-reconciler";
import { attachSubtree, detachSubtree } from "./attachment.ts";
import { MetadataClaims } from "./metadata-claims.ts";
import { updateElement } from "./props.ts";
import { elementName, isElementNode } from "./tree.ts";

declare const __FIG_DEV__: boolean | undefined;

const __DEV__ = typeof __FIG_DEV__ === "boolean" ? __FIG_DEV__ : false;

interface PersistentResourceEntry {
  count: number;
  element: Element;
  kind: "persistent";
  ready: Promise<void> | null;
}

type MetadataResource = Extract<FigAssetResource, { kind: "title" | "meta" }>;

type DocumentResourceEntry = PersistentResourceEntry | MetadataClaims;

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
  owner: AssetResourceOwner,
): void {
  const registry = currentDocumentResources();
  if (registry === null) return;

  const previousByKey = canonicalResources(previous);
  const nextByKey = canonicalResources(next);

  for (const [key] of previousByKey) {
    if (!nextByKey.has(key)) releaseDeclaredResource(registry, key, owner);
  }

  for (const [key, resource] of nextByKey) {
    if (!previousByKey.has(key)) {
      acquireDeclaredResource(registry, resource, owner);
    } else if (resource.kind === "title" || resource.kind === "meta") {
      updateDeclaredMetadata(registry, key, resource, owner);
    }
  }
}

// Render-phase construction only. Acquisition waits for commit because a
// render can be discarded. Persistent assets reserve a zero-count entry to
// dedupe sibling work; metadata stays detached so it cannot mutate a winner.
export function adoptDocumentResource(
  type: string,
  props: Props,
): Element | null {
  const registry = currentDocumentResources();
  const resource = assetResourceFromHostProps(type, props);
  if (registry === null || resource === null) return null;

  const key = assetResourceKey(resource);
  if (isMetadataResource(resource)) {
    const element = document.createElement(type);
    resourceMeta.set(element, { key, kind: resource.kind });
    return element;
  }

  const entry = registry.entries.get(key);
  if (entry?.kind === "metadata") {
    throw new Error("Expected a persistent resource entry.");
  }
  const element =
    entry?.element ??
    findDocumentResource(registry, key) ??
    document.createElement(type);

  if (entry === undefined) {
    registry.entries.set(key, {
      count: 0,
      element,
      kind: "persistent",
      ready: null,
    });
    resourceMeta.set(element, { key, kind: resource.kind });
  }
  return element;
}

export function acquireDocumentResource(
  element: Element,
  props: Props,
  owner: AssetResourceOwner,
): Element {
  const registry = currentDocumentResources();
  if (registry === null) return element;

  const hostResource = assetResourceFromHostProps(elementName(element), props);
  if (hostResource !== null && isMetadataResource(hostResource)) {
    return acquireMetadataClaim(registry, hostResource, props, owner, element);
  }

  return acquirePersistentResource(registry, element);
}

function acquirePersistentResource(
  registry: DocumentResources,
  element: Element,
): Element {
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
  if (entry?.kind === "metadata") {
    throw new Error("Expected a persistent resource entry.");
  }

  // A payload insertion may have claimed the key while this render was
  // suspended. Its live element is authoritative.
  if (entry !== undefined && entry.element !== element) {
    entry.count += 1;
    return attachDocumentResource(registry, entry.element);
  }

  if (entry === undefined) {
    registry.entries.set(meta.key, {
      count: 1,
      element,
      kind: "persistent",
      ready: null,
    });
  } else {
    entry.count += 1;
  }
  return attachDocumentResource(registry, element);
}

export function releaseDocumentResource(
  element: Element,
  owner: AssetResourceOwner,
): void {
  const registry = currentDocumentResources();
  const meta = resourceMeta.get(element);
  if (registry === null || meta === undefined) return;

  const entry = registry.entries.get(meta.key);

  if (entry?.kind === "metadata") {
    releaseMetadataClaim(registry, meta.key, entry, owner);
    return;
  }
  if (meta.kind === "title" || meta.kind === "meta") {
    resourceMeta.delete(element);
    removeReleasedResource(element);
    return;
  }

  releasePersistentResource(registry, element);
}

function releasePersistentResource(
  registry: DocumentResources,
  element: Element,
): void {
  const meta = resourceMeta.get(element);
  if (meta === undefined) return;
  const entry = registry.entries.get(meta.key);

  // An element displaced by a rekey collision is untracked. Forget it unless
  // another key still references it; persistent browser effects stay live.
  if (entry === undefined || entry.element !== element) {
    if (registryReferencesElement(registry, element)) return;
    resourceMeta.delete(element);
    return;
  }

  if (entry.kind !== "persistent") {
    throw new Error("Expected a persistent resource entry.");
  }
  if (entry.count > 0) entry.count -= 1;
}

export function updateHoistedResource(
  element: Element,
  previousProps: Props,
  nextProps: Props,
  owner: AssetResourceOwner,
): Element {
  const type = elementName(element);
  const resource = assetResourceFromHostProps(type, nextProps);
  const meta = resourceMeta.get(element);

  // Hoisted placement is static fiber state. Never let props that stop
  // classifying mutate either a shared delivery asset or a metadata claim.
  if (resource === null) {
    if (__DEV__) {
      const previous = assetResourceFromHostProps(type, previousProps);
      const identity =
        meta?.key ?? (previous === null ? null : assetResourceKey(previous));
      const label = identity === null ? "" : ` (asset "${identity}")`;
      throw new Error(
        `A hoisted <${type}>${label} cannot update into an ordinary in-tree element. Keep its asset classification stable or replace it with a different Fig element key.`,
      );
    }
    return element;
  }

  const key = assetResourceKey(resource);
  const registry = currentDocumentResources();
  if (registry === null) {
    updateElement(element, previousProps, nextProps);
    return element;
  }

  const entry = meta === undefined ? undefined : registry.entries.get(meta.key);
  if (entry?.kind === "metadata") {
    if (!isMetadataResource(resource) || key === meta?.key) {
      entry.update(
        owner,
        isMetadataResource(resource)
          ? metadataClaimProps(resource, nextProps)
          : nextProps,
      );
      return entry.element;
    }

    releaseDocumentResource(element, owner);
    const candidate = document.createElement(type);
    updateElement(candidate, {}, nextProps);
    if (resource.kind === "title") candidate.textContent = resource.value;
    resourceMeta.set(candidate, {
      key: assetResourceKey(resource),
      kind: resource.kind,
    });
    return acquireMetadataClaim(
      registry,
      resource,
      nextProps,
      owner,
      candidate,
    );
  }

  if (meta === undefined || key === meta.key) {
    updateElement(element, previousProps, nextProps);
    return element;
  }

  releaseDocumentResource(element, owner);

  const nextEntry = registry.entries.get(key);
  const claimed =
    nextEntry?.kind === "persistent" && nextEntry.count > 0
      ? nextEntry.element
      : undefined;
  const next = adoptDocumentResource(type, nextProps) ?? element;
  if (next === element) {
    updateElement(element, previousProps, nextProps);
    return element;
  }

  // A shared committed element is key-authoritative; only style a fresh or
  // otherwise unclaimed element.
  if (claimed !== next) updateElement(next, {}, nextProps);
  return acquireDocumentResource(next, nextProps, owner);
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
      if (entry?.kind === "metadata") {
        throw new Error("Expected a persistent resource entry.");
      }
      if (entry?.element !== existing) {
        entry = {
          count: 1,
          element: existing,
          kind: "persistent",
          ready: null,
        };
        registry.entries.set(key, entry);
        resourceMeta.set(existing, { key, kind: asset.kind });
      }
      const gate = gateExistingStylesheet(registry, asset, key, entry);
      if (gate !== null) gates.push(gate);
      continue;
    }

    const element = createDeliveryResourceElement(asset);
    const entry: PersistentResourceEntry = {
      count: 1,
      element,
      kind: "persistent",
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
  owner: AssetResourceOwner,
): void {
  if (isMetadataResource(resource)) {
    acquireMetadataClaim(
      registry,
      resource,
      metadataResourceProps(resource),
      owner,
    );
    return;
  }

  const key = assetResourceKey(resource);
  const entry = registry.entries.get(key);
  if (entry?.kind === "metadata") {
    throw new Error("Expected a persistent resource entry.");
  }
  const tracked = entry?.element;
  const element =
    tracked ??
    findDocumentResource(registry, key) ??
    createDeliveryResourceElement(resource);

  if (tracked === undefined) {
    registry.entries.set(key, {
      count: 0,
      element,
      kind: "persistent",
      ready: null,
    });
    resourceMeta.set(element, { key, kind: resource.kind });
  }

  acquirePersistentResource(registry, element);
}

function updateDeclaredMetadata(
  registry: DocumentResources,
  key: string,
  resource: MetadataResource,
  owner: AssetResourceOwner,
): void {
  const entry = registry.entries.get(key);
  if (entry === undefined) {
    acquireDeclaredResource(registry, resource, owner);
    return;
  }
  if (entry.kind !== "metadata") {
    throw new Error("Expected a metadata resource entry.");
  }
  entry.update(owner, metadataResourceProps(resource));
}

function releaseDeclaredResource(
  registry: DocumentResources,
  key: string,
  owner: AssetResourceOwner,
): void {
  const entry = registry.entries.get(key);
  if (entry === undefined) return;
  if (entry.kind === "metadata") {
    releaseMetadataClaim(registry, key, entry, owner);
  } else {
    releasePersistentResource(registry, entry.element);
  }
}

function acquireMetadataClaim(
  registry: DocumentResources,
  resource: MetadataResource,
  props: Props,
  owner: AssetResourceOwner,
  candidate?: Element,
): Element {
  const key = assetResourceKey(resource);
  const claimProps = metadataClaimProps(resource, props);
  let entry = registry.entries.get(key);

  if (entry?.kind === "persistent") {
    throw new Error("Expected a metadata resource entry.");
  }

  if (entry === undefined) {
    const element =
      findDocumentResource(registry, key) ??
      candidate ??
      document.createElement(resource.kind);
    entry = new MetadataClaims(element, resource.kind, owner, claimProps);
    registry.entries.set(key, entry);
    resourceMeta.set(element, { key, kind: resource.kind });
  } else {
    entry.acquire(owner, claimProps);
  }

  return attachDocumentResource(registry, entry.element);
}

function releaseMetadataClaim(
  registry: DocumentResources,
  key: string,
  entry: MetadataClaims,
  owner: AssetResourceOwner,
): void {
  if (entry.release(owner) === "retained") return;
  registry.entries.delete(key);
  resourceMeta.delete(entry.element);
  removeReleasedResource(entry.element);
}

function metadataResourceProps(resource: MetadataResource): Props {
  if (resource.kind === "title") return { children: resource.value };

  return {
    charset: resource.charset,
    content: resource.content,
    "data-fig-resource-key": resource.key,
    "http-equiv": resource["http-equiv"],
    name: resource.name,
    property: resource.property,
  };
}

function metadataClaimProps(resource: MetadataResource, props: Props): Props {
  // The resource parser has already read promise-valued title children. Store
  // that resolved value so applying a claim cannot overwrite it with empty
  // text by inspecting the original thenable again during commit.
  return resource.kind === "title"
    ? { ...props, children: resource.value }
    : props;
}

function isMetadataResource(
  resource: FigAssetResource,
): resource is MetadataResource {
  return resource.kind === "title" || resource.kind === "meta";
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
  entry: PersistentResourceEntry,
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

function createDeliveryResourceElement(resource: FigAssetResource): Element {
  const element = document.createElement(
    resource.kind === "script" ? "script" : "link",
  );
  for (const [name, value] of assetResourceHostAttributes(resource)) {
    element.setAttribute(name, value === true ? "" : value);
  }
  return element;
}
