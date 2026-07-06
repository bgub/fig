import {
  createPortalNode,
  type FigNode,
  type Key,
  type Props,
} from "@bgub/fig";
import {
  ACTIVITY_TEMPLATE_ATTRIBUTE,
  assetResourceFromHostProps,
  validateInstanceNesting,
  validateTextNesting,
} from "@bgub/fig/internal";
import {
  createRenderer,
  type FigRoot,
  type FigRootOptions,
  type HostConfig,
} from "@bgub/fig-reconciler";
import {
  acquireDocumentResource,
  adoptDocumentResource,
  releaseDocumentResource,
  updateHoistedResource,
} from "./asset-resources.ts";
import { attachSubtree, detachSubtree } from "./attachment.ts";
import { composeBind, resumeBind, suspendBind } from "./bind.ts";
import {
  type Container,
  registerPortalContainer,
  registerRoot,
  removePortalContainer,
  replayQueuedEvents,
  setEventBatching,
  unregisterRoot,
} from "./events.ts";
import { hydrateElement, updateElement, updateParentSelect } from "./props.ts";
import { configureDomRefreshScheduler } from "./refresh.ts";
import {
  isWithinSuspenseBoundary,
  removeNode,
  removeSuspenseBoundaryRange,
  suspenseBoundaryFor,
} from "./suspense-markers.ts";
import {
  elementName,
  htmlNamespace,
  isElementNode,
  isEmptyPropValue,
  mathNamespace,
  svgNamespace,
} from "./tree.ts";

type TextLike = Text | Comment;
type RetriableSuspenseMarker = TextLike & { __figRetry?: () => void };

declare const process: { env: { NODE_ENV?: string } };

export { insertAssetResources } from "./asset-resources.ts";
export type { Bind } from "./bind.ts";
export {
  type EventCallback,
  type EventDescriptor,
  type EventOptions,
  on,
} from "./events.ts";
export type {
  EmptyPropValue,
  HostEvents,
  HostIntrinsicElements,
  HostProps,
  HostStyle,
} from "./jsx.ts";
export { composeBind };

const hostConfig: HostConfig<Container, Element, TextLike> = {
  createInstance: (type, props, parent) =>
    createDomElement(type, props, parent),
  createTextInstance: (text) => document.createTextNode(text),
  // The NODE_ENV gates below run at call time (never at module scope, which
  // would throw on import wherever bundler defines don't apply). They must
  // stay in block form — `if (dev) { validate() }` — not early-return form:
  // esbuild only eliminates the constant branch (and with it the dom-nesting
  // module import) at parse time, before symbol retention is decided; code
  // after an `if (prod) return` keeps the import referenced and ships the
  // whole module in production bundles.
  validateInstanceNesting: (type, props, ancestors) => {
    if (process.env.NODE_ENV !== "production") {
      // Asset resources hoist to <head>, so their fiber position is not
      // their DOM position; the server exempts them the same way.
      if (assetResourceFromHostProps(type, props) !== null) return;
      validateInstanceNesting(type, ancestors);
    }
  },
  validateTextNesting: (text, ancestors) => {
    if (process.env.NODE_ENV !== "production") {
      validateTextNesting(text, ancestors);
    }
  },
  containerType: (container) =>
    isElementNode(container) ? elementName(container) : null,
  appendInitialChild: (parent, child) => {
    parent.appendChild(child);
    // Render-phase assembly: the select is not live yet, so applying its
    // default to options that assemble after it is always safe. Only
    // option-bearing children can change a selection.
    if (isElementNode(child) && optionLike(child)) {
      updateParentSelect(child, true);
    }
  },
  finalizeInitialInstance: (instance, props) =>
    updateElement(instance, {}, props, { initial: true }),
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
    assetResourceFromHostProps(type, props) !== null,
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
      detachSubtree(child as Element | Text);
      container.removeChild(child);
      child = next;
    }

    // A cleared container (hydration-mismatch recovery) detaches every
    // queued replayable event's target; drain them.
    queueMicrotask(replayQueuedEvents);
  },
  insertBefore: (parent, child, before) => {
    parent.insertBefore(child, before);
    // Live insertion: re-assert a controlled select's value, but never
    // re-apply an uncontrolled default — the user owns the live selection
    // (defaults are mount-time only, matching React).
    if (isElementNode(child) && optionLike(child)) updateParentSelect(child);
    attachSubtree(child as Element | Text);
  },
  removeChild: (parent, child) => {
    detachSubtree(child as Element | Text);
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
configureDomRefreshScheduler(renderer.scheduleRefresh);

export const flushSync = renderer.flushSync;

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
    node.getAttribute(ACTIVITY_TEMPLATE_ATTRIBUTE) !== null
  );
}

function isHydratableElement(
  node: Element | TextLike,
  type: string,
  props: Props,
): boolean {
  if (!isElementNode(node) || !("setAttribute" in node)) return false;
  if (elementName(node) !== type.toLowerCase()) return false;
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
  return isEmptyPropValue(props.unsafeHTML) ? null : props.unsafeHTML;
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

function optionLike(element: Element): boolean {
  const name = elementName(element);
  return name === "option" || name === "optgroup";
}

function shouldRestoreControlledFormState(type: string, props: Props): boolean {
  return (
    (type === "input" || type === "textarea" || type === "select") &&
    (props.value !== undefined || props.checked !== undefined)
  );
}

export type { Container };
