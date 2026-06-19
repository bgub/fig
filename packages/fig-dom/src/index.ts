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
  resourceFromHostAttributes,
  resourceFromHostProps,
} from "@bgub/fig/internal";
import {
  createRenderer,
  type DehydratedSuspenseBoundary,
  type DehydratedSuspenseError,
  type FigRoot,
  type FigRootOptions,
  type HostConfig,
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
  rootFor,
  setEventBatching,
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
  appendInitialChild: (parent, child) => {
    if (appendDocumentResource(child)) return;
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
  },
  insertBefore: (parent, child, before) => {
    if (appendDocumentResource(child)) return;
    parent.insertBefore(child, before);
    if (isElementNode(child)) updateParentSelect(child, true);
    attachBindSubtree(child as Element | Text);
    attachEventSubtree(child as Element | Text);
  },
  removeChild: (parent, child) => {
    if (isDocumentResource(child)) {
      releaseDocumentResource(child);
      return;
    }
    removeBindSubtree(child as Element | Text);
    removeEventSubtree(child as Element | Text);
    parent.removeChild(child);
  },
  commitTextUpdate: (text, value) => {
    if (text.nodeValue !== value) text.nodeValue = value;
  },
  commitUpdate: (instance, previousProps, nextProps) => {
    if (isDocumentResource(instance)) {
      rekeyDocumentResource(instance, nextProps);
    }
    updateElement(instance, previousProps, nextProps);
  },
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
    const root = rootFor(boundary.start);

    if (boundary.status === "completed" && !boundary.forceClientRender) {
      removeNode(boundary.start);
      removeNode(boundary.end);
    } else {
      removeSuspenseBoundaryRange(boundary);
    }

    if (root !== null) queueMicrotask(() => replayQueuedEvents(root));
  },
  removeDehydratedSuspenseBoundary: (boundary) => {
    removeSuspenseBoundaryRange(boundary);
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

export type { FigRootOptions };

export function createRoot(
  container: Container,
  options?: FigRootOptions,
): FigRoot {
  const root = renderer.createRoot(container, options);
  registerRoot(container, undefined, (callback) => root.data.run(callback));
  return root;
}

export function hydrateRoot(
  container: Container,
  children: FigNode,
  options?: FigRootOptions,
): FigRoot {
  registerRoot(container, (target, lane) =>
    renderer.hydrateTarget(container, target, lane),
  );
  const root = renderer.hydrateRoot(container, children, options);
  registerRoot(
    container,
    (target, lane) => renderer.hydrateTarget(container, target, lane),
    (callback) => root.data.run(callback),
  );
  return root;
}

export function render(children: FigNode, container: Container): FigRoot {
  registerRoot(container);
  const root = renderer.render(children, container);
  registerRoot(container, undefined, (callback) => root.data.run(callback));
  return root;
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

  if (resource.kind === "title") element.textContent = "";

  if (adopted === undefined) {
    registry.set(key, { count: 1, element });
    documentResourceMeta.set(element, { key, kind: resource.kind });
  } else {
    adopted.count += 1;
  }

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
  if (entry === undefined || entry.element !== element) return;

  entry.count -= 1;
  if (entry.count > 0) return;

  // Stylesheets, scripts, and fetch hints persist once inserted: removal
  // cannot undo a load and would unstyle content that still races on it.
  // Document metadata is removed with its last owner.
  if (meta.kind !== "title" && meta.kind !== "meta") return;

  registry?.delete(meta.key);
  documentResourceMeta.delete(element);
  element.parentNode?.removeChild(element);
}

function rekeyDocumentResource(element: Element, nextProps: Props): void {
  const head = documentHead();
  const meta = documentResourceMeta.get(element);
  const resource = resourceFromHostProps(elementName(element), nextProps);
  if (head === null || meta === undefined || resource === null) return;

  const key = figResourceKey(resource);
  if (key === meta.key) return;

  const registry = documentResourceRegistries.get(head);
  const entry = registry?.get(meta.key);
  if (
    registry !== undefined &&
    entry !== undefined &&
    entry.element === element
  ) {
    registry.delete(meta.key);
    if (!registry.has(key)) registry.set(key, entry);
  }

  meta.key = key;
  meta.kind = resource.kind;
}

function appendDocumentResource(node: Element | TextLike): boolean {
  if (!isDocumentResource(node)) return false;

  const head = documentHead();
  if (head === null) return true;
  if (node.parentNode !== head) head.appendChild(node);
  return true;
}

function isDocumentResource(node: Element | TextLike): node is Element {
  return isElementNode(node) && documentResourceMeta.has(node);
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
    if (resource.kind === "title" || resource.kind === "meta") continue;

    const key = figResourceKey(resource);
    const existing =
      registry.get(key)?.element ?? findDocumentResource(head, key);

    if (existing !== null) {
      // Already present (SSR, a host-rendered element, or a prior call): adopt
      // it into the registry for O(1) future lookups, but do not re-gate.
      if (!registry.has(key)) {
        registry.set(key, { count: 1, element: existing });
        documentResourceMeta.set(existing, { key, kind: resource.kind });
      }
      continue;
    }

    const element = createAssetResourceElement(resource);
    registry.set(key, { count: 1, element });
    documentResourceMeta.set(element, { key, kind: resource.kind });
    head.appendChild(element);

    if (isCriticalStylesheet(resource))
      gates.push(whenResourceSettled(element));
  }

  return gates.length === 0
    ? Promise.resolve()
    : Promise.all(gates).then(() => undefined);
}

function isCriticalStylesheet(resource: FigResource): boolean {
  // Client-reference stylesheets gate reveal by default; opt out with
  // blocking: "none". Every other kind is a hint that must never block.
  return resource.kind === "stylesheet" && resource.blocking !== "none";
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
      break;
    case "preload":
      set("rel", "preload");
      set("href", resource.href);
      set("as", resource.as);
      set("type", resource.type);
      set("crossorigin", resource.crossOrigin);
      set("fetchpriority", resource.fetchPriority);
      break;
    case "script":
      set("src", resource.src);
      if (resource.module === true) set("type", "module");
      if (resource.async === true) set("async", "");
      if (resource.defer === true) set("defer", "");
      set("crossorigin", resource.crossOrigin);
      break;
    case "font":
      set("rel", "preload");
      set("as", "font");
      set("href", resource.href);
      set("type", resource.type);
      set("crossorigin", resource.crossOrigin ?? "anonymous");
      break;
    case "preconnect":
      set("rel", "preconnect");
      set("href", resource.href);
      set("crossorigin", resource.crossOrigin);
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
