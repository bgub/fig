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
        element.removeEventListener(type, previous as EventListener);
      }
      if (typeof next === "function") {
        element.addEventListener(type, next as EventListener);
      }
      continue;
    }

    setProperty(element, name, next);
  }
}

function setProperty(element: Element, name: string, value: unknown): void {
  const attribute = name === "className" ? "class" : name;

  if (name === "style" && typeof value === "object" && value !== null) {
    Object.assign((element as HTMLElement).style, value);
  } else if (value === null || value === undefined || value === false) {
    element.removeAttribute(attribute);
    if (name in element) {
      (element as unknown as Record<string, unknown>)[name] = "";
    }
  } else if (name in element && typeof value !== "object") {
    (element as unknown as Record<string, unknown>)[name] = value;
  } else {
    element.setAttribute(attribute, String(value));
  }
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

export { Fragment };
