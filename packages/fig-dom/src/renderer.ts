import type { Props } from "@bgub/fig";
import {
  ACTIVITY_TEMPLATE_ATTRIBUTE,
  HYDRATION_SKIP_ATTRIBUTE,
  validateInstanceNesting,
  validateTextNesting,
} from "@bgub/fig/internal";
import { createRenderer, type HostConfig } from "@bgub/fig-reconciler";
import {
  acquireDocumentResource,
  adoptDocumentResource,
  commitAssetResources,
  releaseDocumentResource,
  updateHoistedResource,
} from "./asset-resources.ts";
import { attachSubtree, detachSubtree } from "./attachment.ts";
import { resumeBind, suspendBind } from "./bind.ts";
import {
  type Container,
  disableRootHydration,
  registerPortalContainer,
  removePortalContainer,
  replayQueuedEvents,
  setEventBatching,
} from "./events.ts";
import {
  shouldRestoreControlledFormState,
  updateParentSelect,
} from "./form-controls.ts";
import { hydrateElement, updateElement } from "./props.ts";
import { configureDomRefreshScheduler } from "./refresh-internal.ts";
import {
  enclosingSuspenseBoundaryStart,
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
import { viewTransitionHostConfig } from "./view-transition.ts";

type TextLike = Text | Comment;
type HydrationNode = Element | TextLike | DocumentType;
type RetriableSuspenseMarker = TextLike & { __figRetry?: () => void };

declare const __FIG_DEV__: boolean | undefined;

const __DEV__ = typeof __FIG_DEV__ === "boolean" ? __FIG_DEV__ : false;

const hostConfig: HostConfig<Container, Element, TextLike> = {
  createInstance: createDomElement,
  createTextInstance: (text) => document.createTextNode(text),
  // The dev gates below run at call time (never at module scope, which
  // would throw on import wherever bundler defines don't apply). They must
  // stay in block form — `if (dev) { validate() }` — not early-return form:
  // esbuild only eliminates the constant branch (and with it the dom-nesting
  // module import) at parse time, before symbol retention is decided; code
  // after an `if (prod) return` keeps the import referenced and ships the
  // whole module in production bundles.
  validateInstanceNesting: (type, _props, ancestors) => {
    if (__DEV__) {
      validateInstanceNesting(type, ancestors);
    }
  },
  validateTextNesting: (text, ancestors) => {
    if (__DEV__) {
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
  getFirstHydratableChild: hydratableFirstChild,
  getNextHydratableSibling: (node) =>
    nextHydratableNode(node.nextSibling as HydrationNode | null),
  canHydrateInstance: isHydratableElement,
  canHydrateTextInstance: (node, text, suppressHydrationWarning) =>
    isHydratableText(node) &&
    (suppressHydrationWarning === true || node.nodeValue === text),
  // Hoisted asset resources never appear at their fiber's server position
  // (the server registers them and emits nothing inline): hydration must not
  // match them against the DOM cursor, and commit acquires/releases them in
  // the head registry instead of inserting/removing at the fiber position.
  resolveHoistedInstance: (type, props, parent) => {
    if (namespaceFor(type, parent) !== htmlNamespace) return null;
    return adoptDocumentResource(type, props);
  },
  commitHoistedInstance: acquireDocumentResource,
  commitAssetResources,
  removeHoistedInstance: releaseDocumentResource,
  updateHoistedInstance: updateHoistedResource,
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
  commitUpdate: updateElement,
  commitHydratedInstance: hydrateElement,
  getActivityBoundary: activityBoundary,
  getFirstActivityHydratable: (boundary) =>
    nextHydratableNode(
      (activityTemplateContent(boundary).firstChild ??
        null) as HydrationNode | null,
    ),
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
      typeof display === "string" ? display : "",
    );
    resumeBind(instance);
  },
  hideTextInstance: (text) => {
    text.nodeValue = "";
  },
  unhideTextInstance: (text, value) => {
    if (text.nodeValue !== value) text.nodeValue = value;
  },
  getSuspenseBoundary: suspenseBoundaryFor,
  getEnclosingSuspenseBoundaryStart: enclosingSuspenseBoundaryStart,
  isTargetWithinSuspenseBoundary: isWithinSuspenseBoundary,
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
  completeRootHydration: (container) => {
    disableRootHydration(container as Container);
    // Non-discrete early events blocked on the pre-commit shell have no
    // boundary hook to re-drain them; root completion is their backstop.
    queueMicrotask(replayQueuedEvents);
  },
  preparePortalContainer: registerPortalContainer,
  removePortalContainer,
  viewTransition: viewTransitionHostConfig,
};

export const domRenderer = createRenderer(hostConfig);
setEventBatching(domRenderer.batchedUpdates);
configureDomRefreshScheduler(domRenderer.scheduleRefresh);

// Real templates hold children in a content fragment; test doubles hold
// them directly.
function activityTemplateContent(boundary: Element): ParentNode {
  return "content" in boundary
    ? (boundary.content as ParentNode)
    : (boundary as ParentNode);
}

function activityBoundary(node: Element | TextLike): Element | null {
  return elementName(node) === "template" &&
    "getAttribute" in node &&
    node.getAttribute(ACTIVITY_TEMPLATE_ATTRIBUTE) !== null
    ? node
    : null;
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
  _props: Props,
  parent: Container | Element,
): Element {
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

  return nextHydratableNode(parent.firstChild as HydrationNode | null);
}

// The server writes a `<!--,-->` comment between adjacent text nodes that
// come from different fibers (browser parsing would otherwise merge them
// into a single DOM text node while the client keeps one text fiber each —
// see TEXT_SEPARATOR in @bgub/fig-server). The hydration cursor steps over
// separators when advancing; only comments with exactly this data are
// skipped, so the fig:suspense marker comments are never affected.
// A DocumentType is document metadata rather than content represented by a
// fiber, so full-document hydration advances through it to the existing html
// element. This also matters when a root Suspense marker precedes the doctype.
// Server-owned elements carrying the shared skip marker likewise have no
// in-tree hydration fiber; the DOM renderer need not know why each exists.
const TEXT_SEPARATOR_DATA = ",";

function nextHydratableNode(
  node: HydrationNode | null,
): Element | TextLike | null {
  let current = node;
  while (
    current !== null &&
    (isTextSeparator(current) ||
      current.nodeType === 10 ||
      isServerOwnedNode(current))
  ) {
    current = current.nextSibling as HydrationNode | null;
  }
  return current as Element | TextLike | null;
}

function isServerOwnedNode(node: HydrationNode): boolean {
  return (
    isElementNode(node) && node.getAttribute(HYDRATION_SKIP_ATTRIBUTE) !== null
  );
}

function isTextSeparator(node: HydrationNode): boolean {
  return (
    "nodeType" in node &&
    node.nodeType === 8 &&
    (node as Comment).data === TEXT_SEPARATOR_DATA
  );
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
  return typeof expected !== "string" || "innerHTML" in element;
}

function isHydratableText(node: Element | TextLike): boolean {
  if ("nodeType" in node && node.nodeType !== 3) return false;
  return !("setAttribute" in node) && "nodeValue" in node;
}

function optionLike(element: Element): boolean {
  const name = elementName(element);
  return name === "option" || name === "optgroup";
}
