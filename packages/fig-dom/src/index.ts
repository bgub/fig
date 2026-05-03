import {
  ErrorBoundary,
  type FigNode,
  Fragment,
  Suspense,
  transition,
} from "@bgub/fig";
import {
  createRenderer,
  type DehydratedSuspenseBoundary,
  type FigRoot,
  type FigRootOptions,
  type HostConfig,
} from "@bgub/fig-reconciler";
import { attachBindSubtree, removeBindSubtree } from "./bind.ts";
import {
  attachEventSubtree,
  type Container,
  registerRoot,
  removeEventSubtree,
  rootFor,
  setEventBatching,
} from "./events.ts";
import { hydrateElement, updateElement } from "./props.ts";

type TextLike = Text | Comment;

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
  createInstance: (type) => document.createElement(type),
  createTextInstance: (text) => document.createTextNode(text),
  appendInitialChild: (parent, child) => parent.appendChild(child),
  finalizeInitialInstance: (instance, props) =>
    updateElement(instance, {}, props),
  setTextContent: (instance, text) => {
    if (instance.textContent !== text) instance.textContent = text;
  },
  getFirstHydratableChild: (parent) =>
    parent.firstChild as Element | TextLike | null,
  getNextHydratableSibling: (node) =>
    node.nextSibling as Element | TextLike | null,
  canHydrateInstance: (node, type) => isHydratableElement(node, type),
  canHydrateTextInstance: (node) => isHydratableText(node),
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
    parent.insertBefore(child, before);
    attachBindSubtree(child as Element | Text);
    attachEventSubtree(child as Element | Text, rootFor(parent));
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
  getSuspenseBoundary: (node) => suspenseBoundaryFor(node),
  isTargetWithinSuspenseBoundary: (target, boundary) =>
    isWithinSuspenseBoundary(target, boundary),
  commitHydratedSuspenseBoundary: (boundary) => {
    if (boundary.status === "completed" && !boundary.forceClientRender) {
      removeNode(boundary.start);
      removeNode(boundary.end);
      return;
    }

    removeSuspenseBoundaryRange(boundary);
  },
  removeDehydratedSuspenseBoundary: (boundary) => {
    removeSuspenseBoundaryRange(boundary);
  },
};

const renderer = createRenderer(hostConfig);
setEventBatching(renderer.batchedUpdates);

export const batchedUpdates = renderer.batchedUpdates;
export const flushSync = renderer.flushSync;

export type { FigRootOptions };

export function createRoot(
  container: Container,
  options?: FigRootOptions,
): FigRoot {
  registerRoot(container);
  return renderer.createRoot(container, options);
}

export function hydrateRoot(
  container: Container,
  children: FigNode,
  options?: FigRootOptions,
): FigRoot {
  registerRoot(container, (target, lane) =>
    renderer.hydrateTarget(container, target, lane),
  );
  return renderer.hydrateRoot(container, children, options);
}

export function render(children: FigNode, container: Container): FigRoot {
  registerRoot(container);
  return renderer.render(children, container);
}

function isHydratableElement(node: Element | TextLike, type: string): boolean {
  if ("nodeType" in node && node.nodeType !== 1) return false;
  if (!("setAttribute" in node)) return false;

  const name =
    "localName" in node && typeof node.localName === "string"
      ? node.localName
      : "tagName" in node && typeof node.tagName === "string"
        ? node.tagName
        : "";

  return name.toLowerCase() === type.toLowerCase();
}

function isHydratableText(node: Element | TextLike): boolean {
  if ("nodeType" in node && node.nodeType !== 3) return false;
  return !("setAttribute" in node) && "nodeValue" in node;
}

function suspenseBoundaryFor(
  node: Element | TextLike,
): DehydratedSuspenseBoundary<Element, TextLike> | null {
  if (!isComment(node)) return null;

  const marker = node.data;
  if (marker === "fig:suspense:completed") {
    return suspenseBoundary(node, "completed", null);
  }

  if (marker === "fig:suspense:client") {
    return suspenseBoundary(node, "client-rendered", null);
  }

  const pending = /^fig:suspense:pending:(.+)$/.exec(marker);
  if (pending !== null) {
    return suspenseBoundary(node, "pending", pending[1]);
  }

  return null;
}

function suspenseBoundary(
  start: TextLike,
  status: DehydratedSuspenseBoundary<Element, TextLike>["status"],
  id: string | null,
): DehydratedSuspenseBoundary<Element, TextLike> | null {
  const end = suspenseBoundaryEnd(start);
  if (end === null) return null;
  return { end, forceClientRender: false, id, start, status };
}

function suspenseBoundaryEnd(start: TextLike): TextLike | null {
  for (
    let node = start.nextSibling as Element | TextLike | null;
    node !== null;
    node = node.nextSibling as Element | TextLike | null
  ) {
    if (isComment(node) && node.data === "/fig:suspense") return node;
  }

  return null;
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

function isNode(value: unknown): value is Node {
  return typeof value === "object" && value !== null && "parentNode" in value;
}

export { ErrorBoundary, Fragment, Suspense, transition };
