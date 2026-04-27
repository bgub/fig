import { visitElementSubtree } from "./tree.ts";

export type Bind<T extends Element = Element> = (
  node: T,
  signal: AbortSignal,
) => void;

interface BindSlot {
  callback: Bind;
  controller: AbortController | null;
}

const bindSlots = new WeakMap<Element, BindSlot>();

export function updateBind(element: Element, value: unknown): void {
  const callback = bindCallback(value);
  const slot = bindSlots.get(element);

  if (callback === null) {
    if (slot !== undefined) removeBindSlot(slot);
    bindSlots.delete(element);
    return;
  }

  if (slot === undefined) {
    const nextSlot: BindSlot = { callback, controller: null };
    bindSlots.set(element, nextSlot);
    attachBindSlot(element, nextSlot);
  } else if (slot.callback !== callback) {
    removeBindSlot(slot);
    slot.callback = callback;
    attachBindSlot(element, slot);
  }
}

export function attachBindSubtree(node: Element | Text): void {
  visitElementSubtree(node, (element) => {
    const slot = bindSlots.get(element);
    if (slot !== undefined) attachBindSlot(element, slot);
  });
}

export function removeBindSubtree(node: Element | Text): void {
  visitElementSubtree(node, (element) => {
    const slot = bindSlots.get(element);
    if (slot !== undefined) {
      removeBindSlot(slot);
      bindSlots.delete(element);
    }
  });
}

function attachBindSlot(element: Element, slot: BindSlot): void {
  if (slot.controller !== null || element.parentNode === null) return;

  slot.controller = new AbortController();
  slot.callback(element, slot.controller.signal);
}

function removeBindSlot(slot: BindSlot): void {
  slot.controller?.abort();
  slot.controller = null;
}

function bindCallback(value: unknown): Bind | null {
  if (value === null || value === undefined || value === false) return null;
  if (typeof value === "function") return value as Bind;
  throw new Error("The bind prop must be a function.");
}
