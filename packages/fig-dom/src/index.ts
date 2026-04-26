import { Fragment, type Props } from "@bgub/fig";
import { createRenderer, type HostConfig } from "@bgub/fig-reconciler";

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
} from "@bgub/fig-reconciler";

type Container = Element | DocumentFragment;
type ListenerMap = Map<EventListener, EventListener>;

const hostConfig: HostConfig<Container, Element, Text> = {
  createInstance: (type) => document.createElement(type),
  createTextInstance: (text) => document.createTextNode(text),
  insertBefore: (parent, child, before) => parent.insertBefore(child, before),
  removeChild: (parent, child) => parent.removeChild(child),
  commitTextUpdate: (text, value) => {
    if (text.nodeValue !== value) text.nodeValue = value;
  },
  commitUpdate: updateElement,
};

const renderer = createRenderer(hostConfig);
const eventListeners = new WeakMap<Element, ListenerMap>();

export const batchedUpdates = renderer.batchedUpdates;
export const createRoot = renderer.createRoot;
export const render = renderer.render;
export const flushSync = renderer.flushSync;

function updateElement(
  element: Element,
  previousProps: Props,
  nextProps: Props,
): void {
  const names = new Set([
    ...Object.keys(previousProps),
    ...Object.keys(nextProps),
  ]);

  for (const name of names) {
    if (reserved(name)) continue;

    const previous = previousProps[name];
    const next = nextProps[name];

    if (previous === next) continue;

    if (event(name)) {
      const type = eventType(name);
      if (typeof previous === "function") {
        element.removeEventListener(
          type,
          eventListener(element, previous as EventListener),
        );
      }
      if (typeof next === "function") {
        element.addEventListener(
          type,
          eventListener(element, next as EventListener),
        );
      }
      continue;
    }

    setProperty(element, name, previous, next);
  }
}

function setProperty(
  element: Element,
  name: string,
  previous: unknown,
  next: unknown,
): void {
  const attribute = name === "className" ? "class" : name;

  if (name === "style") {
    setStyle(element, previous, next);
  } else if (next === null || next === undefined || next === false) {
    element.removeAttribute(attribute);
    if (name in element) {
      (element as unknown as Record<string, unknown>)[name] = "";
    }
  } else if (name in element && typeof next !== "object") {
    (element as unknown as Record<string, unknown>)[name] = next;
  } else {
    element.setAttribute(attribute, String(next));
  }
}

function setStyle(element: Element, previous: unknown, next: unknown): void {
  const style = (element as HTMLElement).style as unknown as Record<
    string,
    unknown
  >;
  const previousStyle = styleProps(previous);
  const nextStyle = styleProps(next);

  for (const name of Object.keys(previousStyle)) {
    if (!(name in nextStyle)) style[name] = "";
  }

  Object.assign(style, nextStyle);
}

function styleProps(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? value : {};
}

function reserved(name: string): boolean {
  return name === "children" || name === "key";
}

function event(name: string): boolean {
  return /^on[A-Z]/.test(name);
}

function eventType(name: string): string {
  return name.slice(2).toLowerCase();
}

function eventListener(
  element: Element,
  listener: EventListener,
): EventListener {
  const elementListeners = listenerMap(element);
  let wrapped = elementListeners.get(listener);

  if (wrapped === undefined) {
    wrapped = (event) => batchedUpdates(() => listener.call(element, event));
    elementListeners.set(listener, wrapped);
  }

  return wrapped;
}

function listenerMap(element: Element): ListenerMap {
  let listeners = eventListeners.get(element);
  if (listeners === undefined) {
    listeners = new Map();
    eventListeners.set(element, listeners);
  }
  return listeners;
}

export { Fragment };
