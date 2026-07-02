import { isEmptyPropValue } from "./tree.ts";

declare const process: { env: { NODE_ENV?: string } };

export type Bind<T extends Element = Element> = (
  node: T,
  signal: AbortSignal,
) => void;

interface BindSlot {
  callback: Bind;
  controller: AbortController | null;
  // Persists for the slot's lifetime; gates the dev-only strict re-run to
  // the first attach so callback changes and re-attachments run single.
  strictRan: boolean;
}

const bindSlots = new WeakMap<Element, BindSlot>();
// Elements inside hidden Activity trees: binds must not run while hidden.
// Keyed by element (not a slot flag) so a bind that first appears while its
// element is already hidden is covered too.
const suspendedBindElements = new WeakSet<Element>();

export function updateBind(element: Element, value: unknown): void {
  const callback = bindCallback(value);
  const slot = bindSlots.get(element);

  if (callback === null) {
    if (slot !== undefined) removeBindSlot(slot);
    bindSlots.delete(element);
    return;
  }

  if (slot === undefined) {
    const nextSlot: BindSlot = { callback, controller: null, strictRan: false };
    bindSlots.set(element, nextSlot);
    attachBindSlot(element, nextSlot);
  } else if (slot.callback !== callback) {
    removeBindSlot(slot);
    slot.callback = callback;
    attachBindSlot(element, slot);
  }
}

export function attachElementBind(element: Element): void {
  const slot = bindSlots.get(element);
  if (slot !== undefined) attachBindSlot(element, slot);
}

export function suspendBind(element: Element): void {
  suspendedBindElements.add(element);
  const slot = bindSlots.get(element);
  if (slot !== undefined) removeBindSlot(slot);
}

export function resumeBind(element: Element): void {
  suspendedBindElements.delete(element);
  const slot = bindSlots.get(element);
  if (slot !== undefined) attachBindSlot(element, slot);
}

export function detachElementBind(element: Element): void {
  const slot = bindSlots.get(element);
  if (slot !== undefined) {
    removeBindSlot(slot);
    bindSlots.delete(element);
  }
}

function attachBindSlot(element: Element, slot: BindSlot): void {
  if (
    slot.controller !== null ||
    element.parentNode === null ||
    suspendedBindElements.has(element)
  ) {
    return;
  }

  let runStrict = false;
  if (process.env.NODE_ENV !== "production") {
    // Marked before the callback so re-entrant attaches cannot re-enter the
    // strict cycle.
    runStrict = !slot.strictRan;
    slot.strictRan = true;
  }
  slot.controller = new AbortController();
  slot.callback(element, slot.controller.signal);
  if (process.env.NODE_ENV !== "production" && runStrict) {
    // Strict re-run: abort and re-invoke first-time binds so callbacks that
    // ignore their AbortSignal surface in development.
    removeBindSlot(slot);
    slot.controller = new AbortController();
    slot.callback(element, slot.controller.signal);
  }
}

function removeBindSlot(slot: BindSlot): void {
  slot.controller?.abort();
  slot.controller = null;
}

function bindCallback(value: unknown): Bind | null {
  if (isEmptyPropValue(value)) return null;
  if (typeof value === "function") return value as Bind;
  throw new Error("The bind prop must be a function.");
}
