import { type FigNode, Fragment, Suspense, transition } from "@bgub/fig";
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

export interface FigDomInstrumentation {
  createInstance: number;
  createTextInstance: number;
  appendInitialChild: number;
  finalizeInitialInstance: number;
  insertBefore: number;
  removeChild: number;
  commitUpdate: number;
  commitTextUpdate: number;
  commitHydratedInstance: number;
  attachBindSubtree: number;
  attachEventSubtree: number;
  removeBindSubtree: number;
  removeEventSubtree: number;
}

export type FigDomInstrumentationSnapshot = Readonly<FigDomInstrumentation>;

const instrumentation: FigDomInstrumentation = {
  createInstance: 0,
  createTextInstance: 0,
  appendInitialChild: 0,
  finalizeInitialInstance: 0,
  insertBefore: 0,
  removeChild: 0,
  commitUpdate: 0,
  commitTextUpdate: 0,
  commitHydratedInstance: 0,
  attachBindSubtree: 0,
  attachEventSubtree: 0,
  removeBindSubtree: 0,
  removeEventSubtree: 0,
};

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
  createInstance: (type) => {
    instrumentation.createInstance += 1;
    return document.createElement(type);
  },
  createTextInstance: (text) => {
    instrumentation.createTextInstance += 1;
    return document.createTextNode(text);
  },
  appendInitialChild: (parent, child) => {
    instrumentation.appendInitialChild += 1;
    parent.appendChild(child);
  },
  finalizeInitialInstance: (instance, props) => {
    instrumentation.finalizeInitialInstance += 1;
    updateElement(instance, {}, props);
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
      instrumentation.removeBindSubtree += 1;
      removeBindSubtree(child);
      instrumentation.removeEventSubtree += 1;
      removeEventSubtree(child);
      instrumentation.removeChild += 1;
      container.removeChild(child);
      child = next;
    }
  },
  insertBefore: (parent, child, before) => {
    instrumentation.insertBefore += 1;
    parent.insertBefore(child, before);
    instrumentation.attachBindSubtree += 1;
    attachBindSubtree(child);
    instrumentation.attachEventSubtree += 1;
    attachEventSubtree(child, rootFor(parent));
  },
  removeChild: (parent, child) => {
    instrumentation.removeBindSubtree += 1;
    removeBindSubtree(child);
    instrumentation.removeEventSubtree += 1;
    removeEventSubtree(child);
    instrumentation.removeChild += 1;
    parent.removeChild(child);
  },
  commitTextUpdate: (text, value) => {
    instrumentation.commitTextUpdate += 1;
    if (text.nodeValue !== value) text.nodeValue = value;
  },
  commitUpdate: (instance, previousProps, nextProps) => {
    instrumentation.commitUpdate += 1;
    updateElement(instance, previousProps, nextProps);
  },
  commitHydratedInstance: (instance, nextProps) => {
    instrumentation.commitHydratedInstance += 1;
    hydrateElement(instance, nextProps);
  },
};

const renderer = createRenderer(hostConfig);
setEventBatching(renderer.batchedUpdates);

export const batchedUpdates = renderer.batchedUpdates;
export const flushSync = renderer.flushSync;

export function resetInstrumentation(): void {
  for (const key of Object.keys(instrumentation) as Array<
    keyof FigDomInstrumentation
  >) {
    instrumentation[key] = 0;
  }
}

export function getInstrumentation(): FigDomInstrumentationSnapshot {
  return { ...instrumentation };
}

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

export { Fragment, Suspense, transition };
