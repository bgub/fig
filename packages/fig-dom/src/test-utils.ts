import { afterEach, beforeEach } from "vitest";

export class FakeText {
  readonly nodeType = 3;
  parentNode: FakeElement | null = null;

  constructor(public nodeValue: string) {}

  get nextSibling(): FakeElement | FakeText | null {
    return nextSiblingOf(this);
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
}

const nonBubblingEvents = new Set([
  "blur",
  "focus",
  "mouseenter",
  "mouseleave",
  "scroll",
]);

export class FakeElement {
  readonly nodeType = 1;
  childNodes: Array<FakeElement | FakeText | FakeComment> = [];
  attributes: Record<string, string> = {};
  dataset: Record<string, string> = {};
  listenerSets: Record<string, FakeListener[]> = {};
  listeners: Record<string, EventListener> = {};
  parentNode: FakeElement | null = null;
  style: Record<string, string> = {};
  checked = false;
  defaultChecked = false;
  defaultValue = "";
  multiple = false;
  selected = false;
  value = "";

  constructor(public tagName: string) {}

  get firstChild(): FakeElement | FakeText | FakeComment | null {
    return this.childNodes[0] ?? null;
  }

  get nextSibling(): FakeElement | FakeText | FakeComment | null {
    return nextSiblingOf(this);
  }

  appendChild(
    node: FakeElement | FakeText | FakeComment,
  ): FakeElement | FakeText | FakeComment {
    node.parentNode?.removeChild(node);
    this.childNodes.push(node);
    node.parentNode = this;
    return node;
  }

  insertBefore(
    node: FakeElement | FakeText | FakeComment,
    child: FakeElement | FakeText | FakeComment | null,
  ): FakeElement | FakeText | FakeComment {
    if (child === null) {
      return this.appendChild(node);
    }

    node.parentNode?.removeChild(node);
    const index = this.childNodes.indexOf(child);

    if (index === -1) {
      this.childNodes.push(node);
    } else {
      this.childNodes.splice(index, 0, node);
    }

    node.parentNode = this;
    return node;
  }

  removeChild(
    node: FakeElement | FakeText | FakeComment,
  ): FakeElement | FakeText | FakeComment {
    const index = this.childNodes.indexOf(node);

    if (index !== -1) {
      this.childNodes.splice(index, 1);
    }

    node.parentNode = null;
    return node;
  }

  setAttribute(name: string, value: string): void {
    this.attributes[name] = value;
  }

  removeAttribute(name: string): void {
    delete this.attributes[name];
  }

  addEventListener(
    name: string,
    listener: EventListener,
    options?: AddEventListenerOptions | boolean,
  ): void {
    this.listenerSets[name] ??= [];
    this.listenerSets[name].push({
      capture: captureOption(options),
      listener,
    });
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
    for (
      let element: FakeElement | null = this;
      element !== null;
      element = element.parentNode
    ) {
      path.push(element);
    }

    const event = {
      cancelBubble: false,
      composedPath: () => path,
      target: this,
      type: name,
      stopPropagation() {
        this.cancelBubble = true;
      },
    } as Event;

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
    for (const current of this.listenerSets[name] ?? []) {
      if (current.capture === capture) current.listener(event);
    }
  }

  get textContent(): string {
    return this.childNodes.map((child) => child.textContent).join("");
  }

  set textContent(value: string) {
    for (const child of this.childNodes) child.parentNode = null;
    this.childNodes = [];

    if (value !== "") {
      const text = new FakeText(value);
      text.parentNode = this;
      this.childNodes.push(text);
    }
  }
}

export const delay = () => new Promise((resolve) => setTimeout(resolve, 20));

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
      createTextNode: (value: string) => new FakeText(value),
      createComment: (value: string) => new FakeComment(value),
    } as unknown as Document;
  });

  afterEach(() => {
    globalThis.document = documentValue;
  });
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
