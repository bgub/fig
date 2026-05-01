import {
  type Dispatch,
  type ElementType,
  type FigContext,
  type FigElement,
  type FigNode,
  Fragment,
  isContext,
  isSuspense,
  isValidElement,
  type Props,
  type RenderDispatcher,
  type SetStateAction,
  setCurrentDispatcher,
} from "@bgub/fig";
import {
  hasRenderableChild,
  isVoidElement,
  writeElementEnd,
  writeElementStart,
  writeText,
} from "./html.ts";
import {
  createServerRenderBuffer,
  type ServerPayloadChunk,
  type ServerRenderSinks,
} from "./sinks.ts";

export interface ServerRenderRequest {
  signal?: AbortSignal;
}

export interface ServerRenderOutput {
  html: string;
  payload: ServerPayloadChunk[];
}

interface RenderContext {
  contextValues: Map<FigContext<unknown>, unknown[]>;
  dispatcher: RenderDispatcher;
  sinks: ServerRenderSinks;
  signal?: AbortSignal;
}

type Component = (props: Props & { children?: FigNode }) => FigNode;
type Thenable<T = unknown> = PromiseLike<T> & object;

interface ThenableRecord<T> {
  status: "pending" | "fulfilled" | "rejected";
  value?: T;
  reason?: unknown;
}

const thenableRecords = new WeakMap<object, ThenableRecord<unknown>>();

export function renderServerTree(
  node: FigNode,
  request: ServerRenderRequest = {},
): ServerRenderOutput {
  const buffer = createServerRenderBuffer();
  const context = createRenderContext(buffer, request.signal);

  renderNode(node, context);

  return {
    html: buffer.readHtml(),
    payload: buffer.readPayload(),
  };
}

function createRenderContext(
  sinks: ServerRenderSinks,
  signal: AbortSignal | undefined,
): RenderContext {
  const context: RenderContext = {
    contextValues: new Map(),
    dispatcher: null as never,
    sinks,
    signal,
  };
  context.dispatcher = createServerDispatcher(context);
  return context;
}

function createBufferedContext(
  parent: RenderContext,
  sinks: ServerRenderSinks,
): RenderContext {
  return {
    ...parent,
    sinks,
  };
}

function createServerDispatcher(frame: RenderContext): RenderDispatcher {
  return {
    useState(initialState) {
      const value = resolveInitialState(initialState);
      const dispatch: Dispatch<SetStateAction<typeof value>> = () => {
        throw new Error("State updates are not allowed during server render.");
      };
      return [value, dispatch];
    },
    useReactive: noopEffect,
    useBeforePaint: noopEffect,
    useBeforeLayout: noopEffect,
    useOnMount: noopEffect,
    readContext(context) {
      return readContextValue(frame, context);
    },
    readPromise(promise) {
      return readThenable(promise);
    },
  };
}

function renderNode(node: FigNode, context: RenderContext): void {
  throwIfAborted(context.signal);

  if (Array.isArray(node)) {
    for (const child of node) {
      renderNode(child as FigNode, context);
    }
    return;
  }

  if (node === null || node === undefined || typeof node === "boolean") {
    return;
  }

  if (typeof node === "string" || typeof node === "number") {
    writeText(String(node), context.sinks.html);
    return;
  }

  if (!isValidElement(node)) throw invalidChildError(node);

  renderElement(node, context);
}

function renderElement(element: FigElement, context: RenderContext): void {
  const type = element.type;

  if (typeof type === "string") {
    renderHostElement(type, element.props, context);
    return;
  }

  if (type === Fragment) {
    renderNode(element.props.children, context);
    return;
  }

  if (isContext(type)) {
    renderContextProvider(type, element.props, context);
    return;
  }

  if (isSuspense(type)) {
    renderSuspense(element.props, context);
    return;
  }

  if (typeof type === "function") {
    renderFunctionComponent(type as Component, element.props, context);
    return;
  }

  throw new Error(
    `Unsupported Fig element type: ${describeElementType(type)}.`,
  );
}

function renderFunctionComponent(
  type: Component,
  props: Props,
  context: RenderContext,
): void {
  const previousDispatcher = setCurrentDispatcher(context.dispatcher);

  try {
    renderNode(type(props), context);
  } finally {
    setCurrentDispatcher(previousDispatcher);
  }
}

function renderContextProvider(
  context: FigContext<unknown>,
  props: Props,
  frame: RenderContext,
): void {
  const stack = contextStack(frame, context);
  stack.push(props.value);

  try {
    renderNode(props.children, frame);
  } finally {
    stack.pop();
  }
}

function renderSuspense(props: Props, context: RenderContext): void {
  const primary = createServerRenderBuffer();

  try {
    renderNode(props.children, createBufferedContext(context, primary));
    primary.flushTo(context.sinks);
  } catch (error) {
    if (!isThenable(error)) throw error;
    renderNode(props.fallback as FigNode, context);
  }
}

function renderHostElement(
  type: string,
  props: Props,
  context: RenderContext,
): void {
  const isVoid = isVoidElement(type);

  if (isVoid && hasRenderableChild(props.children)) {
    throw new Error(`Void element <${type}> cannot have children.`);
  }

  writeElementStart(type, props, context.sinks.html);
  if (isVoid) return;

  renderNode(props.children, context);
  writeElementEnd(type, context.sinks.html);
}

function readContextValue<T>(frame: RenderContext, context: FigContext<T>): T {
  const stack = frame.contextValues.get(context);
  if (stack !== undefined && stack.length > 0) {
    return stack[stack.length - 1] as T;
  }

  return context.defaultValue;
}

function readThenable<T>(thenable: PromiseLike<T>): T {
  const key = thenable as Thenable<T>;
  let record = thenableRecords.get(key) as ThenableRecord<T> | undefined;

  if (record === undefined) {
    record = { status: "pending" };
    thenableRecords.set(key, record);
    thenable.then(
      (value) => {
        record.status = "fulfilled";
        record.value = value;
      },
      (reason: unknown) => {
        record.status = "rejected";
        record.reason = reason;
      },
    );
  }

  if (record.status === "fulfilled") return record.value as T;
  if (record.status === "rejected") throw record.reason;
  throw key;
}

function contextStack(
  frame: RenderContext,
  context: FigContext<unknown>,
): unknown[] {
  let stack = frame.contextValues.get(context);

  if (stack === undefined) {
    stack = [];
    frame.contextValues.set(context, stack);
  }

  return stack;
}

function resolveInitialState<S>(initialState: S | (() => S)): S {
  return typeof initialState === "function"
    ? (initialState as () => S)()
    : initialState;
}

function noopEffect(_effect: (signal: AbortSignal) => undefined): void {
  // Effects do not run during server rendering.
}

function isThenable(value: unknown): value is Thenable {
  if (
    (typeof value !== "object" && typeof value !== "function") ||
    value === null
  ) {
    return false;
  }

  return typeof (value as PromiseLike<unknown>).then === "function";
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) throw abortReason(signal);
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new Error("Server render was aborted.");
}

function invalidChildError(value: unknown): Error {
  return new Error(
    `Invalid Fig child: ${describeInvalidChild(value)}. Render a string, number, element, array, boolean, null, or undefined.`,
  );
}

function describeInvalidChild(value: unknown): string {
  if (typeof value !== "object" || value === null) return typeof value;

  const keys = Object.keys(value);
  return keys.length === 0 ? "object" : `object with keys ${keys.join(", ")}`;
}

function describeElementType(type: ElementType): string {
  if (typeof type === "symbol") return String(type);
  if (typeof type === "function") return type.name || "anonymous function";
  return typeof type;
}
