import { afterEach, beforeEach } from "vite-plus/test";

export class FakeText {
  readonly nodeType = 3;
  parentNode: FakeElement | null = null;

  constructor(public nodeValue: string) {}

  get nextSibling(): FakeElement | FakeText | FakeComment | null {
    return nextSiblingOf(this);
  }

  get previousSibling(): FakeElement | FakeText | FakeComment | null {
    return previousSiblingOf(this);
  }

  get textContent(): string {
    return this.nodeValue;
  }
}

export class FakeComment {
  readonly nodeType = 8;
  parentNode: FakeElement | null = null;

  constructor(public data: string) {}

  get nextSibling(): FakeElement | FakeText | FakeComment | null {
    return nextSiblingOf(this);
  }

  get previousSibling(): FakeElement | FakeText | FakeComment | null {
    return previousSiblingOf(this);
  }

  get nodeValue(): string {
    return this.data;
  }

  set nodeValue(value: string) {
    this.data = value;
  }

  get textContent(): string {
    return "";
  }
}

interface FakeListener {
  capture: boolean;
  listener: EventListener;
  once?: boolean;
}

type FakeStyle = Record<string, string> & {
  readonly length: number;
  item(index: number): string;
  removeProperty(name: string): void;
  setProperty(name: string, value: string): void;
};

// Models the platform: native events that do not bubble. Deliberately
// independent of events.ts's delegation tables — the fake must mirror real
// browsers, not the implementation, so fidelity gaps surface in tests.
const nonBubblingEvents = new Set([
  "abort",
  "blur",
  "cancel",
  "canplay",
  "canplaythrough",
  "close",
  "durationchange",
  "emptied",
  "encrypted",
  "ended",
  "error",
  "focus",
  "invalid",
  "load",
  "loadeddata",
  "loadedmetadata",
  "loadstart",
  "mouseenter",
  "mouseleave",
  "pause",
  "play",
  "playing",
  "pointerenter",
  "pointerleave",
  "progress",
  "ratechange",
  "resize",
  "scroll",
  "scrollend",
  "seeked",
  "seeking",
  "stalled",
  "suspend",
  "timeupdate",
  "toggle",
  "volumechange",
  "waiting",
]);
const xlinkNamespace = "http://www.w3.org/1999/xlink";

export class FakeElement {
  readonly nodeType = 1;
  childNodes: Array<FakeElement | FakeText | FakeComment> = [];
  attributes: Record<string, string> = {};
  dataset: Record<string, string> = {};
  listenerSets: Record<string, FakeListener[]> = {};
  listeners: Record<string, EventListener> = {};
  parentNode: FakeElement | null = null;
  style: FakeStyle = createFakeStyle();
  checked = false;
  defaultChecked = false;
  defaultValue = "";
  multiple = false;
  selected = false;
  value = "";
  private innerHTMLValue: string | null = null;

  constructor(
    public tagName: string,
    public namespaceURI = "http://www.w3.org/1999/xhtml",
  ) {}

  get localName(): string {
    return this.tagName;
  }

  get firstChild(): FakeElement | FakeText | FakeComment | null {
    return this.childNodes[0] ?? null;
  }

  get nextSibling(): FakeElement | FakeText | FakeComment | null {
    return nextSiblingOf(this);
  }

  get previousSibling(): FakeElement | FakeText | FakeComment | null {
    return previousSiblingOf(this);
  }

  appendChild(
    node: FakeElement | FakeText | FakeComment,
  ): FakeElement | FakeText | FakeComment {
    this.innerHTMLValue = null;
    node.parentNode?.removeChild(node);
    this.childNodes.push(node);
    node.parentNode = this;
    return node;
  }

  insertBefore(
    node: FakeElement | FakeText | FakeComment,
    child: FakeElement | FakeText | FakeComment | null,
  ): FakeElement | FakeText | FakeComment {
    this.innerHTMLValue = null;
    if (child === null) {
      return this.appendChild(node);
    }

    // Validate the anchor BEFORE detaching the node, like real DOM: a
    // failed insert must not mutate the tree. Real browsers throw here; a
    // lenient fake hides exactly the stale-anchor reconciler bug class.
    const index = this.childNodes.indexOf(child);
    if (index === -1) {
      throw notFoundError("insertBefore anchor is not a child of this element");
    }

    node.parentNode?.removeChild(node);
    // Re-resolve: removing the node may have shifted the anchor's index.
    this.childNodes.splice(this.childNodes.indexOf(child), 0, node);
    node.parentNode = this;
    return node;
  }

  removeChild(
    node: FakeElement | FakeText | FakeComment,
  ): FakeElement | FakeText | FakeComment {
    this.innerHTMLValue = null;
    const index = this.childNodes.indexOf(node);

    if (index === -1) {
      throw notFoundError("removeChild node is not a child of this element");
    }

    this.childNodes.splice(index, 1);
    node.parentNode = null;
    return node;
  }

  setAttribute(name: string, value: string): void {
    this.attributes[name] = value;
  }

  setAttributeNS(namespace: string, name: string, value: string): void {
    this.setAttribute(namespacedAttributeName(namespace, name), value);
  }

  getAttribute(name: string): string | null {
    return this.attributes[name] ?? null;
  }

  removeAttribute(name: string): void {
    delete this.attributes[name];
  }

  removeAttributeNS(namespace: string, name: string): void {
    this.removeAttribute(namespacedAttributeName(namespace, name));
  }

  addEventListener(
    name: string,
    listener: EventListener,
    options?: AddEventListenerOptions | boolean,
  ): void {
    const capture = captureOption(options);
    const once = typeof options === "object" && options?.once === true;
    const signal = typeof options === "object" ? options?.signal : undefined;

    // Real DOM ignores duplicate (listener, capture) registrations.
    if (
      this.listenerSets[name]?.some(
        (current) =>
          current.listener === listener && current.capture === capture,
      )
    ) {
      return;
    }

    if (signal?.aborted === true) return;

    this.listenerSets[name] ??= [];
    this.listenerSets[name].push({
      capture,
      listener,
      once,
    });
    signal?.addEventListener("abort", () =>
      this.removeEventListener(name, listener, { capture }),
    );
    this.listeners[name] = (event) => {
      for (const current of this.listenerSets[name] ?? []) {
        current.listener(event);
      }
    };
  }

  removeEventListener(
    name: string,
    listener: EventListener,
    options?: AddEventListenerOptions | boolean,
  ): void {
    const listeners = this.listenerSets[name];
    if (listeners === undefined) return;

    this.listenerSets[name] = listeners.filter(
      (current) =>
        current.listener !== listener ||
        current.capture !== captureOption(options),
    );
    if (this.listenerSets[name].length === 0) {
      delete this.listenerSets[name];
      delete this.listeners[name];
    }
  }

  dispatch(name: string): void {
    const path: FakeElement[] = [];
    path.push(this);
    for (
      let element = this.parentNode;
      element !== null;
      element = element.parentNode
    ) {
      path.push(element);
    }

    const event = {
      cancelBubble: false,
      immediateStopped: false,
      composedPath: () => path,
      target: this,
      type: name,
      stopPropagation(this: { cancelBubble: boolean }) {
        this.cancelBubble = true;
      },
      stopImmediatePropagation(this: {
        cancelBubble: boolean;
        immediateStopped: boolean;
      }) {
        this.cancelBubble = true;
        this.immediateStopped = true;
      },
    } as unknown as Event;

    for (const element of path.toReversed()) {
      element.invoke(name, event, true);
      if (event.cancelBubble) return;
    }

    for (const element of path) {
      element.invoke(name, event, false);
      if (event.cancelBubble || nonBubblingEvents.has(name)) return;
    }
  }

  invoke(name: string, event: Event, capture: boolean): void {
    // Snapshot: once/signal removals (and handler-driven changes) mutate the
    // live set mid-dispatch, exactly like real DOM listener semantics.
    const snapshot = [...(this.listenerSets[name] ?? [])];
    for (const current of snapshot) {
      if (current.capture !== capture) continue;
      if (!this.listenerSets[name]?.includes(current)) continue;
      if (
        (event as unknown as { immediateStopped?: boolean })
          .immediateStopped === true
      ) {
        return;
      }

      if (current.once) {
        this.removeEventListener(name, current.listener, {
          capture: current.capture,
        });
      }
      current.listener(event);
    }
  }

  get textContent(): string {
    if (this.innerHTMLValue !== null) return this.innerHTMLValue;
    return this.childNodes.map((child) => child.textContent).join("");
  }

  set textContent(value: string) {
    this.innerHTMLValue = null;
    for (const child of this.childNodes) child.parentNode = null;
    this.childNodes = [];

    if (value !== "") {
      const text = new FakeText(value);
      text.parentNode = this;
      this.childNodes.push(text);
    }
  }

  get innerHTML(): string {
    return this.innerHTMLValue ?? this.textContent;
  }

  set innerHTML(value: string) {
    for (const child of this.childNodes) child.parentNode = null;
    this.childNodes = [];
    this.innerHTMLValue = value;
  }
}

export const delay = () => new Promise((resolve) => setTimeout(resolve, 20));

function createFakeStyle(): FakeStyle {
  const style = {} as FakeStyle;
  Object.defineProperties(style, {
    item: {
      value: (index: number) => styleNames(style)[index] ?? "",
    },
    length: {
      get: () => styleNames(style).length,
    },
    removeProperty: {
      value: (name: string) => {
        style[name] = "";
      },
    },
    setProperty: {
      value: (name: string, value: string) => {
        style[name] = value;
      },
    },
  });
  return style;
}

function styleNames(style: Record<string, string>): string[] {
  return Object.keys(style).filter((name) => style[name] !== "");
}

function namespacedAttributeName(namespace: string, name: string): string {
  return namespace === xlinkNamespace && name === "href" ? "xlink:href" : name;
}

export function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (reason?: unknown) => void = () => undefined;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, reject, resolve };
}

export function installFakeDocument(): void {
  const documentValue = globalThis.document;

  beforeEach(() => {
    globalThis.document = {
      createElement: (tagName: string) => new FakeElement(tagName),
      createElementNS: (namespace: string, tagName: string) =>
        new FakeElement(tagName, namespace),
      createTextNode: (value: string) => new FakeText(value),
      createComment: (value: string) => new FakeComment(value),
      // Real documents have a head, so the document-resource registry is
      // active by default instead of silently no-oping in every test.
      head: new FakeElement("head"),
    } as unknown as Document;
  });

  afterEach(() => {
    globalThis.document = documentValue;
  });
}

function notFoundError(message: string): Error {
  const error = new Error(`NotFoundError: ${message}`);
  error.name = "NotFoundError";
  return error;
}

function captureOption(options?: AddEventListenerOptions | boolean): boolean {
  return typeof options === "boolean" ? options : options?.capture === true;
}

function nextSiblingOf(
  node: FakeElement | FakeText | FakeComment,
): FakeElement | FakeText | FakeComment | null {
  const siblings = node.parentNode?.childNodes;
  if (siblings === undefined) return null;

  return siblings[siblings.indexOf(node) + 1] ?? null;
}

function previousSiblingOf(
  node: FakeElement | FakeText | FakeComment,
): FakeElement | FakeText | FakeComment | null {
  const siblings = node.parentNode?.childNodes;
  if (siblings === undefined) return null;

  return siblings[siblings.indexOf(node) - 1] ?? null;
}
