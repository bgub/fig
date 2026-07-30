import type { DataResourceKeyInput } from "@bgub/fig";
import {
  type AwaitedFigNode,
  type FigAssetResourceList,
  type FigClientReference,
  type FigContext,
  type FigDataHydrationEntry,
  type FigElement,
  type FigNode,
  Fragment,
  isValidElement,
  type Props,
} from "@bgub/fig";
import {
  checkpointPayloadGraph,
  clientOnlyHostBehavior,
  createRendererDataStore,
  createPayloadGraphEncodeContext,
  type DataStore,
  type DataStoreEntrySnapshot,
  definePayloadGraphElement,
  describeInvalidChild,
  encodePayloadDataEntries,
  encodePayloadValueWithGraph,
  isActivity,
  isAssets,
  isClientReference,
  isContext,
  isErrorBoundary,
  isPlainPayloadValue,
  isPortal,
  isSuspense,
  isThenable,
  isViewTransition,
  jsonPayloadCodec,
  type PayloadElementModel,
  type PayloadGraphEncodeContext,
  type PayloadModel,
  type PayloadRow,
  type PayloadSpecialModel,
  type RenderDispatcher,
  readThenable,
  rollbackPayloadGraph,
  serializePayloadArray,
  serializePayloadMap,
  serializePayloadPlainObject,
  serializePayloadSet,
  type SerializedAssetResource,
  setCurrentDataStore,
  setCurrentDispatcher,
  type Thenable,
} from "@bgub/fig/internal";
import { PayloadAssets } from "./payload-assets.ts";
import {
  type ContextValues,
  type StackFrame,
  cloneContextValues,
  componentStack,
  createStaticDispatcher,
  type Deferred,
  deferred,
  errorMessage,
  noLane,
  noop,
  streamFlowBlocked,
  streamHighWaterMark,
  withContextValue,
} from "./shared.ts";
import {
  imagePreloadFromHostProps,
  suppressesImagePreloads,
} from "./image-preloads.ts";
import type { ServerErrorInfo, ServerErrorPayload } from "./types.ts";

declare const __FIG_DEV__: boolean | undefined;

const __DEV__ = typeof __FIG_DEV__ === "boolean" ? __FIG_DEV__ : false;

export interface PayloadRenderResult {
  allReady: Promise<void>;
  contentType: string;
  stream: ReadableStream<Uint8Array>;
}

export type PayloadComponent = (
  props: Props & { children?: FigNode },
) => FigNode;

export interface PayloadRenderOptions {
  clientReferenceAssets?: (metadata: { id: string }) => FigAssetResourceList;
  componentAssets?: (
    type: PayloadComponent,
  ) => FigAssetResourceList | undefined;
  dataPartition?: DataResourceKeyInput;
  /**
   * Encoded bytes the result stream buffers before row flushing pauses until
   * the consumer reads (rendering itself never pauses; encoded rows wait
   * queued). Defaults to 65536; values below 1 are clamped to 1.
   */
  highWaterMark?: number;
  signal?: AbortSignal;
  /**
   * Decides what crosses the wire when a server render throws, mirroring the
   * HTML renderer's contract: the returned payload is authoritative. Without
   * a handler, development includes the error message and production sends
   * an empty payload.
   */
  onError?: (
    error: unknown,
    info: ServerErrorInfo,
  ) => ServerErrorPayload | undefined;
}

class PayloadRequestCancelledError extends Error {
  constructor() {
    super("Payload request cancelled.");
    this.name = "PayloadRequestCancelledError";
  }
}

type PayloadRequest = {
  allReady: Deferred<void>;
  assets: PayloadAssets;
  cleanupAbortListener: (() => void) | null;
  clientReferenceRows: Map<string, number>;
  componentAssets: PayloadRenderOptions["componentAssets"];
  controller: ReadableStreamDefaultController<Uint8Array> | null;
  dataStore: DataStore<object, null>;
  emittedDataKeys: Set<string>;
  graph: PayloadGraphEncodeContext;
  nextRowId: number;
  nextUseId: number;
  onError: PayloadRenderOptions["onError"];
  pendingDataSnapshots: Map<string, DataStoreEntrySnapshot>;
  pendingTasks: number;
  pingedTasks: Task[];
  queuedRows: Uint8Array[];
  // Reentrancy guard: enqueueing inside flushRows can synchronously invoke
  // the stream's pull handler, which must not restart the drain — queuedRows
  // is spliced only after the loop, so a reentrant pass would re-enqueue the
  // same rows.
  flushingRows: boolean;
  closed: boolean;
  workScheduled: boolean;
};

type Task = {
  contextValues: ContextValues;
  id: number;
  imagePreloadsSuppressed: boolean;
  stack: StackFrame | null;
} & TaskValue;

type TaskValue =
  | { kind: "node"; value: FigNode }
  | { kind: "node-promise"; value: Thenable<AwaitedFigNode> }
  | { kind: "promise"; value: Thenable };

type Component = PayloadComponent;

type RenderFrame = {
  contextValues: ContextValues;
  // Built lazily on the first function component; reused for the whole task
  // (the dispatcher reads context through the frame, so it stays current).
  dispatcher: RenderDispatcher | null;
  // Assets discovered during this attempt whose owning row is not yet known.
  // Assets rows carry `for` — the row id whose reveal depends on them — and
  // the owner is only decided at scope exit: a subtree that completes keeps
  // its assets with the enclosing row, while one that suspends or fails takes
  // the assets discovered inside it to its outlined row. Scope exits happen
  // within the same synchronous attempt, so buffering costs no wire latency.
  pendingAssets: SerializedAssetResource[];
  request: PayloadRequest;
  imagePreloadsSuppressed: boolean;
  stack: StackFrame | null;
};

const errorStacks = new WeakMap<object, StackFrame>();
type TreePropMode = "children" | "suspense" | null;
type OutlineKind = "lazy" | "promise";
type PayloadOutline = Extract<PayloadSpecialModel, { $fig: OutlineKind }>;

export function renderToPayloadStream(
  node: FigNode,
  options: PayloadRenderOptions = {},
): PayloadRenderResult {
  throwIfAborted(options.signal);

  const pendingDataSnapshots = new Map<string, DataStoreEntrySnapshot>();
  const request: PayloadRequest = {
    allReady: deferred<void>(),
    assets: new PayloadAssets(options.clientReferenceAssets),
    cleanupAbortListener: null,
    clientReferenceRows: new Map(),
    componentAssets: options.componentAssets,
    controller: null,
    dataStore: createRendererDataStore<object, null>({
      getLane: noLane,
      onEntryChange: (entry: DataStoreEntrySnapshot) => {
        pendingDataSnapshots.set(entry.canonicalKey, entry);
      },
      partition: options.dataPartition,
      schedule: noop,
    }),
    emittedDataKeys: new Set(),
    graph: createPayloadGraphEncodeContext(),
    nextRowId: 1,
    nextUseId: 0,
    onError: options.onError,
    pendingDataSnapshots,
    pendingTasks: 0,
    pingedTasks: [],
    queuedRows: [],
    flushingRows: false,
    closed: false,
    workScheduled: false,
  };
  // allReady also rejects through the stream when a consumer cancels (the
  // normal client-disconnect path); the pre-attached no-op handler keeps it
  // from becoming an unhandled rejection for callers that do not await it
  // (await-ers still observe the rejection).
  void request.allReady.promise.catch(noop);

  request.pingedTasks.push(
    createTask(
      request,
      0,
      { kind: "node", value: node },
      new Map(),
      false,
      null,
    ),
  );

  const stream = new ReadableStream<Uint8Array>(
    {
      start(controller) {
        request.controller = controller;
        flushRows(request);
      },
      pull() {
        // The consumer drained below the high-water mark: resume flushing
        // rows that queued while the flow was blocked.
        flushRows(request);
      },
      cancel(reason) {
        abortPayloadRequest(request, reason);
      },
    },
    new ByteLengthQueuingStrategy({
      highWaterMark: streamHighWaterMark(options.highWaterMark),
    }),
  );

  const signal = options.signal;
  if (signal !== undefined) {
    const abortListener = () => abortPayloadRequest(request, signal.reason);
    signal.addEventListener("abort", abortListener, { once: true });
    request.cleanupAbortListener = () => {
      signal.removeEventListener("abort", abortListener);
      request.cleanupAbortListener = null;
    };
  }

  scheduleWork(request);

  return {
    allReady: request.allReady.promise,
    contentType: jsonPayloadCodec.contentType,
    stream,
  };
}

function createTask(
  request: PayloadRequest,
  id: number,
  value: TaskValue,
  contextValues: ContextValues,
  imagePreloadsSuppressed: boolean,
  stack: StackFrame | null,
): Task {
  request.pendingTasks += 1;
  return { contextValues, id, imagePreloadsSuppressed, stack, ...value };
}

function performWork(request: PayloadRequest): void {
  if (request.closed) return;

  const tasks = request.pingedTasks;
  request.pingedTasks = [];

  for (const task of tasks) retryTask(request, task);

  flushRows(request);
}

function retryTask(request: PayloadRequest, task: Task): void {
  const frame: RenderFrame = {
    // Tasks already capture a context snapshot when outlined. Provider
    // mutation is balanced, so retries can use that snapshot directly.
    contextValues: task.contextValues,
    dispatcher: null,
    pendingAssets: [],
    request,
    imagePreloadsSuppressed: task.imagePreloadsSuppressed,
    stack: task.stack,
  };

  try {
    let value: PayloadModel;
    switch (task.kind) {
      case "node":
        value = serializeNode(task.value, frame);
        break;
      case "node-promise":
        value = serializeNode(readThenable(task.value), frame);
        break;
      case "promise":
        value = serializeValue(readThenable(task.value), frame);
        break;
    }
    flushFrameAssets(frame, task.id);
    emitDataRows(request);
    emitRow(request, { id: task.id, tag: "model", value });
    finishTask(request);
  } catch (error) {
    if (isThenable(error)) {
      // The retry re-discovers nothing already deduped by request.assets, so
      // this attempt's assets must ship now; the task still settles into id.
      flushFrameAssets(frame, task.id);
      error.then(
        () => pingTask(request, task),
        () => pingTask(request, task),
      );
      return;
    }

    flushFrameAssets(frame, task.id);
    emitRow(request, {
      id: task.id,
      tag: "error",
      value: errorRowPayload(request, error, task.stack),
    });
    finishTask(request);
  }
}

function finishTask(request: PayloadRequest): void {
  request.pendingTasks -= 1;
  if (request.pendingTasks === 0) request.allReady.resolve(undefined);
}

function emitDataRows(request: PayloadRequest): void {
  const entries: FigDataHydrationEntry[] = [];

  for (const snapshot of request.pendingDataSnapshots.values()) {
    // Stream only settled values. A "refreshing" entry exposes a transient stale
    // value while its background refresh is in flight; emitting it would mark the
    // key emitted forever and permanently suppress the fresh value. Skipping it
    // lets the entry stream once its refresh settles.
    if (!snapshot.hasValue || snapshot.status === "refreshing") continue;

    const key = snapshot.canonicalKey;
    if (request.emittedDataKeys.has(key)) {
      request.pendingDataSnapshots.delete(snapshot.canonicalKey);
      continue;
    }

    request.emittedDataKeys.add(key);
    request.pendingDataSnapshots.delete(snapshot.canonicalKey);
    entries.push({ key: snapshot.key, value: snapshot.value });
  }

  if (entries.length > 0) {
    emitRow(request, { tag: "data", value: encodePayloadDataEntries(entries) });
  }
}

function flushFrameAssets(frame: RenderFrame, rowId: number): void {
  if (frame.pendingAssets.length === 0) return;
  const value = frame.pendingAssets;
  frame.pendingAssets = [];
  emitRow(frame.request, { for: rowId, tag: "assets", value });
}

function createPayloadDispatcher(frame: RenderFrame): RenderDispatcher {
  const dispatcher = createStaticDispatcher({
    contextValues: frame.contextValues,
    externalStoreError:
      "useSyncExternalStore requires getServerSnapshot during payload render.",
    readPromise: readThenable,
    readData(resource, args) {
      return frame.request.dataStore.readData(resource, args, frame);
    },
    preloadData(resource, args) {
      frame.request.dataStore.preloadData(resource, ...args);
    },
    useId() {
      const id = `fig-pl-${frame.request.nextUseId.toString(32)}`;
      frame.request.nextUseId += 1;
      return id;
    },
    updateError: "State updates are not allowed during payload render.",
  });

  // Serialized components are render-only: they never re-run on the client,
  // so state, effects, and interactivity are meaningless there — dev throws
  // at first use instead of silently freezing initial state into the wire.
  // Reads stay server-safe: readContext/readData/readPromise/preloadData,
  // useMemo, useId, and useSyncExternalStore's getServerSnapshot path (a
  // read, not a subscription — the static dispatcher already requires it).
  if (__DEV__) {
    const throwClientApi = (hook: string) => (): never => {
      throw new Error(
        `${hook} cannot be used during payload render: serialized components are render-only. Move state, effects, and interactivity into a client reference.`,
      );
    };
    dispatcher.useState = throwClientApi("useState");
    dispatcher.useActionState = throwClientApi("useActionState");
    dispatcher.useTransition = throwClientApi("useTransition");
    dispatcher.useStableEvent = throwClientApi("useStableEvent");
    dispatcher.useReactive = throwClientApi("useReactive");
    dispatcher.useBeforePaint = throwClientApi("useBeforePaint");
    dispatcher.useBeforeLayout = throwClientApi("useBeforeLayout");
  }

  return dispatcher;
}

function serializeNode(node: FigNode, frame: RenderFrame): PayloadModel {
  if (Array.isArray(node)) {
    return serializeTreeArray(node, frame);
  }

  if (node === null || node === undefined || typeof node === "boolean") {
    return node === undefined ? { $fig: "undefined" } : node;
  }

  if (typeof node === "string" || typeof node === "number") {
    return node;
  }

  if (isPortal(node)) return null;
  if (isValidElement(node)) return serializeElement(node, frame, false);
  if (isThenable(node)) {
    return outlineTask(
      frame,
      { kind: "node-promise", value: node },
      "promise",
      node,
    );
  }

  throw invalidChildError(node);
}

function serializeNodeOrLazy(
  node: FigNode,
  frame: RenderFrame,
  preserveElementIdentity = false,
): PayloadModel {
  const graphCheckpoint = checkpointPayloadGraph(frame.request.graph);
  const assetCheckpoint = frame.pendingAssets.length;
  try {
    if (!isValidElement(node)) return serializeNode(node, frame);
    return serializeElement(node, frame, preserveElementIdentity);
  } catch (error) {
    rollbackPayloadGraph(frame.request.graph, graphCheckpoint);
    // Assets discovered inside this subtree belong to the outlined row, not
    // the enclosing one: gating the enclosing row would hold the whole tree's
    // reveal on stylesheets only the hole's content needs.
    const scopedAssets = frame.pendingAssets.splice(assetCheckpoint);
    if (isThenable(error)) {
      return outlineTask(
        frame,
        { kind: "node", value: node },
        "lazy",
        error,
        scopedAssets,
      );
    }
    return outlineError(frame, error, "lazy", scopedAssets);
  }
}

function serializeElement(
  element: FigElement,
  frame: RenderFrame,
  preserveIdentity: boolean,
): PayloadModel {
  const type = element.type;

  if (typeof type === "string") {
    return serializeHostElement(element, type, frame, preserveIdentity);
  }

  if (type === Fragment) {
    return serializeElementModel(
      element,
      { $fig: "fragment" },
      frame,
      preserveIdentity,
      "children",
    );
  }

  if (isClientReference(type)) {
    const clientId = emitClientReference(frame.request, type);
    return serializeElementModel(
      element,
      { $fig: "client", id: clientId },
      frame,
      preserveIdentity,
    );
  }

  if (isContext(type)) {
    return serializeContextProvider(type, element.props, frame);
  }

  if (isAssets(type)) {
    return serializeAssets(element.props, frame);
  }

  if (isSuspense(type)) {
    return serializeElementModel(
      element,
      { $fig: "suspense" },
      frame,
      preserveIdentity,
      "suspense",
    );
  }

  if (isErrorBoundary(type)) {
    return serializeNode(element.props.children, frame);
  }

  if (isActivity(type)) {
    return serializeNode(element.props.children, frame);
  }

  if (isViewTransition(type)) {
    return serializeElementModel(
      element,
      { $fig: "view-transition" },
      frame,
      preserveIdentity,
      "children",
    );
  }

  if (typeof type === "function") {
    return serializeFunctionComponent(type, element.props, frame);
  }

  throw new Error("Unsupported Fig element type during payload render.");
}

function serializeHostElement(
  element: FigElement,
  type: string,
  frame: RenderFrame,
  preserveIdentity: boolean,
): PayloadModel {
  const preload = imagePreloadFromHostProps(
    type,
    element.props,
    frame.imagePreloadsSuppressed,
  );
  if (preload !== null) {
    frame.pendingAssets.push(...frame.request.assets.serialize(preload));
  }

  const previousImagePreloadsSuppressed = frame.imagePreloadsSuppressed;
  frame.imagePreloadsSuppressed =
    previousImagePreloadsSuppressed || suppressesImagePreloads(type);
  try {
    return serializeElementModel(
      element,
      type,
      frame,
      preserveIdentity,
      "children",
    );
  } finally {
    frame.imagePreloadsSuppressed = previousImagePreloadsSuppressed;
  }
}

function serializeElementModel(
  element: FigElement,
  type: PayloadElementModel["type"],
  frame: RenderFrame,
  preserveIdentity: boolean,
  treeProps: TreePropMode = null,
): PayloadModel {
  const id = preserveIdentity
    ? definePayloadGraphElement(frame.request.graph, element)
    : undefined;
  if (typeof id === "object") return id;
  const model: PayloadElementModel = {
    $fig: "element",
    key: element.key,
    props: serializeProps(
      element.props,
      frame,
      treeProps,
      typeof type === "string",
    ),
    type,
  };
  if (id !== undefined) model.id = id;
  return model;
}

function serializeFunctionComponent(
  type: Component,
  props: Props,
  frame: RenderFrame,
): PayloadModel {
  const assetCheckpoint = frame.pendingAssets.length;
  frame.pendingAssets.push(
    ...frame.request.assets.serialize(frame.request.componentAssets?.(type)),
  );
  frame.dispatcher ??= createPayloadDispatcher(frame);
  const previousDispatcher = setCurrentDispatcher(frame.dispatcher);
  const previousDataStore = setCurrentDataStore(frame.request.dataStore);
  const previousStack = frame.stack;
  frame.stack = { name: type.name || "Anonymous", parent: previousStack };

  try {
    if (
      __DEV__ &&
      "$$typeof" in type &&
      type.$$typeof === Symbol.for("fig.data-resource")
    ) {
      throw new Error(
        "Payload components cannot be rendered inside Payload. Render the underlying server component directly, or mount separate Payload components from the client tree.",
      );
    }
    const result = type(props);
    if (isThenable(result)) {
      const scopedAssets = frame.pendingAssets.splice(assetCheckpoint);
      return outlineTask(
        frame,
        { kind: "node-promise", value: result },
        "promise",
        result,
        scopedAssets,
      );
    }
    return serializeNode(result, frame);
  } catch (error) {
    recordErrorStack(error, frame.stack);
    throw error;
  } finally {
    frame.stack = previousStack;
    setCurrentDataStore(previousDataStore);
    setCurrentDispatcher(previousDispatcher);
  }
}

function serializeContextProvider(
  context: FigContext<unknown>,
  props: Props,
  frame: RenderFrame,
): PayloadModel {
  return withContextValue(frame.contextValues, context, props.value, () =>
    serializeNode(props.children, frame),
  );
}

function serializeAssets(props: Props, frame: RenderFrame): PayloadModel {
  // Buffered, not emitted: the owning row id is decided at scope exit (see
  // RenderFrame.pendingAssets). Dedupe happens here, so a retried subtree
  // does not re-buffer assets an earlier attempt already shipped.
  frame.pendingAssets.push(...frame.request.assets.serialize(props.assets));
  return serializeNode(props.children, frame);
}

function serializeProps(
  props: Props,
  frame: RenderFrame,
  treeProps: TreePropMode,
  hostElement = false,
): PayloadModel {
  const clientOnlyBehavior = hostElement
    ? clientOnlyHostBehavior(props)
    : undefined;
  if (clientOnlyBehavior !== undefined) {
    throw new Error(
      `Client-only host behavior from ${clientOnlyBehavior} cannot be ` +
        "serialized in a payload; move it into a client reference.",
    );
  }

  const value: Record<string, PayloadModel> = {};
  for (const name of Object.keys(props)) {
    // A host `mix` already resolved into these props at element creation;
    // the marker itself holds descriptors (functions) and stays server-side.
    // Component `mix` props still serialize (and fail loudly on functions).
    if (hostElement && name === "mix") continue;
    const child = props[name];
    const isTreeProp =
      treeProps !== null &&
      (name === "children" ||
        (treeProps === "suspense" && name === "fallback"));
    value[name] = isTreeProp
      ? serializeTreeProp(child, frame)
      : serializeValue(child, frame);
  }
  return {
    $fig: "object",
    value,
  };
}

function serializeTreeProp(value: FigNode, frame: RenderFrame): PayloadModel {
  if (Array.isArray(value)) return serializeTreeArray(value, frame);
  return serializeNodeOrLazy(value, frame);
}

function serializeTreeArray(
  value: FigNode[],
  frame: RenderFrame,
): PayloadModel[] {
  return flattenChildArrays(value).map((child) =>
    serializeNodeOrLazy(child, frame),
  );
}

function serializeValue(value: unknown, frame: RenderFrame): PayloadModel {
  // Scalar values return from the shared encoder before any graph access, so
  // reusing the request graph here is free (no per-value context allocation).
  if (isPlainPayloadValue(value)) {
    return encodePayloadValueWithGraph(value, frame.request.graph);
  }

  if (isClientReference(value)) {
    return { $fig: "client", id: emitClientReference(frame.request, value) };
  }

  if (isValidElement(value)) return serializeNodeOrLazy(value, frame, true);
  if (isPortal(value)) return null;
  if (isThenable(value)) {
    return outlineTask(frame, { kind: "promise", value }, "promise", value);
  }
  if (typeof value === "function") {
    throw new Error("Functions cannot be passed to client references.");
  }

  if (typeof value === "object" && value !== null) {
    if (value instanceof Date) {
      return encodePayloadValueWithGraph(value, frame.request.graph);
    }
    if (value instanceof Map) {
      return serializePayloadMap(value, frame.request.graph, ([key, item]) => [
        serializeValue(key, frame),
        serializeValue(item, frame),
      ]);
    }
    if (value instanceof Set) {
      return serializePayloadSet(value, frame.request.graph, (item) =>
        serializeValue(item, frame),
      );
    }

    if (Array.isArray(value)) {
      return serializePayloadArray(value, frame.request.graph, (item) =>
        serializeValue(item, frame),
      );
    }

    return serializePayloadPlainObject(value, frame.request.graph, (child) =>
      serializeValue(child, frame),
    );
  }

  throw new Error(`Cannot serialize ${typeof value} into the payload.`);
}
function outlineTask(
  frame: RenderFrame,
  value: TaskValue,
  referenceKind: OutlineKind,
  wakeable: Thenable,
  scopedAssets: SerializedAssetResource[] = [],
): PayloadSpecialModel {
  const request = frame.request;
  const outline = createOutline(request, referenceKind, scopedAssets);
  const task = createTask(
    request,
    outline.id,
    value,
    cloneContextValues(frame.contextValues),
    frame.imagePreloadsSuppressed,
    stackForError(wakeable, frame.stack),
  );

  wakeable.then(
    () => pingTask(request, task),
    () => pingTask(request, task),
  );

  return outline;
}

function outlineError(
  frame: RenderFrame,
  error: unknown,
  referenceKind: OutlineKind,
  scopedAssets: SerializedAssetResource[],
): PayloadSpecialModel {
  const request = frame.request;
  const outline = createOutline(request, referenceKind, scopedAssets);
  // Assets first so a decoder that drops gates on error rows sees the row
  // order it expects; the assets still preload even though the row failed.
  emitRow(request, {
    id: outline.id,
    tag: "error",
    value: errorRowPayload(request, error, frame.stack),
  });
  return outline;
}

function createOutline(
  request: PayloadRequest,
  kind: OutlineKind,
  assets: SerializedAssetResource[],
): PayloadOutline {
  const outline: PayloadOutline = {
    $fig: kind,
    id: request.nextRowId++,
  };
  if (assets.length > 0) {
    emitRow(request, { for: outline.id, tag: "assets", value: assets });
  }
  return outline;
}

// The onError return value is authoritative, like the HTML renderer's
// reportBoundaryError: message crosses the wire only when the handler says
// so. Without a handler, development keeps the real message for debugging
// (payload errors never re-execute on the client, so the wire is the only
// surface) and production sends an empty payload.
function errorRowPayload(
  request: PayloadRequest,
  error: unknown,
  stack: StackFrame | null,
): ServerErrorPayload {
  const info = {
    componentStack: componentStack(stackForError(error, stack)),
  };
  if (request.onError === undefined) {
    return __DEV__ ? { message: errorMessage(error) } : {};
  }

  try {
    return request.onError(error, info) ?? {};
  } catch {
    return {};
  }
}

function recordErrorStack(error: unknown, stack: StackFrame | null): void {
  if (stack === null) return;
  if (typeof error !== "object" || error === null) return;
  if (!errorStacks.has(error)) errorStacks.set(error, stack);
}

function stackForError(
  error: unknown,
  fallback: StackFrame | null,
): StackFrame | null {
  if (typeof error !== "object" || error === null) return fallback;
  return errorStacks.get(error) ?? fallback;
}

function clientReferenceExportName(id: string): string | undefined {
  const hashIndex = id.lastIndexOf("#");
  if (hashIndex === -1) return undefined;
  return id.slice(hashIndex + 1) || undefined;
}

function emitClientReference(
  request: PayloadRequest,
  reference: FigClientReference,
): number {
  const existing = request.clientReferenceRows.get(reference.id);
  if (existing !== undefined) return existing;

  // Resolve assets BEFORE reserving the row id and recording the mapping. A lazy
  // resource thunk (bundler-manifest resolution) may throw; reserving first would
  // leave a row id mapped but never emitted, so a later retry returns the cached
  // id and the client suspends on a chunk that never arrives. Resolving first
  // lets the throw propagate as an ordinary serialization error with no poisoned
  // mapping, so the reference can be retried cleanly.
  const assets = request.assets.serializeClientReference(reference);
  const value: Extract<PayloadRow, { tag: "client" }>["value"] = {
    id: reference.id,
  };
  if (assets.length > 0) value.assets = assets;
  // The "<module>#<export>" authoring convention is split here, once, so the
  // wire is self-describing and the client never string-parses ids.
  const exportName = clientReferenceExportName(reference.id);
  if (exportName !== undefined) value.exportName = exportName;
  if (reference.ssr !== undefined) value.ssr = true;
  const id = request.nextRowId++;
  request.clientReferenceRows.set(reference.id, id);
  emitRow(request, {
    id,
    tag: "client",
    value,
  });
  return id;
}

function emitRow(request: PayloadRequest, row: PayloadRow): void {
  request.queuedRows.push(jsonPayloadCodec.encodeRow(row));
  flushRows(request);
}

function pingTask(request: PayloadRequest, task: Task): void {
  if (request.closed) return;
  request.pingedTasks.push(task);
  scheduleWork(request);
}

function scheduleWork(request: PayloadRequest): void {
  // Many thenables settling in one tick ping many tasks; one performWork
  // pass drains them all, so schedule at most one.
  if (request.workScheduled) return;
  request.workScheduled = true;
  queueMicrotask(() => {
    request.workScheduled = false;
    performWork(request);
  });
}

function flushRows(request: PayloadRequest): void {
  if (request.controller === null || request.closed) return;
  if (request.flushingRows) return;

  request.flushingRows = true;
  try {
    // Row-granular gating: rows already encode one complete wire row each,
    // so stopping between rows keeps every chunk parse-safe for consumers
    // that interleave per chunk.
    let flushed = 0;
    while (
      flushed < request.queuedRows.length &&
      !streamFlowBlocked(request.controller)
    ) {
      request.controller.enqueue(request.queuedRows[flushed]);
      flushed += 1;
    }
    if (flushed === request.queuedRows.length) request.queuedRows.length = 0;
    else if (flushed > 0) {
      request.queuedRows = request.queuedRows.slice(flushed);
    }
  } finally {
    request.flushingRows = false;
  }

  // Deliberately not conditioned on flow: close() only marks the end of the
  // queue, so a full queue with no rows left to write still closes here.
  if (request.pendingTasks === 0 && request.queuedRows.length === 0) {
    request.closed = true;
    request.cleanupAbortListener?.();
    request.dataStore.dispose();
    request.controller.close();
  }
}

function closeWithError(request: PayloadRequest, error: unknown): void {
  if (request.closed) return;
  request.cleanupAbortListener?.();
  request.closed = true;
  request.dataStore.dispose();
  request.allReady.reject(error);
  request.controller?.error(error);
}

function abortPayloadRequest(request: PayloadRequest, reason?: unknown): void {
  closeWithError(request, reason ?? new PayloadRequestCancelledError());
}

// Wire-format flattening only: unlike the shared collectChildren, this keeps
// empty children and does NOT merge adjacent text — the client decodes rows
// and re-collects children itself, so merging here would double-apply. Flat
// input (the common case) is returned untouched.
function flattenChildArrays(children: FigNode[]): FigNode[] {
  if (!children.some(Array.isArray)) return children;

  const collected: FigNode[] = [];
  for (const child of children) {
    if (Array.isArray(child)) {
      for (const nested of flattenChildArrays(child)) collected.push(nested);
    } else {
      collected.push(child);
    }
  }
  return collected;
}

function invalidChildError(value: unknown): Error {
  return new Error(
    `Invalid Fig child in payload render: ${describeInvalidChild(value)}.`,
  );
}

function throwIfAborted(signal?: AbortSignal | null): void {
  if (signal?.aborted) throw new PayloadRequestCancelledError();
}
