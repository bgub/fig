import {
  DefaultLane,
  InputContinuousLane,
  type Lane,
  runWithPriority,
  SyncLane,
} from "./priority.ts";

export type Container = Element | DocumentFragment;
export type EventOptions = Pick<
  AddEventListenerOptions,
  "capture" | "once" | "passive"
>;
export type EventCallback<E extends Event = Event> = (
  event: E,
  signal: AbortSignal,
) => void;
type Batch = <T>(callback: () => T) => T;

export interface EventDescriptor<E extends Event = Event> {
  readonly $$typeof: symbol;
  readonly type: string;
  readonly callback: EventCallback<E>;
  readonly options?: EventOptions;
}

interface EventSlot {
  key: string;
  type: string;
  callback: EventCallback;
  options: Required<EventOptions>;
  controller: AbortController | null;
  element: Element | null;
  listener: EventListener | null;
  root: Container | null;
}

interface RootListener {
  count: number;
  listener: EventListener;
}

const EventDescriptorSymbol = Symbol.for("fig.event");
const eventSlots = new WeakMap<Element, EventSlot[]>();
const rootContainers = new WeakSet<Container>();
const rootListeners = new WeakMap<Container, Map<string, RootListener>>();
const discreteEvents = new Set([
  "beforeinput",
  "change",
  "click",
  "input",
  "keydown",
  "keyup",
  "pointerdown",
  "pointerup",
  "submit",
]);
const continuousEvents = new Set([
  "drag",
  "dragover",
  "mousemove",
  "pointermove",
  "scroll",
  "touchmove",
  "wheel",
]);
let batch: Batch = (callback) => callback();

export function setEventBatching(nextBatch: Batch): void {
  batch = nextBatch;
}

export function registerRoot(container: Container): void {
  rootContainers.add(container);
}

export function on<K extends keyof HTMLElementEventMap>(
  type: K,
  callback: EventCallback<HTMLElementEventMap[K]>,
  options?: EventOptions,
): EventDescriptor<HTMLElementEventMap[K]>;
export function on(
  type: string,
  callback: EventCallback,
  options?: EventOptions,
): EventDescriptor;
export function on(
  type: string,
  callback: EventCallback,
  options?: EventOptions,
): EventDescriptor {
  return { $$typeof: EventDescriptorSymbol, type, callback, options };
}

export function updateEvents(element: Element, value: unknown): void {
  const slots = eventSlotsFor(element);
  const descriptors = eventDescriptors(value);
  const root = rootFor(element);

  for (let index = 0; index < descriptors.length; index += 1) {
    const descriptor = descriptors[index];
    const options = normalizedOptions(descriptor.options);
    const key = eventKey(descriptor.type, options);
    const slot = slots[index];

    if (slot === undefined) {
      slots[index] = addEventSlot(element, root, descriptor, options, key);
    } else if (slot.key !== key) {
      removeEventSlot(slot);
      slots[index] = addEventSlot(element, root, descriptor, options, key);
    } else if (slot.callback !== descriptor.callback) {
      slot.callback = descriptor.callback as EventCallback;
    }
  }

  for (let index = slots.length - 1; index >= descriptors.length; index -= 1) {
    removeEventSlot(slots[index]);
  }

  slots.length = descriptors.length;
}

export function attachEventSubtree(
  node: Element | Text,
  root: Container | null,
): void {
  if (root === null) return;

  visitElementSubtree(node, (element) => {
    for (const slot of eventSlots.get(element) ?? []) {
      attachEventSlot(element, root, slot);
    }
  });
}

export function removeEventSubtree(node: Element | Text): void {
  visitElementSubtree(node, (element) => {
    for (const slot of eventSlots.get(element) ?? []) removeEventSlot(slot);
    eventSlots.delete(element);
  });
}

export function rootFor(node: Element | Text | Container): Container | null {
  for (let current: unknown = node; current !== null; ) {
    if (isContainer(current) && rootContainers.has(current)) return current;
    current = parentOf(current);
  }

  return null;
}

function addEventSlot(
  element: Element,
  root: Container | null,
  descriptor: EventDescriptor,
  options: Required<EventOptions>,
  key: string,
): EventSlot {
  const slot: EventSlot = {
    key,
    type: descriptor.type,
    callback: descriptor.callback as EventCallback,
    options,
    controller: null,
    element: null,
    listener: null,
    root: null,
  };
  attachEventSlot(element, root, slot);
  return slot;
}

function removeEventSlot(slot: EventSlot): void {
  detachEventSlot(slot);
  abortEventSlot(slot);
}

function dispatchRootEvent(
  root: Container,
  type: string,
  capture: boolean,
  passive: boolean,
  event: Event,
): void {
  const path = eventPath(root, event);
  const orderedPath = capture ? path.toReversed() : path;

  for (const element of orderedPath) {
    const slots = eventSlots.get(element);
    if (slots === undefined) continue;

    for (let index = 0; index < slots.length; index += 1) {
      const slot = slots[index];
      if (
        slot.root !== root ||
        slot.type !== type ||
        slot.options.capture !== capture ||
        slot.options.passive !== passive
      ) {
        continue;
      }

      dispatchEventSlot(element, slot, event);

      if (slot.options.once) {
        removeElementSlot(element, slots, index);
        index -= 1;
      }

      if (event.cancelBubble) return;
    }
  }
}

function dispatchEventSlot(
  element: Element,
  slot: EventSlot,
  event: Event,
): void {
  abortEventSlot(slot);
  slot.controller = new AbortController();
  const signal = slot.controller.signal;

  batch(() => {
    runWithPriority(eventLane(slot.type), () => {
      withCurrentTarget(event, element, (currentEvent) => {
        slot.callback(currentEvent, signal);
      });
    });
  });
}

function abortEventSlot(slot: EventSlot): void {
  slot.controller?.abort();
  slot.controller = null;
}

function eventDescriptors(value: unknown): EventDescriptor[] {
  if (value === null || value === undefined || value === false) return [];
  if (Array.isArray(value) && value.every(isEventDescriptor)) return value;
  throw new Error("The events prop must be an array of event descriptors.");
}

function isEventDescriptor(value: unknown): value is EventDescriptor {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as EventDescriptor).$$typeof === EventDescriptorSymbol
  );
}

function eventSlotsFor(element: Element): EventSlot[] {
  let slots = eventSlots.get(element);
  if (slots === undefined) {
    slots = [];
    eventSlots.set(element, slots);
  }
  return slots;
}

function attachEventSlot(
  element: Element,
  root: Container | null,
  slot: EventSlot,
): void {
  if (direct(slot.type)) {
    attachDirectEventSlot(element, slot);
  } else {
    attachDelegatedEventSlot(root, slot);
  }
}

function attachDirectEventSlot(element: Element, slot: EventSlot): void {
  if (slot.element === element) return;

  detachEventSlot(slot);
  slot.element = element;
  slot.listener = (event) => {
    dispatchEventSlot(element, slot, event);
    if (!slot.options.once) return;

    const slots = eventSlots.get(element);
    const index = slots?.indexOf(slot) ?? -1;
    if (slots !== undefined && index !== -1) {
      removeElementSlot(element, slots, index);
    }
  };
  element.addEventListener(slot.type, slot.listener, slot.options);
}

function attachDelegatedEventSlot(
  root: Container | null,
  slot: EventSlot,
): void {
  if (root === null || slot.root === root) return;

  detachEventSlot(slot);
  slot.root = root;

  const listeners = rootListenerMap(root);
  const key = rootListenerKey(slot);
  let rootListener = listeners.get(key);

  if (rootListener === undefined) {
    const capture = rootListenerCapture(slot);
    const { passive } = slot.options;
    const { type } = slot;
    rootListener = {
      count: 0,
      listener: (event) =>
        captureDelegated(type)
          ? dispatchFocusLikeEvent(root, type, passive, event)
          : dispatchRootEvent(root, type, capture, passive, event),
    };
    root.addEventListener(type, rootListener.listener, { capture, passive });
    listeners.set(key, rootListener);
  }

  rootListener.count += 1;
}

function detachEventSlot(slot: EventSlot): void {
  detachDirectEventSlot(slot);
  detachDelegatedEventSlot(slot);
}

function detachDirectEventSlot(slot: EventSlot): void {
  if (slot.element === null || slot.listener === null) return;

  slot.element.removeEventListener(slot.type, slot.listener, {
    capture: slot.options.capture,
  });
  slot.element = null;
  slot.listener = null;
}

function detachDelegatedEventSlot(slot: EventSlot): void {
  const root = slot.root;
  if (root === null) return;

  slot.root = null;
  const key = rootListenerKey(slot);
  const listeners = rootListeners.get(root);
  const rootListener = listeners?.get(key);

  if (rootListener === undefined) return;

  rootListener.count -= 1;

  if (rootListener.count === 0) {
    root.removeEventListener(slot.type, rootListener.listener, {
      capture: rootListenerCapture(slot),
    });
    listeners.delete(key);
  }
}

function removeElementSlot(
  element: Element,
  slots: EventSlot[],
  index: number,
): void {
  removeEventSlot(slots[index]);
  slots.splice(index, 1);
  if (slots.length === 0) eventSlots.delete(element);
}

function dispatchFocusLikeEvent(
  root: Container,
  type: string,
  passive: boolean,
  event: Event,
): void {
  dispatchRootEvent(root, type, true, passive, event);
  if (!event.cancelBubble) dispatchRootEvent(root, type, false, passive, event);
}

function rootListenerMap(root: Container): Map<string, RootListener> {
  let listeners = rootListeners.get(root);
  if (listeners === undefined) {
    listeners = new Map();
    rootListeners.set(root, listeners);
  }
  return listeners;
}

function rootListenerKey(slot: EventSlot): string {
  return `${slot.type}:${rootListenerCapture(slot)}:${slot.options.passive}`;
}

function rootListenerCapture(slot: EventSlot): boolean {
  return captureDelegated(slot.type) || slot.options.capture;
}

function eventPath(root: Container, event: Event): Element[] {
  const composedPath = event.composedPath?.();

  if (composedPath !== undefined) {
    const index = composedPath.indexOf(root);
    if (index !== -1) return composedPath.slice(0, index).filter(isElement);
  }

  const path: Element[] = [];
  for (let current: unknown = event.target; current !== root; ) {
    if (isElement(current)) path.push(current);
    current = parentOf(current);
    if (current === null) break;
  }

  return path;
}

function withCurrentTarget<T>(
  event: Event,
  currentTarget: Element,
  callback: (event: Event) => T,
): T {
  const previous = Object.getOwnPropertyDescriptor(event, "currentTarget");
  const changed = Reflect.defineProperty(event, "currentTarget", {
    configurable: true,
    value: currentTarget,
  });

  try {
    return callback(event);
  } finally {
    if (changed) {
      if (previous === undefined) {
        delete (event as unknown as { currentTarget?: EventTarget | null })
          .currentTarget;
      } else {
        Object.defineProperty(event, "currentTarget", previous);
      }
    }
  }
}

function normalizedOptions(options: EventOptions = {}): Required<EventOptions> {
  return {
    capture: options.capture === true,
    once: options.once === true,
    passive: options.passive === true,
  };
}

function eventKey(type: string, options: Required<EventOptions>): string {
  return `${type}:${options.capture}:${options.once}:${options.passive}`;
}

function eventLane(type: string): Lane {
  if (discreteEvents.has(type)) return SyncLane;
  if (continuousEvents.has(type)) return InputContinuousLane;
  return DefaultLane;
}

function direct(type: string): boolean {
  return type === "mouseenter" || type === "mouseleave" || type === "scroll";
}

function captureDelegated(type: string): boolean {
  return type === "blur" || type === "focus";
}

function visitElementSubtree(
  node: Element | Text,
  visitor: (element: Element) => void,
): void {
  if (isElement(node)) visitor(node);

  for (const child of Array.from(node.childNodes ?? [])) {
    visitElementSubtree(child as Element | Text, visitor);
  }
}

function isElement(node: unknown): node is Element {
  return typeof node === "object" && node !== null && "setAttribute" in node;
}

function isContainer(node: unknown): node is Container {
  return (
    typeof node === "object" &&
    node !== null &&
    "addEventListener" in node &&
    "childNodes" in node
  );
}

function parentOf(node: unknown): unknown {
  return typeof node === "object" && node !== null && "parentNode" in node
    ? node.parentNode
    : null;
}
