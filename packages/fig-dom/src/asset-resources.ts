import { type FigAssetResource, type Props } from "@bgub/fig";
import {
  assetResourceKey,
  isFigAssetResource,
  assetResourceFromHostAttributes,
  assetResourceFromHostProps,
  assetResourceHostAttributes,
} from "@bgub/fig/internal";
import { attachSubtree, detachSubtree } from "./attachment.ts";
import { updateElement } from "./props.ts";
import { elementName, isElementNode } from "./tree.ts";

// The document/asset-resource registry: hoisted head elements (stylesheets,
// scripts, preloads, fonts, title/meta) are found-or-created during render,
// acquired/released with commit-phase refcounting through the hoisted host
// hooks, and deduped against SSR output by assetResourceKey.

interface DocumentResourceEntry {
  count: number;
  element: Element;
}

interface DocumentResourceMeta {
  key: string;
  kind: FigAssetResource["kind"];
}

const documentResourceRegistries = new WeakMap<
  Element,
  Map<string, DocumentResourceEntry>
>();
const documentResourceMeta = new WeakMap<Element, DocumentResourceMeta>();

// Render-phase find-or-create only: renders can be discarded and retried, so
// acquisition (refcounting, head insertion) waits for commitHoistedInstance.
// The zero-count registry entry dedupes sibling adopts within a render pass.
export function adoptDocumentResource(
  type: string,
  props: Props,
): Element | null {
  const head = documentHead();
  const resource = assetResourceFromHostProps(type, props);
  if (head === null || resource === null) return null;

  const key = assetResourceKey(resource);
  const registry = documentResourceRegistry(head);
  const adopted = registry.get(key);
  const element =
    adopted?.element ??
    findDocumentResource(head, key) ??
    document.createElement(type);

  if (adopted === undefined) {
    registry.set(key, { count: 0, element });
    documentResourceMeta.set(element, { key, kind: resource.kind });
  }

  return element;
}

export function acquireDocumentResource(element: Element): Element {
  const head = documentHead();
  if (head === null) return element;

  const registry = documentResourceRegistry(head);
  let meta = documentResourceMeta.get(element);

  // Deletions commit before placements, so a sibling's release in the same
  // commit may have dropped the element from the registry; re-derive its
  // identity from its attributes and revive it.
  if (meta === undefined) {
    const resource = assetResourceFromHostAttributes(
      elementName(element),
      (name) => element.getAttribute(name),
    );
    if (resource === null) return element;
    meta = { key: assetResourceKey(resource), kind: resource.kind };
    documentResourceMeta.set(element, meta);
  }

  const entry = registry.get(meta.key);

  // The key already resolves to a different live element (e.g. inserted by
  // insertAssetResources while this owner's render was suspended): adopt the
  // authoritative element instead of appending a stale duplicate.
  if (entry !== undefined && entry.element !== element) {
    entry.count += 1;
    return attachDocumentResource(head, entry.element);
  }

  if (entry === undefined) {
    registry.set(meta.key, { count: 1, element });
  } else {
    entry.count += 1;
  }

  return attachDocumentResource(head, element);
}

function attachDocumentResource(head: Element, element: Element): Element {
  if (element.parentNode !== head) head.appendChild(element);
  attachSubtree(element);
  return element;
}

function documentResourceRegistry(
  head: Element,
): Map<string, DocumentResourceEntry> {
  let registry = documentResourceRegistries.get(head);
  if (registry === undefined) {
    registry = new Map();
    documentResourceRegistries.set(head, registry);
  }
  return registry;
}

export function releaseDocumentResource(element: Element): void {
  const head = documentHead();
  const meta = documentResourceMeta.get(element);
  if (head === null || meta === undefined) return;

  const registry = documentResourceRegistries.get(head);
  const entry = registry?.get(meta.key);

  // An element displaced from the registry (rekey collision) is untracked:
  // remove it with its owner unless another entry still shares it.
  if (entry === undefined || entry.element !== element) {
    if (registryReferencesElement(registry, element)) return;
    documentResourceMeta.delete(element);
    if (removableResourceKind(meta.kind)) removeReleasedResource(element);
    return;
  }

  if (entry.count > 0) entry.count -= 1;
  if (entry.count > 0) return;

  // Stylesheets, scripts, and fetch hints persist once inserted: removal
  // cannot undo a load and would unstyle content that still races on it.
  // Document metadata is removed with its last owner.
  if (!removableResourceKind(meta.kind)) return;

  registry?.delete(meta.key);
  documentResourceMeta.delete(element);
  removeReleasedResource(element);
}

function removeReleasedResource(element: Element): void {
  detachSubtree(element);
  element.parentNode?.removeChild(element);
}

function removableResourceKind(kind: FigAssetResource["kind"]): boolean {
  return kind === "title" || kind === "meta";
}

function registryReferencesElement(
  registry: Map<string, DocumentResourceEntry> | undefined,
  element: Element,
): boolean {
  if (registry === undefined) return false;
  for (const entry of registry.values()) {
    if (entry.element === element) return true;
  }
  return false;
}

// Hoisted instances are shared by key, so an identity change must not mutate
// the shared element in place: release this owner's share of the old
// identity and adopt (or create) the element for the new one. Other owners
// keep the old element and its attributes untouched.
export function updateHoistedResource(
  element: Element,
  previousProps: Props,
  nextProps: Props,
): Element {
  const type = elementName(element);
  const resource = assetResourceFromHostProps(type, nextProps);
  const meta = documentResourceMeta.get(element);
  const key = resource === null ? null : assetResourceKey(resource);

  if (key === null || meta === undefined || key === meta.key) {
    updateElement(element, previousProps, nextProps);
    return element;
  }

  releaseDocumentResource(element);

  const head = documentHead();
  const entry =
    head === null ? undefined : documentResourceRegistry(head).get(key);
  const claimed =
    entry !== undefined && entry.count > 0 ? entry.element : undefined;
  const next = adoptDocumentResource(type, nextProps) ?? element;
  if (next === element) {
    // No head to adopt into; fall back to the in-place update.
    updateElement(element, previousProps, nextProps);
    return element;
  }

  // Style only a fresh or unclaimed element; an element other owners already
  // committed keeps its attributes (identity is key-authoritative).
  if (claimed !== next) updateElement(next, {}, nextProps);
  return acquireDocumentResource(next);
}

function documentHead(): Element | null {
  return typeof document !== "undefined" && document.head !== undefined
    ? document.head
    : null;
}

function findDocumentResource(head: Element, key: string): Element | null {
  for (const child of Array.from(head.childNodes)) {
    if (!isElementNode(child)) continue;

    const resource = assetResourceFromHostAttributes(child.localName, (name) =>
      child.getAttribute(name),
    );
    if (resource !== null && assetResourceKey(resource) === key) {
      return child;
    }
  }

  return null;
}

/**
 * Insert render-discovered asset resources (e.g. from a payload response's
 * `getAssetResources()`) into the document head, deduped against resources
 * already inserted by SSR, a host-rendered element, or an earlier call — using
 * the same key semantics as host resources. Returns a promise that resolves once
 * every freshly inserted *critical* stylesheet has loaded or errored, so callers
 * can gate revealing the dependent content. Non-critical hints (preload,
 * preconnect, scripts, fonts, `blocking: "none"` stylesheets) never block.
 */
export function insertAssetResources(
  resources: readonly FigAssetResource[],
): Promise<void> {
  const head = documentHead();
  if (head === null) return Promise.resolve();

  const registry = documentResourceRegistry(head);
  const gates: Promise<void>[] = [];

  for (const resource of resources) {
    if (!isFigAssetResource(resource)) continue;
    if (resource.kind === "title" || resource.kind === "meta") continue;

    // A font is delivered as <link rel="preload" as="font">, which parses back
    // to a preload resource. Normalize it to that shape so its key and DOM
    // round-trip match and it dedupes against SSR/host-rendered font preloads
    // (otherwise the font:<href> lookup key never matches the preload:font:<href>
    // a head <link> parses to, and a duplicate is appended).
    const asset = asInsertableResource(resource);
    const key = assetResourceKey(asset);
    // A registry entry only counts as present while its element is attached:
    // a discarded render can leave a detached zero-count element built from
    // host props that need not match this descriptor (media, explicit-key
    // href), so a stale entry is discarded and replaced by a fresh element
    // created from the descriptor below.
    const tracked = registry.get(key)?.element;
    const existing: Element | null =
      (tracked !== undefined && tracked.parentNode === head ? tracked : null) ??
      findDocumentResource(head, key);

    if (existing !== null) {
      // Already present (SSR, a host-rendered element, or a prior call):
      // adopt it into the registry for O(1) future lookups, but do not
      // re-gate.
      if (registry.get(key)?.element !== existing) {
        registry.set(key, { count: 1, element: existing });
        documentResourceMeta.set(existing, { key, kind: asset.kind });
      }
      continue;
    }

    const element = createAssetResourceElement(asset);
    const gate = isCriticalStylesheet(asset)
      ? whenResourceSettled(element)
      : null;
    registry.set(key, { count: 1, element });
    documentResourceMeta.set(element, { key, kind: asset.kind });
    head.appendChild(element);

    if (gate !== null) gates.push(gate);
  }

  return gates.length === 0
    ? Promise.resolve()
    : Promise.all(gates).then(() => undefined);
}

function asInsertableResource(resource: FigAssetResource): FigAssetResource {
  // Fonts share the DOM representation (and therefore the key space) of a
  // font-targeted preload; everything else is already in its own key space.
  if (resource.kind !== "font") return resource;

  return {
    as: "font",
    crossOrigin: resource.crossOrigin ?? "anonymous",
    fetchPriority: resource.fetchPriority,
    href: resource.href,
    key: resource.key,
    kind: "preload",
    type: resource.type,
  };
}

function isCriticalStylesheet(resource: FigAssetResource): boolean {
  // Client-reference stylesheets gate reveal by default; opt out with
  // blocking: "none". Every other kind is a hint that must never block.
  if (resource.kind !== "stylesheet" || resource.blocking === "none") {
    return false;
  }
  if (resource.media === undefined || resource.media === "") return true;
  // Outside browsers there is no reliable media evaluation, so keep media
  // stylesheets conservative and gate them as potentially critical.
  return typeof matchMedia !== "function" || matchMedia(resource.media).matches;
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

// The attribute set is shared with the server's registry writer, so a
// client-inserted asset element cannot drift from its SSR counterpart.
function createAssetResourceElement(resource: FigAssetResource): Element {
  const element = document.createElement(
    resource.kind === "script" ? "script" : "link",
  );

  for (const [name, value] of assetResourceHostAttributes(resource)) {
    element.setAttribute(name, value === true ? "" : value);
  }

  return element;
}
