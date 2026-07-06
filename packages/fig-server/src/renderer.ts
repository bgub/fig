import {
  createElement,
  type ElementType,
  type FigClientReference,
  type FigContext,
  type FigElement,
  type FigNode,
  type FigAssetResource,
  Fragment,
  type Props,
} from "@bgub/fig";
import {
  assetResourceKey,
  isClientReference,
  isContext,
  isActivity,
  isErrorBoundary,
  isFigAssetResource,
  isPortal,
  isAssets,
  isSuspense,
  isValidElement,
  assetResourceDestination,
  assetResourceFromHostProps,
  setCurrentDispatcher,
  setCurrentDataStore,
  type RenderDispatcher,
  ACTIVITY_TEMPLATE_ATTRIBUTE,
  SUSPENSE_COMPLETED_MARKER,
  SUSPENSE_CLIENT_MARKER,
  SUSPENSE_END_MARKER,
  SUSPENSE_PENDING_PREFIX,
  validateInstanceNesting,
  validateTextNesting,
  isThenable,
  readThenable,
  type Thenable,
  collectChildren,
  type NormalizedChild,
  invalidChildError,
} from "@bgub/fig/internal";
import { createDataStore, type DataStore } from "@bgub/fig-data/internal";
import {
  escapeAttribute,
  formTextContent,
  hasRenderableChild,
  isVoidElement,
  unsafeHTMLContent,
  writeElementEnd,
  writeElementStart,
  writeText,
} from "./html.ts";
import {
  activityId,
  boundaryId,
  boundaryPlaceholderMarkup,
  jsString,
  placeholderId,
  placeholderMarkup,
  segmentContainerStartMarkup,
  segmentId,
  writeRuntime as writeProtocolRuntime,
  writeScript as writeProtocolScript,
} from "./protocol.ts";
import {
  type ContextValues,
  type Deferred,
  cloneContextValues,
  createStaticDispatcher,
  deferred,
  withContextValue,
} from "./shared.ts";
import { AssetResourceRegistry } from "./asset-registry.ts";
import type {
  ServerErrorPayload,
  ServerFragmentRenderResult,
  ServerRenderOptions,
} from "./types.ts";

declare const process: { env: { NODE_ENV?: string } };

interface Request {
  abortableTasks: Set<Task>;
  allReady: Deferred<void>;
  completedBoundaries: Set<SuspenseBoundary>;
  completedRootSegment: Segment | null;
  controller: ReadableStreamDefaultController<Uint8Array> | null;
  dataStore: DataStore<object, null>;
  fatalError: unknown;
  identifierPrefix: string;
  nextBoundaryId: number;
  nextSegmentId: number;
  nextActivityId: number;
  nonce?: string;
  onError?: ServerRenderOptions["onError"];
  onAssetError?: ServerRenderOptions["onAssetError"];
  pendingRootTasks: number;
  pendingTasks: number;
  pingedTasks: Task[];
  assetSink: AssetSink;
  rootSegment: Segment;
  runtimeName: string;
  runtimeWritten: boolean;
  headReady: Deferred<string>;
  // Set exactly once, when the shell completes and the head is sealed; also
  // the "head is sealed" flag.
  headSnapshot: string | null;
  shellReady: Deferred<void>;
  status: "opening" | "open" | "aborting" | "closed";
  stream: ReadableStream<Uint8Array>;
  clientRenderedBoundaries: Set<SuspenseBoundary>;
  clientReferenceFallback?: ServerRenderOptions["clientReferenceFallback"];
  partialBoundaries: Set<SuspenseBoundary>;
  prerender: boolean;
  componentAssets?: ServerRenderOptions["assets"];
  document: DocumentState | null;
  assetRegistry: AssetResourceRegistry;
  resolveAssetKey?: ServerRenderOptions["resolveAssetKey"];
  workScheduled: boolean;
  // Chunks accumulate here per flush pass and leave as one encoded enqueue,
  // instead of one tiny Uint8Array per attribute/text write.
  writeBuffer: string[];
}

// Render-scope state shared by queued tasks and live frames; forked (with
// context values cloned) whenever work is spawned or resumed.
interface RenderScope {
  abortSet: Set<Task>;
  boundary: SuspenseBoundary | null;
  contextValues: ContextValues;
  // The nearest enclosing hidden Activity's template id, or null when not inside
  // one. Threaded so suspended content streamed for that boundary can be revealed
  // into the activity template's inert content.
  hiddenActivityId: string | null;
  // Logical host-ancestor tags (nearest first) for DOM-nesting validation.
  // Suspended segments stream into staging nodes but are moved into place on
  // the client, so their spawn-point ancestors stay authoritative.
  hostAncestors: readonly string[];
  idPath: string;
  selectProps: Props | null;
  stack: StackFrame | null;
}

interface Task extends RenderScope {
  node: FigNode;
  segment: Segment;
}

interface Segment {
  boundary: SuspenseBoundary | null;
  children: Segment[];
  chunks: string[];
  id: number | null;
  index: number;
  parentFlushed: boolean;
  assetResources: FigAssetResource[];
  status: SegmentStatus;
  write(chunk: string): void;
}

interface SuspenseBoundary {
  // Non-null when this boundary lives inside a hidden Activity: the activity
  // template id its streamed completion must be revealed into. See `ac`/`ax` in
  // protocol.ts.
  activityId: string | null;
  completedSegments: Segment[];
  contentSegment: Segment;
  error: ServerErrorPayload | null;
  fallbackAbortableTasks: Set<Task>;
  id: number | null;
  parentFlushed: boolean;
  pendingTasks: number;
  status: BoundaryStatus;
}

type BoundaryStatus = "pending" | "completed" | "client-rendered";
type SegmentStatus = "pending" | "rendering" | "completed" | "flushed";
type Component = (props: Props & { children?: FigNode }) => FigNode;

interface RenderFrame extends RenderScope {
  dispatcher: RenderDispatcher;
  localIdCounter: number;
  request: Request;
  segment: Segment;
}

interface StackFrame {
  name: string;
  parent: StackFrame | null;
}

interface DocumentState {
  hasHead: boolean;
}

interface AssetSink {
  nonce?: string;
  write(chunk: string): void;
}

const errorStacks = new WeakMap<object, StackFrame>();
const textEncoder = new TextEncoder();
const documentHeadMarker = "\u0000fig:head\u0000";
const RUNTIME_REF = "__figSSR";
let nextRuntimeId = 0;

export function createServerRenderRequest(
  node: FigNode,
  options: ServerRenderOptions = {},
  mode: { document?: boolean; prerender?: boolean } = {},
): ServerFragmentRenderResult {
  throwIfAborted(options.signal);

  const shellReady = deferred<void>();
  const headReady = deferred<string>();
  const allReady = deferred<void>();
  // The readiness promises also reject through the stream; pre-attached
  // no-op handlers keep the ones a caller does not await from becoming
  // unhandled rejections (await-ers still observe the rejection).
  void shellReady.promise.catch(() => undefined);
  void headReady.promise.catch(() => undefined);
  void allReady.promise.catch(() => undefined);
  const rootSegment = createSegment(0, null);

  const request: Request = {
    abortableTasks: new Set<Task>(),
    allReady,
    completedBoundaries: new Set(),
    completedRootSegment: null,
    controller: null,
    dataStore: createDataStore<object, null>({
      getLane: () => null,
      partition: options.dataPartition,
      schedule: () => undefined,
    }),
    fatalError: null,
    identifierPrefix: options.identifierPrefix ?? "",
    nextBoundaryId: 0,
    nextSegmentId: 0,
    nextActivityId: 0,
    nonce: options.nonce,
    onError: options.onError,
    onAssetError: options.onAssetError,
    pendingRootTasks: 0,
    pendingTasks: 0,
    pingedTasks: [],
    assetSink: null as never,
    rootSegment,
    runtimeName: createRuntimeName(options.identifierPrefix),
    runtimeWritten: false,
    headReady,
    headSnapshot: null,
    shellReady,
    status: "opening",
    stream: null as never,
    clientRenderedBoundaries: new Set(),
    clientReferenceFallback: options.clientReferenceFallback,
    partialBoundaries: new Set(),
    prerender: mode.prerender === true,
    componentAssets: options.assets,
    document: mode.document === true ? { hasHead: false } : null,
    assetRegistry: new AssetResourceRegistry(options.identifierPrefix ?? ""),
    resolveAssetKey: options.resolveAssetKey,
    workScheduled: false,
    writeBuffer: [],
  };
  request.assetSink = {
    nonce: options.nonce,
    write: (chunk) => write(request, chunk),
  };

  const stream = new ReadableStream<Uint8Array>({
    start(streamController) {
      request.controller = streamController;
      flushCompletedQueues(request);
    },
    cancel(reason) {
      abort(request, reason);
    },
  });
  request.stream = stream;

  rootSegment.parentFlushed = true;
  const rootTask = createTask(request, node, rootSegment, {
    abortSet: request.abortableTasks,
    boundary: null,
    contextValues: new Map(),
    hiddenActivityId: null,
    hostAncestors: [],
    idPath: "",
    selectProps: null,
    stack: null,
  });
  request.pingedTasks.push(rootTask);

  if (options.signal !== undefined) {
    options.signal.addEventListener(
      "abort",
      () => abort(request, options.signal?.reason),
      { once: true },
    );
  }

  request.workScheduled = true;
  queueMicrotask(() => {
    request.workScheduled = false;
    performWork(request);
  });

  return {
    abort: (reason?: unknown) => abort(request, reason),
    allReady: allReady.promise,
    contentType: "text/html; charset=utf-8",
    getData: () => request.dataStore.snapshot(),
    getHead: () =>
      request.headSnapshot ?? request.assetRegistry.headHtml(request.nonce),
    headReady: headReady.promise,
    shellReady: shellReady.promise,
    stream,
  };
}

function createTask(
  request: Request,
  node: FigNode,
  segment: Segment,
  scope: RenderScope,
): Task {
  request.pendingTasks += 1;
  if (scope.boundary === null) {
    request.pendingRootTasks += 1;
  } else {
    scope.boundary.pendingTasks += 1;
  }

  const task: Task = { ...scope, node, segment };
  request.abortableTasks.add(task);
  scope.abortSet.add(task);
  return task;
}

// Copies a scope for spawned or resumed work. Context values are cloned so
// the fork observes the provider stack as of the fork point.
function forkScope(scope: RenderScope): RenderScope {
  return {
    abortSet: scope.abortSet,
    boundary: scope.boundary,
    contextValues: cloneContextValues(scope.contextValues),
    hiddenActivityId: scope.hiddenActivityId,
    hostAncestors: scope.hostAncestors,
    idPath: scope.idPath,
    selectProps: scope.selectProps,
    stack: scope.stack,
  };
}

function createSegment(
  index: number,
  boundary: SuspenseBoundary | null,
): Segment {
  return {
    boundary,
    children: [],
    chunks: [],
    id: null,
    index,
    parentFlushed: false,
    assetResources: [],
    status: "pending",
    write(chunk) {
      this.chunks.push(chunk);
    },
  };
}

function createBoundary(
  fallbackAbortableTasks: Set<Task>,
  contentSegment: Segment,
): SuspenseBoundary {
  return {
    activityId: null,
    completedSegments: [],
    contentSegment,
    error: null,
    fallbackAbortableTasks,
    id: null,
    parentFlushed: false,
    pendingTasks: 0,
    status: "pending",
  };
}

function performWork(request: Request): void {
  if (request.status === "closed") return;
  if (request.status === "opening") request.status = "open";

  const tasks = request.pingedTasks;
  request.pingedTasks = [];

  for (const task of tasks) retryTask(request, task);

  flushCompletedQueues(request);
}

function retryTask(request: Request, task: Task): void {
  if (task.segment.status !== "pending") return;

  task.segment.status = "rendering";
  const frame = createRenderFrame(request, task.segment, forkScope(task));

  try {
    renderChildren(task.node, frame);
    task.segment.status = "completed";
    detachTask(request, task);
    finishedTask(request, task, task.segment);
  } catch (error) {
    detachTask(request, task);
    task.segment.status = "completed";
    erroredTask(request, task, error);
  }
}

function createRenderFrame(
  request: Request,
  segment: Segment,
  scope: RenderScope,
): RenderFrame {
  const frame = {
    ...scope,
    dispatcher: null as unknown as RenderDispatcher,
    localIdCounter: 0,
    request,
    segment,
  };
  frame.dispatcher = createServerDispatcher(frame);
  return frame;
}

function createServerDispatcher(frame: RenderFrame): RenderDispatcher {
  return createStaticDispatcher({
    contextValues: frame.contextValues,
    externalStoreError:
      "useExternalStore requires getServerSnapshot during server render.",
    readPromise(promise) {
      throwIfAborting(frame.request);
      return readThenable(promise);
    },
    readData(resource, args) {
      throwIfAborting(frame.request);
      return frame.request.dataStore.readData(resource, args, frame);
    },
    preloadData(resource, args) {
      throwIfAborting(frame.request);
      frame.request.dataStore.preloadData(resource, ...args);
    },
    useId() {
      const id = `${frame.request.identifierPrefix}fig-${frame.idPath}-${frame.localIdCounter.toString(32)}`;
      frame.localIdCounter += 1;
      return id;
    },
    updateError: "State updates are not allowed during server render.",
  });
}

function renderNode(node: FigNode, frame: RenderFrame): void {
  if (Array.isArray(node)) {
    renderChildren(node, frame);
    return;
  }

  if (node === null || node === undefined || typeof node === "boolean") {
    return;
  }

  if (typeof node === "string" || typeof node === "number") {
    if (frame.request.document !== null && !frame.request.document.hasHead) {
      if (String(node).trim() !== "") throw invalidDocumentShellError();
    }
    if (process.env.NODE_ENV !== "production") {
      validateTextNesting(String(node), frame.hostAncestors);
    }
    writeText(String(node), frame.segment);
    return;
  }

  if (isPortal(node)) return;

  if (!isValidElement(node)) throw invalidChildError(node);

  renderElement(node, frame);
}

function renderChildren(node: FigNode, frame: RenderFrame): void {
  renderChildSequence(collectChildren(node), frame);
}

function renderChildSequence(
  children: NormalizedChild[],
  frame: RenderFrame,
): void {
  for (let index = 0; index < children.length; index += 1) {
    try {
      withIdSegment(frame, index, () => renderNode(children[index], frame));
    } catch (error) {
      if (isThenable(error) && frame.boundary !== null) {
        spawnSuspendedTask(frame, children.slice(index), error);
        return;
      }

      throw error;
    }
  }
}

function withIdSegment<T>(
  frame: RenderFrame,
  index: number,
  callback: () => T,
): T {
  const previousIdPath = frame.idPath;
  const segment = index.toString(32);
  frame.idPath =
    previousIdPath === "" ? segment : `${previousIdPath}-${segment}`;

  try {
    return callback();
  } finally {
    frame.idPath = previousIdPath;
  }
}

function renderElement(element: FigElement, frame: RenderFrame): void {
  const type = element.type;

  if (typeof type === "string") {
    renderHostElement(type, element.props, frame);
    return;
  }

  if (type === Fragment) {
    renderChildren(element.props.children, frame);
    return;
  }

  if (isContext(type)) {
    renderContextProvider(type, element.props, frame);
    return;
  }

  if (isAssets(type)) {
    renderAssets(element.props, frame);
    return;
  }

  if (isSuspense(type)) {
    renderSuspense(element.props, frame);
    return;
  }

  if (isErrorBoundary(type)) {
    renderChildren(element.props.children, frame);
    return;
  }

  if (isClientReference(type)) {
    renderClientReference(type, element.props, frame);
    return;
  }

  if (isActivity(type)) {
    renderActivity(element.props, frame);
    return;
  }

  if (typeof type === "function") {
    renderFunctionComponent(type as Component, element.props, frame);
    return;
  }

  throw new Error(
    `Unsupported Fig element type: ${describeElementType(type)}.`,
  );
}

function renderFunctionComponent(
  type: Component,
  props: Props,
  frame: RenderFrame,
): void {
  const previousDispatcher = setCurrentDispatcher(frame.dispatcher);
  const previousDataStore = setCurrentDataStore(frame.request.dataStore);
  const previousStack = frame.stack;
  const previousLocalIdCounter = frame.localIdCounter;
  frame.stack = { name: type.name || "Anonymous", parent: previousStack };
  frame.localIdCounter = 0;

  try {
    renderComponentAssets(type, frame);
    renderChildren(type(props), frame);
  } catch (error) {
    recordErrorStack(error, frame.stack);
    throw error;
  } finally {
    frame.stack = previousStack;
    frame.localIdCounter = previousLocalIdCounter;
    setCurrentDataStore(previousDataStore);
    setCurrentDispatcher(previousDispatcher);
  }
}

function renderClientReference(
  type: FigClientReference,
  props: Props,
  frame: RenderFrame,
): void {
  if (type.ssr !== undefined) {
    renderComponentAssets(type, frame);
    renderElement(createElement(type.ssr, props), frame);
    return;
  }

  const fallback = frame.request.clientReferenceFallback;
  if (fallback === undefined) {
    renderFunctionComponent(type as Component, props, frame);
    return;
  }

  renderComponentAssets(type, frame);
  renderChildren(fallback(type, props), frame);
}

function renderComponentAssets(type: ElementType, frame: RenderFrame): void {
  const key = isClientReference(type)
    ? type.id
    : frame.request.resolveAssetKey?.(type);
  if (key !== undefined) {
    renderAssetValue(frame.request.componentAssets?.[key], frame);
  }
}

function renderContextProvider(
  context: FigContext<unknown>,
  props: Props,
  frame: RenderFrame,
): void {
  withContextValue(frame.contextValues, context, props.value, () =>
    renderChildren(props.children, frame),
  );
}

function renderAssets(props: Props, frame: RenderFrame): void {
  renderAssetValue(props.assets, frame);
  renderChildren(props.children, frame);
}

function renderAssetValue(value: unknown, frame: RenderFrame): void {
  if (value === undefined || value === null || value === false) return;

  for (const resource of Array.isArray(value) ? value : [value]) {
    if (!isFigAssetResource(resource)) {
      throw new Error("The assets prop must contain Fig asset resources.");
    }

    try {
      if (frame.request.assetRegistry.register(resource)) {
        reportLateHeadAsset(frame.request, resource, frame.stack);
      }
    } catch (error) {
      recordErrorStack(error, frame.stack);
      throw error;
    }

    frame.segment.assetResources.push(resource);
  }
}

function reportLateHeadAsset(
  request: Request,
  resource: FigAssetResource,
  stack: StackFrame | null,
): void {
  if (
    request.headSnapshot === null ||
    assetResourceDestination(resource) !== "head"
  ) {
    return;
  }

  const key = assetResourceKey(resource);
  const error = new Error(
    `Fig head resource "${key}" was discovered after headReady. Move required metadata outside pending Suspense boundaries, or wait for allReady before reading getHead().`,
  );

  try {
    request.onAssetError?.(error, {
      componentStack: componentStack(stack),
      destination: "head",
      key,
      resource,
    });
  } catch {
    // Resource diagnostics are recoverable and should not change render output.
  }
}

function renderSuspense(props: Props, frame: RenderFrame): void {
  const fallbackAbortableTasks = new Set<Task>();
  const contentSegment = createSegment(0, null);
  const boundary = createBoundary(fallbackAbortableTasks, contentSegment);
  boundary.activityId = frame.hiddenActivityId;
  const parentSegment = frame.segment;
  const boundarySegment = createSegment(parentSegment.chunks.length, boundary);
  parentSegment.children.push(boundarySegment);

  contentSegment.parentFlushed = true;
  const contentFrame = createRenderFrame(frame.request, contentSegment, {
    ...forkScope(frame),
    boundary,
  });

  try {
    renderChildren(props.children, contentFrame);
    contentSegment.status = "completed";
    boundary.completedSegments.push(contentSegment);
    if (boundary.pendingTasks === 0) boundary.status = "completed";
  } catch (error) {
    // Suspensions never reach here: renderChildSequence is the single
    // suspend seam and contentFrame always has a boundary, so it spawns a
    // suspended task and returns instead of throwing.
    contentSegment.status = "completed";
    markBoundaryClientRendered(frame.request, boundary, error, frame.stack);
  }

  if (boundary.status === "completed") return;

  const fallbackFrame = createRenderFrame(frame.request, boundarySegment, {
    ...forkScope(frame),
    abortSet: fallbackAbortableTasks,
  });

  try {
    renderChildren(props.fallback as FigNode, fallbackFrame);
    boundarySegment.status = "completed";
  } catch (error) {
    if (boundary.pendingTasks > 0) {
      for (const task of Array.from(boundary.fallbackAbortableTasks)) {
        abortTask(frame.request, task);
      }
    }
    throw error;
  }
}

function renderActivity(props: Props, frame: RenderFrame): void {
  if (props.mode !== "hidden") {
    renderChildren(props.children, frame);
    return;
  }

  // Hidden Activity content streams inside an inert template so neither
  // elements nor bare text render before hydration; the client keeps the
  // boundary dehydrated until reveal. The template carries an id so Suspense
  // boundaries that suspend inside it can stream their completions into this
  // inert content (see `ac`/`ax` in protocol.ts).
  const id = activityId(frame.request, frame.request.nextActivityId++);
  frame.segment.write(
    `<template ${ACTIVITY_TEMPLATE_ATTRIBUTE}="" id="${escapeAttribute(id)}">`,
  );
  const previousHiddenActivityId = frame.hiddenActivityId;
  frame.hiddenActivityId = id;
  try {
    renderChildren(props.children, frame);
  } finally {
    frame.hiddenActivityId = previousHiddenActivityId;
  }
  frame.segment.write("</template>");
}

function renderHostElement(
  type: string,
  props: Props,
  frame: RenderFrame,
): void {
  if (renderHostAsset(type, props, frame)) return;

  if (process.env.NODE_ENV !== "production") {
    validateInstanceNesting(type, frame.hostAncestors);
  }

  const document = frame.request.document;

  if (document !== null && !document.hasHead) {
    if (type !== "html" && type !== "head") throw invalidDocumentShellError();
  }

  if (document !== null && type === "html") {
    frame.segment.write("<!doctype html>");
  }
  if (document !== null && type === "head") {
    document.hasHead = true;
  }

  const isVoid = isVoidElement(type);
  const unsafeHTML = unsafeHTMLContent(props);

  // hasRenderableChild is an O(children) scan; only the error checks need it.
  if (isVoid && hasRenderableChild(props.children)) {
    throw new Error(`Void element <${type}> cannot have children.`);
  }
  if (isVoid && unsafeHTML !== null) {
    throw new Error(`Void element <${type}> cannot have unsafeHTML.`);
  }
  if (unsafeHTML !== null && hasRenderableChild(props.children)) {
    throw new Error("Host elements cannot have both unsafeHTML and children.");
  }

  writeElementStart(type, props, frame.segment, frame.selectProps ?? {});
  if (isVoid) return;

  if (unsafeHTML !== null) {
    frame.segment.write(unsafeHTML);
    writeElementEnd(type, frame.segment);
    return;
  }

  const formText = formTextContent(type, props);
  if (formText !== null) {
    writeText(formText, frame.segment);
    writeElementEnd(type, frame.segment);
    return;
  }

  const previousSelectProps = frame.selectProps;
  if (type === "select") frame.selectProps = props;
  const previousHostAncestors = frame.hostAncestors;
  if (process.env.NODE_ENV !== "production") {
    frame.hostAncestors = [type, ...previousHostAncestors];
  }

  try {
    // Suspensions are handled inside renderChildSequence (the single suspend
    // seam), so no thenable can reach this frame; plain errors propagate.
    renderChildren(props.children, frame);
  } finally {
    frame.selectProps = previousSelectProps;
    frame.hostAncestors = previousHostAncestors;
  }
  if (document !== null && type === "head") {
    frame.segment.write(documentHeadMarker);
  }
  writeElementEnd(type, frame.segment);
}

function renderHostAsset(
  type: string,
  props: Props,
  frame: RenderFrame,
): boolean {
  const resource = assetResourceFromHostProps(type, props);
  if (resource === null) return false;

  renderAssetValue(resource, frame);
  return true;
}

function spawnSuspendedTask(
  frame: RenderFrame,
  node: FigNode,
  thenable: Thenable,
): void {
  const request = frame.request;
  const segment = createSegment(frame.segment.chunks.length, null);
  frame.segment.children.push(segment);

  const task = createTask(request, node, segment, forkScope(frame));
  thenable.then(
    () => pingTask(request, task),
    () => pingTask(request, task),
  );
}

function pingTask(request: Request, task: Task): void {
  if (request.status === "closed" || request.status === "aborting") return;
  request.pingedTasks.push(task);
  // Many thenables settling in one tick ping many tasks; one performWork
  // pass drains them all, so schedule at most one.
  if (request.workScheduled) return;
  request.workScheduled = true;
  queueMicrotask(() => {
    request.workScheduled = false;
    performWork(request);
  });
}

function finishedTask(request: Request, task: Task, segment: Segment): void {
  request.pendingTasks -= 1;

  const boundary = task.boundary;
  if (boundary === null) {
    request.pendingRootTasks -= 1;
    request.completedRootSegment = segment;
    if (request.pendingRootTasks === 0) finishRootShell(request);
  } else {
    boundary.pendingTasks -= 1;

    if (segment.parentFlushed) {
      enqueueUnique(boundary.completedSegments, segment);
    }

    if (!completeBoundaryIfReady(request, boundary) && boundary.parentFlushed) {
      request.partialBoundaries.add(boundary);
    }
  }

  if (request.pendingTasks === 0) request.allReady.resolve(undefined);
}

function erroredTask(request: Request, task: Task, error: unknown): void {
  request.pendingTasks -= 1;

  const boundary = task.boundary;
  if (boundary === null) {
    request.pendingRootTasks -= 1;
    fatalError(request, error);
    return;
  }

  boundary.pendingTasks -= 1;
  markBoundaryClientRendered(request, boundary, error, task.stack);

  if (request.pendingTasks === 0) request.allReady.resolve(undefined);
}

function detachTask(request: Request, task: Task): void {
  task.abortSet.delete(task);
  request.abortableTasks.delete(task);
}

function abortTask(request: Request, task: Task): void {
  if (!request.abortableTasks.delete(task)) return;

  task.segment.status = "completed";
  task.abortSet.delete(task);
  request.pendingTasks -= 1;

  const boundary = task.boundary;
  if (boundary === null) {
    request.pendingRootTasks -= 1;
    if (request.pendingRootTasks === 0) finishRootShell(request);
  } else {
    boundary.pendingTasks -= 1;
    completeBoundaryIfReady(request, boundary);
  }

  if (request.pendingTasks === 0) request.allReady.resolve(undefined);
}

function completeBoundaryIfReady(
  request: Request,
  boundary: SuspenseBoundary,
): boolean {
  if (boundary.pendingTasks !== 0 || boundary.status !== "pending") {
    return false;
  }

  boundary.status = "completed";
  abortFallbackTasks(request, boundary);
  if (boundary.parentFlushed) request.completedBoundaries.add(boundary);
  return true;
}

function abortFallbackTasks(
  request: Request,
  boundary: SuspenseBoundary,
): void {
  for (const fallbackTask of Array.from(boundary.fallbackAbortableTasks)) {
    abortTask(request, fallbackTask);
  }
}

function markBoundaryClientRendered(
  request: Request,
  boundary: SuspenseBoundary,
  error: unknown,
  stack: StackFrame | null,
): void {
  if (boundary.status !== "client-rendered") {
    boundary.status = "client-rendered";
    boundary.error = reportBoundaryError(request, error, stack);
  }

  boundary.completedSegments = [];
  request.completedBoundaries.delete(boundary);
  request.partialBoundaries.delete(boundary);

  for (const task of Array.from(request.abortableTasks)) {
    if (task.boundary === boundary) abortTask(request, task);
  }

  for (const task of Array.from(boundary.fallbackAbortableTasks)) {
    abortTask(request, task);
  }

  if (boundary.parentFlushed) {
    request.clientRenderedBoundaries.add(boundary);
  }
}

function abort(request: Request, reason?: unknown): void {
  if (request.status === "closed") return;
  request.status = "aborting";
  request.dataStore.dispose();
  const error = abortError(reason);
  request.fatalError = error;

  if (request.pendingRootTasks > 0) {
    fatalError(request, error);
    return;
  }

  for (const task of Array.from(request.abortableTasks)) {
    const boundary = task.boundary;
    if (boundary !== null) {
      markBoundaryClientRendered(request, boundary, error, task.stack);
    }
  }

  request.abortableTasks.clear();
  request.pendingTasks = 0;
  request.allReady.resolve(undefined);
  flushCompletedQueues(request);
}

function fatalError(request: Request, error: unknown): void {
  if (request.status === "closed") return;

  request.status = "closed";
  request.dataStore.dispose();
  request.fatalError = error;
  request.headReady.reject(error);
  request.shellReady.reject(error);
  request.allReady.reject(error);
  request.controller?.error(error);
}

function finishRootShell(request: Request): void {
  if (request.document !== null && !request.document.hasHead) {
    fatalError(request, invalidDocumentShellError());
    return;
  }

  if (!request.prerender) sealHead(request);
  request.shellReady.resolve(undefined);
}

function flushCompletedQueues(request: Request): void {
  if (request.controller === null || request.status === "closed") return;
  if (request.status === "opening") return;
  if (request.pendingRootTasks > 0) return;
  if (request.prerender && request.pendingTasks > 0) return;

  sealHead(request);

  if (request.completedRootSegment !== null) {
    flushSegment(request, request.completedRootSegment);
    request.completedRootSegment = null;
    flushWriteBuffer(request);
  }

  drainBoundaryQueue(
    request,
    request.clientRenderedBoundaries,
    flushClientRenderedBoundary,
  );
  drainBoundaryQueue(
    request,
    request.completedBoundaries,
    flushCompletedBoundary,
  );
  drainBoundaryQueue(request, request.partialBoundaries, flushPartialBoundary);

  flushWriteBuffer(request);

  if (
    request.pendingTasks === 0 &&
    request.completedBoundaries.size === 0 &&
    request.clientRenderedBoundaries.size === 0 &&
    request.partialBoundaries.size === 0
  ) {
    request.status = "closed";
    request.dataStore.dispose();
    request.controller.close();
  }
}

function flushSegment(request: Request, segment: Segment): void {
  if (segment.boundary !== null) {
    flushSuspenseBoundary(request, segment, segment.boundary);
    return;
  }

  flushSubtree(request, segment);
}

function flushSubtree(request: Request, segment: Segment): void {
  segment.parentFlushed = true;

  if (segment.status === "pending" || segment.status === "rendering") {
    write(
      request,
      placeholderMarkup(request, ensureSegmentId(request, segment)),
    );
    return;
  }

  if (segment.status === "flushed") return;

  segment.status = "flushed";
  if (request.document === null || segment !== request.rootSegment) {
    flushSegmentAssets(request, segment);
  }
  let chunkIndex = 0;

  for (const child of segment.children) {
    for (; chunkIndex < child.index; chunkIndex += 1) {
      writeChunk(request, segment.chunks[chunkIndex], segment);
    }
    flushSegment(request, child);
  }

  for (; chunkIndex < segment.chunks.length; chunkIndex += 1) {
    writeChunk(request, segment.chunks[chunkIndex], segment);
  }
}

function flushSuspenseBoundary(
  request: Request,
  segment: Segment,
  boundary: SuspenseBoundary,
): void {
  segment.boundary = null;
  boundary.parentFlushed = true;

  if (boundary.status === "completed") {
    write(request, `<!--${SUSPENSE_COMPLETED_MARKER}-->`);
    flushBoundaryContent(request, boundary);
    write(request, `<!--${SUSPENSE_END_MARKER}-->`);
    return;
  }

  if (request.prerender && boundary.status === "client-rendered") {
    // Static prerender does not hoist assets discovered only in failed content:
    // the retry path loads them on demand, and pure-static consumers see only
    // the fallback.
    write(request, `<!--${SUSPENSE_CLIENT_MARKER}-->`);
    write(request, clientRenderedBoundaryPlaceholderMarkup(request, boundary));
    flushSubtree(request, segment);
    write(request, `<!--${SUSPENSE_END_MARKER}-->`);
    return;
  }

  const boundaryIdValue = ensureBoundaryId(request, boundary);
  flushSegmentAssets(request, boundary.contentSegment);
  write(request, `<!--${SUSPENSE_PENDING_PREFIX}${boundaryIdValue}-->`);
  write(request, boundaryPlaceholderMarkup(request, boundaryIdValue));
  flushSubtree(request, segment);
  write(request, `<!--${SUSPENSE_END_MARKER}-->`);

  if (boundary.status === "client-rendered") {
    request.clientRenderedBoundaries.add(boundary);
  } else if (boundary.completedSegments.length > 0) {
    request.partialBoundaries.add(boundary);
  }
}

function flushBoundaryContent(
  request: Request,
  boundary: SuspenseBoundary,
): void {
  for (const segment of boundary.completedSegments) {
    flushSegment(request, segment);
  }
  boundary.completedSegments = [];
}

function clientRenderedBoundaryPlaceholderMarkup(
  request: Request,
  boundary: SuspenseBoundary,
): string {
  const id = escapeAttribute(
    boundaryId(request, ensureBoundaryId(request, boundary)),
  );
  const digest = boundary.error?.digest;
  const message = boundary.error?.message;
  const digestAttr =
    digest === undefined || digest === ""
      ? ""
      : ` data-dgst="${escapeAttribute(digest)}"`;
  const messageAttr =
    message === undefined || message === ""
      ? ""
      : ` data-msg="${escapeAttribute(message)}"`;

  return `<template id="${id}"${digestAttr}${messageAttr}></template>`;
}

function sealHead(request: Request): void {
  if (request.headSnapshot !== null) return;

  const head = request.assetRegistry.headHtml(request.nonce);
  request.headSnapshot = head;
  request.headReady.resolve(head);
}

function flushCompletedBoundary(
  request: Request,
  boundary: SuspenseBoundary,
): void {
  flushPartialBoundary(request, boundary);
  writeBoundaryRevealScript(request, boundary);
}

function flushPartialBoundary(
  request: Request,
  boundary: SuspenseBoundary,
): void {
  for (const segment of boundary.completedSegments) {
    flushBoundarySegment(request, boundary, segment);
  }
  boundary.completedSegments = [];
}

function flushBoundarySegment(
  request: Request,
  boundary: SuspenseBoundary,
  segment: Segment,
): void {
  ensureBoundaryId(request, boundary);
  ensureSegmentId(request, segment);
  const blockingIds = flushSegmentContainer(request, segment);

  if (segment !== boundary.contentSegment) {
    writeSegmentRevealScript(request, segment, blockingIds);
  }
}

function writeSegmentRevealScript(
  request: Request,
  segment: Segment,
  blockingIds: string[],
): void {
  const id = ensureSegmentId(request, segment);
  writeRuntime(request);
  // Partial segments — including those of a hidden-Activity boundary — stage and
  // fill in light-DOM hidden divs; only the boundary's final reveal (`ac`) moves
  // the assembled content into the inert activity template.
  writeScript(
    request,
    withAssetGate(
      request,
      blockingIds,
      `${RUNTIME_REF}.s(${jsString(placeholderId(request, id))},${jsString(
        segmentId(request, id),
      )})`,
    ),
  );
}

function writeBoundaryRevealScript(
  request: Request,
  boundary: SuspenseBoundary,
): void {
  const blockingIds = flushSegmentAssets(request, boundary.contentSegment);
  writeRuntime(request);
  const boundaryRef = jsString(
    boundaryId(request, ensureBoundaryId(request, boundary)),
  );
  const contentRef = jsString(
    segmentId(request, ensureSegmentId(request, boundary.contentSegment)),
  );
  // Inside a hidden Activity the boundary markers live in the activity
  // template's inert content; reveal the completion there with `ac`.
  const runtime = RUNTIME_REF;
  const call =
    boundary.activityId === null
      ? `${runtime}.c(${boundaryRef},${contentRef})`
      : `${runtime}.ac(${jsString(boundary.activityId)},${boundaryRef},${contentRef})`;
  writeScript(request, withAssetGate(request, blockingIds, call));
}

function flushSegmentContainer(request: Request, segment: Segment): string[] {
  if (segment.status === "flushed") return [];
  const blockingIds = flushSegmentAssets(request, segment);

  write(
    request,
    segmentContainerStartMarkup(request, ensureSegmentId(request, segment)),
  );
  flushSegment(request, segment);
  write(request, "</div>");
  return blockingIds;
}

function flushSegmentAssets(request: Request, segment: Segment): string[] {
  const blockingIds = new Set<string>();
  collectSegmentAssets(request, segment, request.assetSink, blockingIds);
  return [...blockingIds];
}

function collectSegmentAssets(
  request: Request,
  segment: Segment,
  sink: AssetSink,
  blockingIds: Set<string>,
): void {
  if (segment.status !== "pending" && segment.status !== "rendering") {
    flushAssetList(request, segment.assetResources, sink, blockingIds);
  }

  for (const child of segment.children) {
    collectSegmentAssets(request, child, sink, blockingIds);
  }
}

function flushAssetList(
  request: Request,
  resources: FigAssetResource[],
  sink: AssetSink,
  blockingIds: Set<string>,
): void {
  for (const resource of resources) {
    const id = request.assetRegistry.write(resource, sink);
    if (id !== null) blockingIds.add(id);
  }
}

function withAssetGate(
  request: Request,
  blockingIds: string[],
  call: string,
): string {
  if (blockingIds.length === 0) return call;
  return `${RUNTIME_REF}.r([${blockingIds.map(jsString).join(",")}],()=>{${call}})`;
}

function flushClientRenderedBoundary(
  request: Request,
  boundary: SuspenseBoundary,
): void {
  if (boundary.id === null) return;
  writeRuntime(request);
  const boundaryRef = jsString(boundaryId(request, boundary.id));
  const digest = jsString(boundary.error?.digest ?? "");
  const message = jsString(boundary.error?.message ?? "");
  const runtime = RUNTIME_REF;
  const call =
    boundary.activityId === null
      ? `${runtime}.x(${boundaryRef},${digest},${message})`
      : `${runtime}.ax(${jsString(boundary.activityId)},${boundaryRef},${digest},${message})`;
  writeScript(request, call);
}

// A boundary deliberately stays in the queue while it flushes so a re-add
// during its own flush is a no-op (Set semantics), then leaves afterwards.
function drainBoundaryQueue(
  request: Request,
  queue: Set<SuspenseBoundary>,
  flush: (request: Request, boundary: SuspenseBoundary) => void,
): void {
  for (;;) {
    const first = queue.values().next();
    if (first.done === true) return;
    flush(request, first.value);
    queue.delete(first.value);
    // One encoded enqueue per drained boundary: keeps chunk boundaries at
    // meaningful stream points (consumers interleave companion content per
    // chunk) while still coalescing the per-attribute writes within.
    flushWriteBuffer(request);
  }
}

function enqueueUnique<T>(queue: T[], item: T): void {
  if (!queue.includes(item)) queue.push(item);
}

function reportBoundaryError(
  request: Request,
  error: unknown,
  stack: StackFrame | null,
): ServerErrorPayload {
  const info = { componentStack: componentStack(stackForError(error, stack)) };
  try {
    return request.onError?.(error, info) ?? {};
  } catch {
    return {};
  }
}

function recordErrorStack(error: unknown, stack: StackFrame | null): void {
  if (stack === null) return;
  if (typeof error !== "object" && typeof error !== "function") return;
  if (error === null || isThenable(error)) return;
  if (!errorStacks.has(error)) errorStacks.set(error, stack);
}

function stackForError(
  error: unknown,
  fallback: StackFrame | null,
): StackFrame | null {
  if (
    (typeof error !== "object" && typeof error !== "function") ||
    error === null
  ) {
    return fallback;
  }

  return errorStacks.get(error) ?? fallback;
}

function writeRuntime(request: Request): void {
  writeProtocolRuntime(request, (chunk) => write(request, chunk));
}

// Classic <script> elements share the page's global lexical environment, so a
// top-level `let` would redeclare across op scripts and throw; the IIFE keeps
// a per-script binding that async op callbacks (the stylesheet gate) close
// over even if a later stream rebinds the runtime name.
function writeScript(request: Request, code: string): void {
  writeProtocolScript(
    request,
    `(__figSSR=>{${code}})(globalThis[${jsString(request.runtimeName)}])`,
    (chunk) => write(request, chunk),
  );
}

function createRuntimeName(identifierPrefix: string | undefined): string {
  const id = nextRuntimeId.toString(36);
  nextRuntimeId += 1;
  const prefix = identifierPrefix?.replace(/[^A-Za-z0-9_$]/g, "_") ?? "";
  return prefix === "" ? `__figSSR_${id}` : `__figSSR_${prefix}_${id}`;
}

function writeChunk(request: Request, chunk: string, segment: Segment): void {
  if (request.document === null || chunk !== documentHeadMarker) {
    write(request, chunk);
    return;
  }

  write(request, request.assetRegistry.headHtml(request.nonce));
  flushAssetList(request, segment.assetResources, request.assetSink, new Set());
}

function write(request: Request, chunk: string): void {
  request.writeBuffer.push(chunk);
}

function flushWriteBuffer(request: Request): void {
  if (request.writeBuffer.length === 0 || request.controller === null) return;
  request.controller.enqueue(textEncoder.encode(request.writeBuffer.join("")));
  request.writeBuffer = [];
}

function invalidDocumentShellError(): Error {
  return new Error(
    "renderToDocumentStream requires the root to render an <html> document with a <head>.",
  );
}

function ensureSegmentId(request: Request, segment: Segment): number {
  segment.id ??= request.nextSegmentId++;
  return segment.id;
}

function ensureBoundaryId(
  request: Request,
  boundary: SuspenseBoundary,
): number {
  boundary.id ??= request.nextBoundaryId++;
  return boundary.id;
}

function componentStack(stack: StackFrame | null): string {
  const frames: string[] = [];
  for (let frame = stack; frame !== null; frame = frame.parent) {
    frames.push(`    at ${frame.name}`);
  }
  return frames.length === 0 ? "" : `\n${frames.join("\n")}`;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) throw abortReason(signal.reason);
}

function throwIfAborting(request: Request): void {
  if (request.status === "aborting") throw abortReason(request.fatalError);
}

function abortError(reason: unknown): Error {
  if (reason instanceof Error) return reason;
  return new Error(
    typeof reason === "string" ? reason : "Server render was aborted.",
  );
}

function abortReason(reason: unknown): unknown {
  return reason ?? new Error("Server render was aborted.");
}

function describeElementType(type: ElementType): string {
  if (typeof type === "symbol") return String(type);
  if (typeof type === "function") return type.name || "anonymous function";
  return typeof type;
}
