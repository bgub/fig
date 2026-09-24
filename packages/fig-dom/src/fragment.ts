/** DOM operations on the committed first-level elements of a Fragment. */
export interface FragmentInstance {
  focus(options?: FocusOptions): void;
  focusLast(options?: FocusOptions): void;
  blur(): void;
  getClientRects(): DOMRect[];
  observeUsing(observer: IntersectionObserver | ResizeObserver): void;
  unobserveUsing(observer: IntersectionObserver | ResizeObserver): void;
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void;
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions,
  ): void;
}

type Observer = IntersectionObserver | ResizeObserver;
type FragmentBind = (
  instance: FragmentInstance,
  signal: AbortSignal,
) => undefined;
interface Listener {
  type: string;
  listener: EventListenerOrEventListenerObject;
  capture: boolean;
  options: AddEventListenerOptions;
  abort?: () => void;
}

declare const __FIG_DEV__: boolean | undefined;
const __DEV__ = typeof __FIG_DEV__ === "boolean" ? __FIG_DEV__ : false;

class DOMFragment implements FragmentInstance {
  elements: readonly Element[] = [];
  callback: FragmentBind | null = null;
  controller: AbortController | null = null;
  strictRan = false;
  private readonly observers = new Set<Observer>();
  private readonly listeners: Listener[] = [];

  update(elements: readonly Element[]): void {
    const previous = new Set(this.elements);
    const next = new Set(elements);
    for (const element of previous) {
      if (next.has(element)) continue;
      for (const observer of this.observers) observer.unobserve(element);
      for (const entry of this.listeners) {
        element.removeEventListener(entry.type, entry.listener, entry.capture);
      }
    }
    this.elements = elements;
    for (const element of next) {
      if (previous.has(element)) continue;
      for (const observer of this.observers) observer.observe(element);
      for (const entry of this.listeners) {
        element.addEventListener(entry.type, entry.listener, entry.options);
      }
    }
  }

  focus(options?: FocusOptions): void {
    this.focusEdge(false, options);
  }

  focusLast(options?: FocusOptions): void {
    this.focusEdge(true, options);
  }

  private focusEdge(last: boolean, options?: FocusOptions): void {
    const candidates = this.elements.flatMap((element) => [
      element,
      ...element.querySelectorAll("*"),
    ]);
    if (last) candidates.reverse();
    for (const element of candidates) {
      if (element.closest("[hidden], [inert]") !== null) continue;
      if (element.matches(':disabled, input[type="hidden"]')) continue;
      const focusable =
        element.hasAttribute("tabindex") ||
        ("tabIndex" in element &&
          typeof element.tabIndex === "number" &&
          element.tabIndex >= 0) ||
        ("isContentEditable" in element && element.isContentEditable === true);
      if (!focusable) continue;
      if (!("focus" in element) || typeof element.focus !== "function")
        continue;
      element.focus(options);
      if (element.ownerDocument.activeElement === element) return;
    }
  }

  blur(): void {
    for (const element of this.elements) {
      const active = element.ownerDocument.activeElement;
      if (
        active !== null &&
        element.contains(active) &&
        "blur" in active &&
        typeof active.blur === "function"
      ) {
        active.blur();
      }
    }
  }

  getClientRects(): DOMRect[] {
    return this.elements.flatMap((element) => [...element.getClientRects()]);
  }

  observeUsing(observer: Observer): void {
    if (this.observers.has(observer)) return;
    this.observers.add(observer);
    for (const element of this.elements) observer.observe(element);
  }

  unobserveUsing(observer: Observer): void {
    if (!this.observers.delete(observer)) return;
    for (const element of this.elements) observer.unobserve(element);
  }

  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void {
    const normalized =
      typeof options === "boolean" ? { capture: options } : { ...options };
    const capture = normalized.capture ?? false;
    if (
      normalized.signal?.aborted ||
      this.listeners.some(
        (entry) =>
          entry.type === type &&
          entry.listener === listener &&
          entry.capture === capture,
      )
    )
      return;
    const entry: Listener = { type, listener, options: normalized, capture };
    if (normalized.signal !== undefined) {
      entry.abort = () => this.removeEventListener(type, listener, capture);
      normalized.signal.addEventListener("abort", entry.abort, { once: true });
    }
    this.listeners.push(entry);
    for (const element of this.elements)
      element.addEventListener(type, listener, normalized);
  }

  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions,
  ): void {
    const capture =
      typeof options === "boolean" ? options : (options?.capture ?? false);
    const index = this.listeners.findIndex(
      (entry) =>
        entry.type === type &&
        entry.listener === listener &&
        entry.capture === capture,
    );
    if (index === -1) return;
    const [entry] = this.listeners.splice(index, 1);
    if (entry.abort !== undefined)
      entry.options.signal?.removeEventListener("abort", entry.abort);
    for (const element of this.elements)
      element.removeEventListener(type, listener, capture);
  }

  detach(): void {
    const controller = this.controller;
    this.controller = null;
    controller?.abort();
    for (const observer of this.observers) this.unobserveUsing(observer);
    while (this.listeners.length > 0) {
      const entry = this.listeners[0];
      this.removeEventListener(entry.type, entry.listener, entry.capture);
    }
  }
}

const fragments = new WeakMap<object, DOMFragment>();

export function commitFragment(
  owner: object,
  elements: readonly Element[],
  bind: unknown,
  hidden: boolean,
): void {
  let fragment = fragments.get(owner);
  if (fragment === undefined) {
    fragment = new DOMFragment();
    fragments.set(owner, fragment);
  }
  const callback = typeof bind === "function" ? (bind as FragmentBind) : null;
  if (hidden || callback !== fragment.callback) fragment.detach();
  fragment.callback = callback;
  fragment.update(elements);
  if (hidden || callback === null || fragment.controller !== null) return;
  const strict = __DEV__ && !fragment.strictRan;
  fragment.strictRan = true;
  fragment.controller = new AbortController();
  callback(fragment, fragment.controller.signal);
  if (strict) {
    fragment.detach();
    fragment.controller = new AbortController();
    callback(fragment, fragment.controller.signal);
  }
}

export function removeFragment(owner: object): void {
  const fragment = fragments.get(owner);
  fragments.delete(owner);
  if (fragment === undefined) return;
  fragment.detach();
  fragment.callback = null;
  fragment.update([]);
}
