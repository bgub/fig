import {
  createPortalNode,
  ErrorBoundary,
  type FigNode,
  type FigResource,
  Fragment,
  type Key,
  type Props,
  Suspense,
  transition,
} from "@bgub/fig";
import {
  figResourceKey,
  isFigResource,
  resourceFromHostAttributes,
  resourceFromHostProps,
  validateInstanceNesting,
  validateTextNesting,
} from "@bgub/fig/internal";
import {
  createRenderer,
  type DehydratedSuspenseBoundary,
  type DehydratedSuspenseError,
  type FigRoot,
  type FigRootOptions,
  type HostConfig,
  type RefreshFamily,
  type RefreshUpdate,
  setRefreshHandler,
} from "@bgub/fig-reconciler";
import {
  attachBindSubtree,
  removeBindSubtree,
  resumeBind,
  suspendBind,
} from "./bind.ts";
import {
  attachEventSubtree,
  type Container,
  registerPortalContainer,
  registerRoot,
  removeEventSubtree,
  removePortalContainer,
  replayQueuedEvents,
  setEventBatching,
  unregisterRoot,
} from "./events.ts";
import { hydrateElement, updateElement, updateParentSelect } from "./props.ts";
import {
  elementName,
  htmlNamespace,
  isElementNode,
  mathNamespace,
  svgNamespace,
} from "./tree.ts";

type TextLike = Text | Comment;
type RetriableSuspenseMarker = TextLike & { __figRetry?: () => void };
type SuspenseBoundaryStatus = DehydratedSuspenseBoundary<
  Element,
  TextLike
>["status"];

declare const process: { env: { NODE_ENV?: string } };

interface SuspenseMarker {
  id: string | null;
  status: SuspenseBoundaryStatus;
}

export type { Bind } from "./bind.ts";
export {
  type EventCallback,
  type EventDescriptor,
  type EventOptions,
  on,
} from "./events.ts";
export {
  DefaultLane,
  DeferredLane,
  GestureLane,
  IdleLane,
  InputContinuousLane,
  OffscreenLane,
  runWithPriority,
  SyncLane,
  TransitionLane,
} from "./priority.ts";

const hostConfig: HostConfig<Container, Element, TextLike> = {
  createInstance: (type, props, parent) =>
    createDomElement(type, props, parent),
  createTextInstance: (text) => document.createTextNode(text),
  // The NODE_ENV gates below run at call time (never at module scope, which
  // would throw on import wherever bundler defines don't apply); with a
  // define, the dead branches let bundlers drop the dom-nesting module from
  // production bundles.
  validateInstanceNesting: (type, props, ancestors) => {
    if (process.env.NODE_ENV === "production") return;
    // Asset resources hoist to <head>, so their fiber position is not
    // their DOM position; the server exempts them the same way.
    if (resourceFromHostProps(type, props) !== null) return;
    validateInstanceNesting(type, ancestors);
  },
  validateTextNesting: (text, ancestors) => {
    if (process.env.NODE_ENV === "production") return;
    validateTextNesting(text, ancestors);
  },
  containerType: (container) =>
    isElementNode(container) ? elementName(container) : null,
  appendInitialChild: (parent, child) => {
    parent.appendChild(child);
    if (isElementNode(child)) updateParentSelect(child, true);
  },
  finalizeInitialInstance: (instance, props) =>
    updateElement(instance, {}, props),
  setTextContent: (instance, text) => {
    if (instance.textContent !== text) instance.textContent = text;
  },
  getFirstHydratableChild: (parent, props) =>
    hydratableFirstChild(parent, props),
  getNextHydratableSibling: (node) =>
    node.nextSibling as Element | TextLike | null,
  canHydrateInstance: (node, type, props) =>
    isHydratableElement(node, type, props),
  canHydrateTextInstance: (node) => isHydratableText(node),
  // Hoisted asset resources never appear at their fiber's server position
  // (the server registers them and emits nothing inline): hydration must not
  // match them against the DOM cursor, and commit acquires/releases them in
  // the head registry instead of inserting/removing at the fiber position.
  isHoistedInstance: (type, props) =>
    resourceFromHostProps(type, props) !== null,
  commitHoistedInstance: (instance) => acquireDocumentResource(instance),
  removeHoistedInstance: (instance) => releaseDocumentResource(instance),
  updateHoistedInstance: (instance, previousProps, nextProps) =>
    updateHoistedResource(instance, previousProps, nextProps),
  shouldCommitUpdate: (type, _previousProps, nextProps) =>
    shouldRestoreControlledFormState(type, nextProps),
  clearContainer: (container) => {
    let child = container.firstChild as Element | TextLike | null;

    while (child !== null) {
      const next = child.nextSibling as Element | TextLike | null;
      removeBindSubtree(child as Element | Text);
      removeEventSubtree(child as Element | Text);
      container.removeChild(child);
      child = next;
    }

    // A cleared container (hydration-mismatch recovery) detaches every
    // queued replayable event's target; drain them.
    queueMicrotask(replayQueuedEvents);
  },
  insertBefore: (parent, child, before) => {
    parent.insertBefore(child, before);
    if (isElementNode(child)) updateParentSelect(child, true);
    attachBindSubtree(child as Element | Text);
    attachEventSubtree(child as Element | Text);
  },
  removeChild: (parent, child) => {
    removeBindSubtree(child as Element | Text);
    removeEventSubtree(child as Element | Text);
    parent.removeChild(child);
  },
  commitTextUpdate: (text, value) => {
    if (text.nodeValue !== value) text.nodeValue = value;
  },
  commitUpdate: (instance, previousProps, nextProps) =>
    updateElement(instance, previousProps, nextProps),
  commitHydratedInstance: (instance, nextProps) =>
    hydrateElement(instance, nextProps),
  getActivityBoundary: (node) =>
    isActivityTemplate(node) ? (node as Element) : null,
  getFirstActivityHydratable: (boundary) =>
    (activityTemplateContent(boundary).firstChild ?? null) as
      | Element
      | TextLike
      | null,
  commitHydratedActivityBoundary: (boundary) => {
    const parent = boundary.parentNode;
    if (parent === null) return;

    const content = activityTemplateContent(boundary);
    while (content.firstChild !== null) {
      parent.insertBefore(content.firstChild, boundary);
    }
    parent.removeChild(boundary);
  },
  hideInstance: (instance) => {
    suspendBind(instance);
    (instance as HTMLElement).style.setProperty("display", "none", "important");
  },
  unhideInstance: (instance, props) => {
    const style = (props.style ?? {}) as Record<string, unknown>;
    const display = style.display;
    (instance as HTMLElement).style.setProperty(
      "display",
      typeof display === "string" || typeof display === "number"
        ? String(display)
        : "",
    );
    resumeBind(instance);
  },
  hideTextInstance: (text) => {
    text.nodeValue = "";
  },
  unhideTextInstance: (text, value) => {
    if (text.nodeValue !== value) text.nodeValue = value;
  },
  getSuspenseBoundary: (node) => suspenseBoundaryFor(node),
  isTargetWithinSuspenseBoundary: (target, boundary) =>
    isWithinSuspenseBoundary(target, boundary),
  registerSuspenseBoundaryRetry: (boundary, retry) => {
    (boundary.start as RetriableSuspenseMarker).__figRetry = retry;
  },
  commitHydratedSuspenseBoundary: (boundary) => {
    if (boundary.status === "completed" && !boundary.forceClientRender) {
      removeNode(boundary.start);
      removeNode(boundary.end);
    } else {
      removeSuspenseBoundaryRange(boundary);
    }

    queueMicrotask(replayQueuedEvents);
  },
  removeDehydratedSuspenseBoundary: (boundary) => {
    // The replay pass drops queued events whose targets left the tree with
    // the boundary.
    removeSuspenseBoundaryRange(boundary);
    queueMicrotask(replayQueuedEvents);
  },
  preparePortalContainer: (container, root, logicalParent) => {
    registerPortalContainer(
      container as Container,
      root,
      logicalParent as Container | Element,
    );
  },
  removePortalContainer: (container) => {
    removePortalContainer(container as Container);
  },
};

const renderer = createRenderer(hostConfig);
setEventBatching(renderer.batchedUpdates);

interface DocumentResourceEntry {
  count: number;
  element: Element;
}

interface DocumentResourceMeta {
  key: string;
  kind: FigResource["kind"];
}

const documentResourceRegistries = new WeakMap<
  Element,
  Map<string, DocumentResourceEntry>
>();
const documentResourceMeta = new WeakMap<Element, DocumentResourceMeta>();

export const batchedUpdates = renderer.batchedUpdates;
export const flushSync = renderer.flushSync;

// Fast Refresh (HMR) plumbing — used by the refresh runtime, not app code.
export const scheduleRefresh = renderer.scheduleRefresh;
export { type RefreshFamily, type RefreshUpdate, setRefreshHandler };

export type { FigRootOptions };

export function createRoot(
  container: Container,
  options?: FigRootOptions,
): FigRoot {
  const root = renderer.createRoot(container, options);
  registerRoot(container, undefined, (callback) => root.data.run(callback));
  return withRootTeardown(root, container);
}

export function hydrateRoot(
  container: Container,
  children: FigNode,
  options?: FigRootOptions,
): FigRoot {
  // Registration can follow the initial hydration render: it runs
  // synchronously in this task, so no DOM event can dispatch in between.
  const root = renderer.hydrateRoot(container, children, options);
  registerRoot(
    container,
    (target, lane) => renderer.hydrateTarget(container, target, lane),
    (callback) => root.data.run(callback),
  );
  return withRootTeardown(root, container);
}

export function render(children: FigNode, container: Container): FigRoot {
  registerRoot(container);
  const root = renderer.render(children, container);
  registerRoot(container, undefined, (callback) => root.data.run(callback));
  return withRootTeardown(root, container);
}

// Root event state (hydration listeners, delegated listener maps, queued
// replayable events) lives outside the reconciler; tear it down with the
// root so nothing dispatches against or retains an unmounted tree.
function withRootTeardown(root: FigRoot, container: Container): FigRoot {
  return {
    ...root,
    unmount: () => {
      root.unmount();
      unregisterRoot(container);
    },
  };
}

export function createPortal(
  children: FigNode,
  container: Container,
  key: Key | null = null,
) {
  return createPortalNode(children, container, key);
}

// Real templates hold children in a content fragment; test doubles hold
// them directly.
function activityTemplateContent(boundary: Element): ParentNode {
  return "content" in boundary
    ? (boundary.content as ParentNode)
    : (boundary as ParentNode);
}

function isActivityTemplate(node: Element | TextLike): boolean {
  return (
    elementName(node) === "template" &&
    "getAttribute" in node &&
    node.getAttribute("data-fig-activity") !== null
  );
}

function isHydratableElement(
  node: Element | TextLike,
  type: string,
  props: Props,
): boolean {
  if ("nodeType" in node && node.nodeType !== 1) return false;
  if (!("setAttribute" in node)) return false;

  const name =
    "localName" in node && typeof node.localName === "string"
      ? node.localName
      : "tagName" in node && typeof node.tagName === "string"
        ? node.tagName
        : "";

  if (name.toLowerCase() !== type.toLowerCase()) return false;
  return hasMatchingUnsafeHTML(node, props);
}

function createDomElement(
  type: string,
  props: Props,
  parent: Container | Element,
): Element {
  const resource = adoptDocumentResource(type, props);
  if (resource !== null) return resource;

  const namespace = namespaceFor(type, parent);
  return namespace === htmlNamespace
    ? document.createElement(type)
    : document.createElementNS(namespace, type);
}

// Render-phase find-or-create only: renders can be discarded and retried, so
// acquisition (refcounting, head insertion) waits for commitHoistedInstance.
// The zero-count registry entry dedupes sibling adopts within a render pass.
function adoptDocumentResource(type: string, props: Props): Element | null {
  const head = documentHead();
  const resource = resourceFromHostProps(type, props);
  if (head === null || resource === null) return null;

  const key = figResourceKey(resource);
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

function acquireDocumentResource(element: Element): Element {
  const head = documentHead();
  if (head === null) return element;

  const registry = documentResourceRegistry(head);
  let meta = documentResourceMeta.get(element);

  // Deletions commit before placements, so a sibling's release in the same
  // commit may have dropped the element from the registry; re-derive its
  // identity from its attributes and revive it.
  if (meta === undefined) {
    const resource = resourceFromHostAttributes(elementName(element), (name) =>
      element.getAttribute(name),
    );
    if (resource === null) return element;
    meta = { key: figResourceKey(resource), kind: resource.kind };
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
  attachBindSubtree(element);
  attachEventSubtree(element);
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

function releaseDocumentResource(element: Element): void {
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
  removeBindSubtree(element);
  removeEventSubtree(element);
  element.parentNode?.removeChild(element);
}

function removableResourceKind(kind: FigResource["kind"]): boolean {
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
function updateHoistedResource(
  element: Element,
  previousProps: Props,
  nextProps: Props,
): Element {
  const type = elementName(element);
  const resource = resourceFromHostProps(type, nextProps);
  const meta = documentResourceMeta.get(element);
  const key = resource === null ? null : figResourceKey(resource);

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

    const resource = resourceFromHostAttributes(child.localName, (name) =>
      child.getAttribute(name),
    );
    if (resource !== null && figResourceKey(resource) === key) {
      return child;
    }
  }

  return null;
}

/**
 * Insert render-discovered asset resources (e.g. from an RSC response's
 * `getAssetResources()`) into the document head, deduped against resources
 * already inserted by SSR, a host-rendered element, or an earlier call — using
 * the same key semantics as host resources. Returns a promise that resolves once
 * every freshly inserted *critical* stylesheet has loaded or errored, so callers
 * can gate revealing the dependent content. Non-critical hints (preload,
 * preconnect, scripts, fonts, `blocking: "none"` stylesheets) never block.
 */
export function insertAssetResources(
  resources: readonly FigResource[],
): Promise<void> {
  const head = documentHead();
  if (head === null) return Promise.resolve();

  const registry = documentResourceRegistry(head);
  const gates: Promise<void>[] = [];

  for (const resource of resources) {
    if (!isFigResource(resource)) continue;
    if (resource.kind === "title" || resource.kind === "meta") continue;

    // A font is delivered as <link rel="preload" as="font">, which parses back
    // to a preload resource. Normalize it to that shape so its key and DOM
    // round-trip match and it dedupes against SSR/host-rendered font preloads
    // (otherwise the font:<href> lookup key never matches the preload:font:<href>
    // a head <link> parses to, and a duplicate is appended).
    const asset = asInsertableResource(resource);
    const key = figResourceKey(asset);
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

function asInsertableResource(resource: FigResource): FigResource {
  // Fonts share the DOM representation (and therefore the key space) of a
  // font-targeted preload; everything else is already in its own key space.
  if (resource.kind !== "font") return resource;

  return {
    as: "font",
    crossOrigin: resource.crossOrigin ?? "anonymous",
    href: resource.href,
    kind: "preload",
    type: resource.type,
  };
}

function isCriticalStylesheet(resource: FigResource): boolean {
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

function createAssetResourceElement(resource: FigResource): Element {
  const element = document.createElement(
    resource.kind === "script" ? "script" : "link",
  );
  const set = (name: string, value: string | undefined): void => {
    if (value !== undefined) element.setAttribute(name, value);
  };

  switch (resource.kind) {
    case "stylesheet":
      set("rel", "stylesheet");
      set("href", resource.href);
      set("media", resource.media);
      set("precedence", resource.precedence);
      set("crossorigin", resource.crossOrigin);
      set("data-fig-resource-key", resource.key);
      break;
    case "preload":
      set("rel", "preload");
      set("href", resource.href);
      set("as", resource.as);
      set("type", resource.type);
      set("crossorigin", resource.crossOrigin);
      set("fetchpriority", resource.fetchPriority);
      set("data-fig-resource-key", resource.key);
      break;
    case "modulepreload":
      set("rel", "modulepreload");
      set("href", resource.href);
      set("crossorigin", resource.crossOrigin);
      set("fetchpriority", resource.fetchPriority);
      set("data-fig-resource-key", resource.key);
      break;
    case "script":
      set("src", resource.src);
      if (resource.module === true) set("type", "module");
      if (resource.async === true) set("async", "");
      if (resource.defer === true) set("defer", "");
      set("crossorigin", resource.crossOrigin);
      set("data-fig-resource-key", resource.key);
      break;
    case "font":
      set("rel", "preload");
      set("as", "font");
      set("href", resource.href);
      set("type", resource.type);
      set("crossorigin", resource.crossOrigin ?? "anonymous");
      set("data-fig-resource-key", resource.key);
      break;
    case "preconnect":
      set("rel", "preconnect");
      set("href", resource.href);
      set("crossorigin", resource.crossOrigin);
      set("data-fig-resource-key", resource.key);
      break;
  }

  return element;
}

function namespaceFor(type: string, parent: Container | Element): string {
  const normalizedType = type.toLowerCase();
  if (normalizedType === "svg") return svgNamespace;
  if (normalizedType === "math") return mathNamespace;

  return "namespaceURI" in parent && elementName(parent) !== "foreignobject"
    ? (parent.namespaceURI ?? htmlNamespace)
    : htmlNamespace;
}

function hydratableFirstChild(
  parent: Container | Element,
  props?: Props,
): Element | TextLike | null {
  if (props !== undefined && unsafeHTMLValue(props) !== null) return null;

  if (
    elementName(parent) === "textarea" &&
    props !== undefined &&
    hasManagedTextareaContent(props)
  ) {
    return null;
  }

  return parent.firstChild as Element | TextLike | null;
}

function hasManagedTextareaContent(props: Props): boolean {
  return props.value !== undefined || props.defaultValue !== undefined;
}

function unsafeHTMLValue(props: Props): unknown {
  const value = props.unsafeHTML;
  return value === null || value === undefined || value === false
    ? null
    : value;
}

function hasMatchingUnsafeHTML(element: Element, props: Props): boolean {
  const expected = unsafeHTMLValue(props);
  if (expected === null) return true;
  if (typeof expected !== "string" || !("innerHTML" in element)) return true;
  return element.innerHTML === expected;
}

function isHydratableText(node: Element | TextLike): boolean {
  if ("nodeType" in node && node.nodeType !== 3) return false;
  return !("setAttribute" in node) && "nodeValue" in node;
}

function shouldRestoreControlledFormState(type: string, props: Props): boolean {
  return (
    (type === "input" || type === "textarea" || type === "select") &&
    (props.value !== undefined || props.checked !== undefined)
  );
}

function suspenseBoundaryFor(
  node: Element | TextLike,
): DehydratedSuspenseBoundary<Element, TextLike> | null {
  if (!isComment(node)) return null;

  const marker = suspenseMarker(node);
  return marker === null ? null : suspenseBoundary(node, marker);
}

function suspenseBoundary(
  start: TextLike,
  initialMarker: SuspenseMarker,
): DehydratedSuspenseBoundary<Element, TextLike> | null {
  const end = suspenseBoundaryEnd(start);
  if (end === null) return null;
  return {
    end,
    forceClientRender: false,
    id: initialMarker.id,
    start,
    get error() {
      return suspenseBoundaryError(start);
    },
    get status() {
      return suspenseMarker(start)?.status ?? initialMarker.status;
    },
  };
}

function suspenseMarker(node: unknown): SuspenseMarker | null {
  if (!isComment(node)) return null;

  if (node.data === "fig:suspense:completed") {
    return { id: null, status: "completed" };
  }

  if (node.data === "fig:suspense:client") {
    return { id: null, status: "client-rendered" };
  }

  const pending = /^fig:suspense:pending:(.+)$/.exec(node.data);
  if (pending !== null) return { id: pending[1], status: "pending" };
  return null;
}

function suspenseBoundaryEnd(start: TextLike): TextLike | null {
  let depth = 0;

  for (
    let node = start.nextSibling as Element | TextLike | null;
    node !== null;
    node = node.nextSibling as Element | TextLike | null
  ) {
    if (!isComment(node)) continue;

    if (suspenseMarker(node) !== null) {
      depth += 1;
      continue;
    }

    if (node.data !== "/fig:suspense") continue;
    if (depth === 0) return node;
    depth -= 1;
  }

  return null;
}

function suspenseBoundaryError(
  start: TextLike,
): DehydratedSuspenseError | null {
  const placeholder = start.nextSibling;
  if (!hasDataset(placeholder)) return null;

  return {
    digest: placeholder.dataset.dgst,
    message: placeholder.dataset.msg,
  };
}

function isWithinSuspenseBoundary(
  target: unknown,
  boundary: DehydratedSuspenseBoundary<Element, TextLike>,
): boolean {
  if (!isNode(target)) return false;

  for (
    let node = boundary.start.nextSibling as Element | TextLike | null;
    node !== null && node !== boundary.end;
    node = node.nextSibling as Element | TextLike | null
  ) {
    if (node === target || containsNode(node, target)) return true;
  }

  return false;
}

function containsNode(parent: Element | TextLike, target: Node): boolean {
  for (const child of Array.from(parent.childNodes ?? [])) {
    if (child === target || containsNode(child as Element | TextLike, target)) {
      return true;
    }
  }

  return false;
}

function removeSuspenseBoundaryRange(
  boundary: DehydratedSuspenseBoundary<Element, TextLike>,
): void {
  for (let node: Element | TextLike | null = boundary.start; node !== null; ) {
    const next = node.nextSibling as Element | TextLike | null;
    removeNode(node);
    if (node === boundary.end) return;
    node = next;
  }
}

function removeNode(node: Element | TextLike): void {
  node.parentNode?.removeChild(node);
}

function isComment(node: unknown): node is Comment {
  return (
    typeof node === "object" &&
    node !== null &&
    "data" in node &&
    "nodeType" in node &&
    node.nodeType === 8
  );
}

function hasDataset(
  node: unknown,
): node is Element & { dataset: DOMStringMap } {
  return typeof node === "object" && node !== null && "dataset" in node;
}

function isNode(value: unknown): value is Node {
  return typeof value === "object" && value !== null && "parentNode" in value;
}

export { ErrorBoundary, Fragment, Suspense, transition };
