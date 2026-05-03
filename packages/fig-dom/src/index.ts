import {
  ErrorBoundary,
  type FigNode,
  Fragment,
  Suspense,
  transition,
} from "@bgub/fig";
import {
  createRenderer,
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

const hostConfig: HostConfig<Container, Element, Text> = {
  createInstance: (type) => document.createElement(type),
  createTextInstance: (text) => document.createTextNode(text),
  appendInitialChild: (parent, child) => parent.appendChild(child),
  finalizeInitialInstance: (instance, props) =>
    updateElement(instance, {}, props),
  setTextContent: (instance, text) => {
    if (instance.textContent !== text) instance.textContent = text;
  },
  getFirstHydratableChild: (parent) =>
    parent.firstChild as Element | Text | null,
  getNextHydratableSibling: (node) => node.nextSibling as Element | Text | null,
  canHydrateInstance: (node, type) => isHydratableElement(node, type),
  canHydrateTextInstance: (node) => isHydratableText(node),
  clearContainer: (container) => {
    let child = container.firstChild as Element | Text | null;

    while (child !== null) {
      const next = child.nextSibling as Element | Text | null;
      removeBindSubtree(child);
      removeEventSubtree(child);
      container.removeChild(child);
      child = next;
    }
  },
  insertBefore: (parent, child, before) => {
    parent.insertBefore(child, before);
    attachBindSubtree(child);
    attachEventSubtree(child, rootFor(parent));
  },
  removeChild: (parent, child) => {
    removeBindSubtree(child);
    removeEventSubtree(child);
    parent.removeChild(child);
  },
  commitTextUpdate: (text, value) => {
    if (text.nodeValue !== value) text.nodeValue = value;
  },
  commitUpdate: (instance, previousProps, nextProps) =>
    updateElement(instance, previousProps, nextProps),
  commitHydratedInstance: (instance, nextProps) =>
    hydrateElement(instance, nextProps),
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
  registerRoot(container);
  return renderer.hydrateRoot(container, children, options);
}

export function render(children: FigNode, container: Container): FigRoot {
  registerRoot(container);
  return renderer.render(children, container);
}

function isHydratableElement(node: Element | Text, type: string): boolean {
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

function isHydratableText(node: Element | Text): boolean {
  if ("nodeType" in node && node.nodeType !== 3) return false;
  return !("setAttribute" in node) && "nodeValue" in node;
}

export { ErrorBoundary, Fragment, Suspense, transition };
