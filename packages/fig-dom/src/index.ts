import { type FigNode, Fragment, Suspense, transition } from "@bgub/fig";
import {
  createRenderer,
  type FigRoot,
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
import { updateElement } from "./props.ts";

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
  commitUpdate: updateElement,
};

const renderer = createRenderer(hostConfig);
setEventBatching(renderer.batchedUpdates);

export const batchedUpdates = renderer.batchedUpdates;
export const flushSync = renderer.flushSync;

export function createRoot(container: Container): FigRoot {
  registerRoot(container);
  return renderer.createRoot(container);
}

export function render(children: FigNode, container: Container): FigRoot {
  const root = createRoot(container);
  root.render(children);
  return root;
}

export { Fragment, Suspense, transition };
