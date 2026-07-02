import {
  type ElementType,
  type FigChild,
  type FigClientReference,
  type FigContext,
  type FigElement,
  type FigNode,
  type FigResource,
  Fragment,
  type Props,
} from "@bgub/fig";
import {
  figResourceKey,
  isClientReference,
  isContext,
  isActivity,
  isErrorBoundary,
  isFigResource,
  isPortal,
  isResources,
  isSuspense,
  isValidElement,
  resourceDestination,
  resourceFromHostProps,
  setCurrentDispatcher,
  setCurrentDataStore,
  type RenderDispatcher,
  ACTIVITY_TEMPLATE_ATTRIBUTE,
  SUSPENSE_COMPLETED_MARKER,
  SUSPENSE_END_MARKER,
  SUSPENSE_PENDING_PREFIX,
  validateInstanceNesting,
  validateTextNesting,
} from "@bgub/fig/internal";
import { createDataStore, type DataStore } from "@bgub/fig-data";
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
  cloneContextValues,
  createStaticDispatcher,
  describeInvalidChild,
  isThenable,
  readThenable,
  type Thenable,
  withContextValue,
} from "./shared.ts";
import { ResourceRegistry } from "./resources.ts";
import type {
  ServerErrorPayload,
  ServerRenderOptions,
  ServerRenderRequest,
} from "./types.ts";

declare const process: { env: { NODE_ENV?: string } };

interface Request {
  abortableTasks: Set<Task>;
  allReady: Promise<void>;
  closeAllReady(): void;
  closeHeadReady(): void;
  closeShellReady(): void;
  completedBoundaries: SuspenseBoundary[];
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
  onResourceError?: ServerRenderOptions["onResourceError"];
  onShellError?: (error: unknown) => void;
  pendingRootTasks: number;
  pendingTasks: number;
  pingedTasks: Task[];
  recoverShellReady(error: unknown): void;
  recoverHeadReady(error: unknown): void;
  recoverAllReady(error: unknown): void;
  rootSegment: Segment;
  runtimeWritten: boolean;
  headReady: Promise<void>;
  headSealed: boolean;
  shellReady: Promise<void>;
  status: "opening" | "open" | "aborting" | "closed";
  stream: ReadableStream<Uint8Array>;
  textEncoder: TextEncoder;
  clientRenderedBoundaries: SuspenseBoundary[];
  clientReferenceFallback?: ServerRenderOptions["clientReferenceFallback"];
  partialBoundaries: SuspenseBoundary[];
  componentResources?: ServerRenderOptions["resources"];
  document: DocumentState | null;
  resourceRegistry: ResourceRegistry;
  resolveResourceKey?: ServerRenderOptions["resolveResourceKey"];
}

interface Task {
  abortSet: Set<Task>;
  blockedBoundary: SuspenseBoundary | null;
  contextValues: ContextValues;
  hiddenActivity: boolean;
  // The nearest enclosing hidden Activity's template id, or null when not inside
  // one. Threaded so suspended content streamed for that boundary can be revealed
  // into the activity template's inert content.
  hiddenActivityId: string | null;
  // Logical host-ancestor tags (nearest first) for DOM-nesting validation.
  // Suspended segments stream into staging nodes but are moved into place on
  // the client, so their spawn-point ancestors stay authoritative.
  hostAncestors: readonly string[];
  idPath: string;
  node: FigNode;
  selectProps: Props | null;
  segment: Segment;
  stack: StackFrame | null;
}

interface Segment {
  boundary: SuspenseBoundary | null;
  children: Segment[];
  chunks: string[];
  id: number | null;
  index: number;
  parentFlushed: boolean;
  resources: FigResource[];
  status: SegmentStatus;
  write(chunk: string): void;
}

interface SuspenseBoundary {
  // Non-null when this boundary lives inside a hidden Activity: the activity
  // template id its streamed completion must be revealed into. See `ac`/`ax` in
  // protocol.ts.
  activityId: string | null;
  completedSegments: Segment[];
  contentSegment: Segment | null;
  contentSegmentId: number | null;
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

interface RenderFrame {
  abortSet: Set<Task>;
  boundary: SuspenseBoundary | null;
  contextValues: ContextValues;
  dispatcher: RenderDispatcher;
  hiddenActivity: boolean;
  hiddenActivityId: string | null;
  hostAncestors: readonly string[];
  request: Request;
  segment: Segment;
  idPath: string;
  localIdCounter: number;
  selectProps: Props | null;
  stack: StackFrame | null;
}

interface StackFrame {
  name: string;
  parent: StackFrame | null;
}

interface DocumentState {
  hasHead: boolean;
}

interface Deferred {
  promise: Promise<void>;
  reject(this: void, error: unknown): void;
  resolve(this: void): void;
}

interface ResourceSink {
  nonce?: string;
  write(chunk: string): void;
}

const errorStacks = new WeakMap<object, StackFrame>();
const documentHeadMarker = "\u0000fig:head\u0000";

export function createServerRenderRequest(
  node: FigNode,
  options: ServerRenderOptions = {},
  mode: { document?: boolean } = {},
): ServerRenderRequest {
  throwIfAborted(options.signal);

  const textEncoder = new TextEncoder();
  const shellReady = deferred();
  const headReady = deferred();
  const allReady = deferred();
  const rootSegment = createSegment(0, null);

  const request: Request = {
    abortableTasks: new Set<Task>(),
    allReady: allReady.promise,
    closeAllReady: allReady.resolve,
    closeHeadReady: headReady.resolve,
    closeShellReady: shellReady.resolve,
    completedBoundaries: [],
    completedRootSegment: null,
    controller: null,
    dataStore: createDataStore<object, null>({
      context: options.dataContext ?? {},
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
    onResourceError: options.onResourceError,
    onShellError: options.onShellError,
    pendingRootTasks: 0,
    pendingTasks: 0,
    pingedTasks: [],
    recoverAllReady: allReady.reject,
    recoverHeadReady: headReady.reject,
    recoverShellReady: shellReady.reject,
    rootSegment,
    runtimeWritten: false,
    headReady: headReady.promise,
    headSealed: false,
    shellReady: shellReady.promise,
    status: "opening",
    stream: null as never,
    textEncoder,
    clientRenderedBoundaries: [],
    clientReferenceFallback: options.clientReferenceFallback,
    partialBoundaries: [],
    componentResources: options.resources,
    document: mode.document === true ? { hasHead: false } : null,
    resourceRegistry: new ResourceRegistry(options.identifierPrefix ?? ""),
    resolveResourceKey: options.resolveResourceKey,
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
  const rootTask = createTask(
    request,
    node,
    null,
    rootSegment,
    new Map(),
    request.abortableTasks,
    "",
    null,
    null,
    false,
    null,
    [],
  );
  request.pingedTasks.push(rootTask);

  if (options.signal !== undefined) {
    options.signal.addEventListener(
      "abort",
      () => abort(request, options.signal?.reason),
      { once: true },
    );
  }

  queueMicrotask(() => performWork(request));

  return {
    abort: (reason?: unknown) => abort(request, reason),
    allReady: allReady.promise,
    getData: () => request.dataStore.snapshot(),
    getHead: () => request.resourceRegistry.headHtml(request.nonce),
    headReady: headReady.promise,
    shellReady: shellReady.promise,
    stream,
  };
}

function deferred(): Deferred {
  let resolve: () => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;

  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = () => resolvePromise();
    reject = (error: unknown) => rejectPromise(error);
  });

  return { promise, reject, resolve };
}

function createTask(
  request: Request,
  node: FigNode,
  blockedBoundary: SuspenseBoundary | null,
  segment: Segment,
  contextValues: ContextValues,
  abortSet: Set<Task>,
  idPath: string,
  selectProps: Props | null,
  stack: StackFrame | null,
  hiddenActivity: boolean,
  hiddenActivityId: string | null,
  hostAncestors: readonly string[],
): Task {
  request.pendingTasks += 1;
  if (blockedBoundary === null) {
    request.pendingRootTasks += 1;
  } else {
    blockedBoundary.pendingTasks += 1;
  }

  const task: Task = {
    abortSet,
    blockedBoundary,
    contextValues,
    hiddenActivity,
    hiddenActivityId,
    hostAncestors,
    idPath,
    node,
    selectProps,
    segment,
    stack,
  };
  request.abortableTasks.add(task);
  abortSet.add(task);
  return task;
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
    resources: [],
    status: "pending",
    write(chunk) {
      this.chunks.push(chunk);
    },
  };
}

function createBoundary(fallbackAbortableTasks: Set<Task>): SuspenseBoundary {
  return {
    activityId: null,
    completedSegments: [],
    contentSegment: null,
    contentSegmentId: null,
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
  const frame = createRenderFrame(
    request,
    task.segment,
    task.blockedBoundary,
    cloneContextValues(task.contextValues),
    task.abortSet,
    task.idPath,
    task.selectProps,
    task.stack,
    task.hiddenActivity,
    task.hiddenActivityId,
    task.hostAncestors,
  );

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
  boundary: SuspenseBoundary | null,
  contextValues: ContextValues,
  abortSet: Set<Task>,
  idPath: string,
  selectProps: Props | null,
  stack: StackFrame | null,
  hiddenActivity: boolean,
  hiddenActivityId: string | null,
  hostAncestors: readonly string[],
): RenderFrame {
  const frame = {
    abortSet,
    boundary,
    contextValues,
    dispatcher: null as unknown as RenderDispatcher,
    hiddenActivity,
    hiddenActivityId,
    hostAncestors,
    idPath,
    localIdCounter: 0,
    request,
    selectProps,
    segment,
    stack,
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
      frame.request.dataStore.preloadData(resource, args);
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

function renderChildSequence(children: FigChild[], frame: RenderFrame): void {
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

  if (isResources(type)) {
    renderResources(element.props, frame);
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
    if (element.props.mode === "hidden") {
      // Hidden Activity content streams inside an inert template so neither
      // elements nor bare text render before hydration; the client keeps the
      // boundary dehydrated until reveal. The template carries an id so Suspense
      // boundaries that suspend inside it can stream their completions into this
      // inert content (see `ac`/`ax` in protocol.ts).
      const id = activityId(frame.request, frame.request.nextActivityId++);
      frame.segment.write(
        `<template ${ACTIVITY_TEMPLATE_ATTRIBUTE}="" id="${escapeAttribute(id)}">`,
      );
      const wasHidden = frame.hiddenActivity;
      const wasHiddenId = frame.hiddenActivityId;
      frame.hiddenActivity = true;
      frame.hiddenActivityId = id;
      try {
        renderChildren(element.props.children, frame);
      } finally {
        frame.hiddenActivity = wasHidden;
        frame.hiddenActivityId = wasHiddenId;
      }
      frame.segment.write("</template>");
      return;
    }

    renderChildren(element.props.children, frame);
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
    renderComponentResources(type, frame);
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
  const fallback = frame.request.clientReferenceFallback;
  if (fallback === undefined) {
    renderFunctionComponent(type as Component, props, frame);
    return;
  }

  renderComponentResources(type, frame);
  renderChildren(fallback(type, props), frame);
}

function renderComponentResources(type: ElementType, frame: RenderFrame): void {
  const key = isClientReference(type)
    ? type.id
    : frame.request.resolveResourceKey?.(type);
  if (key !== undefined) {
    renderResourceValue(frame.request.componentResources?.[key], frame);
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

function renderResources(props: Props, frame: RenderFrame): void {
  renderResourceValue(props.resources, frame);
  renderChildren(props.children, frame);
}

function renderResourceValue(value: unknown, frame: RenderFrame): void {
  if (value === undefined || value === null || value === false) return;

  for (const resource of Array.isArray(value) ? value : [value]) {
    if (!isFigResource(resource)) {
      throw new Error("The resources prop must contain Fig resources.");
    }

    try {
      if (frame.request.resourceRegistry.register(resource)) {
        reportLateHeadResource(frame.request, resource, frame.stack);
      }
    } catch (error) {
      recordErrorStack(error, frame.stack);
      throw error;
    }

    frame.segment.resources.push(resource);
  }
}

function reportLateHeadResource(
  request: Request,
  resource: FigResource,
  stack: StackFrame | null,
): void {
  if (!request.headSealed || resourceDestination(resource) !== "head") return;

  const key = figResourceKey(resource);
  const error = new Error(
    `Fig head resource "${key}" was discovered after headReady. Move required metadata outside pending Suspense boundaries, or wait for allReady before reading getHead().`,
  );

  try {
    request.onResourceError?.(error, {
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
  const boundary = createBoundary(fallbackAbortableTasks);
  boundary.activityId = frame.hiddenActivityId;
  const parentSegment = frame.segment;
  const boundarySegment = createSegment(parentSegment.chunks.length, boundary);
  parentSegment.children.push(boundarySegment);

  const contentSegment = createSegment(0, null);
  boundary.contentSegment = contentSegment;
  contentSegment.parentFlushed = true;
  const contentFrame = createRenderFrame(
    frame.request,
    contentSegment,
    boundary,
    cloneContextValues(frame.contextValues),
    frame.abortSet,
    frame.idPath,
    frame.selectProps,
    frame.stack,
    frame.hiddenActivity,
    frame.hiddenActivityId,
    frame.hostAncestors,
  );

  try {
    renderChildren(props.children, contentFrame);
    contentSegment.status = "completed";
    boundary.completedSegments.push(contentSegment);
    if (boundary.pendingTasks === 0) boundary.status = "completed";
  } catch (error) {
    contentSegment.status = "completed";

    if (isThenable(error)) {
      // Suspended content streams in later. Inside a hidden Activity the
      // boundary's markers live in the activity's inert template; its
      // completion is revealed into that template content (boundary.activityId
      // drives the Activity-aware flush variants) instead of
      // degrading to a client render.
      spawnSuspendedTask(contentFrame, props.children, error);
      boundary.completedSegments.push(contentSegment);
    } else {
      markBoundaryClientRendered(frame.request, boundary, error, frame.stack);
    }
  }

  if (boundary.status === "completed") return;

  const fallbackFrame = createRenderFrame(
    frame.request,
    boundarySegment,
    frame.boundary,
    cloneContextValues(frame.contextValues),
    fallbackAbortableTasks,
    frame.idPath,
    frame.selectProps,
    frame.stack,
    frame.hiddenActivity,
    frame.hiddenActivityId,
    frame.hostAncestors,
  );

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

function renderHostElement(
  type: string,
  props: Props,
  frame: RenderFrame,
): void {
  if (renderHostResource(type, props, frame)) return;

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
  const hasChildren = hasRenderableChild(props.children);

  if (isVoid && hasChildren) {
    throw new Error(`Void element <${type}> cannot have children.`);
  }
  if (isVoid && unsafeHTML !== null) {
    throw new Error(`Void element <${type}> cannot have unsafeHTML.`);
  }
  if (unsafeHTML !== null && hasChildren) {
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
    renderChildren(props.children, frame);
  } catch (error) {
    if (isThenable(error) && frame.boundary !== null) {
      spawnSuspendedTask(frame, props.children, error);
    } else {
      throw error;
    }
  } finally {
    frame.selectProps = previousSelectProps;
    frame.hostAncestors = previousHostAncestors;
  }
  if (document !== null && type === "head") {
    frame.segment.write(documentHeadMarker);
  }
  writeElementEnd(type, frame.segment);
}

function renderHostResource(
  type: string,
  props: Props,
  frame: RenderFrame,
): boolean {
  const resource = resourceFromHostProps(type, props);
  if (resource === null) return false;

  renderResourceValue(resource, frame);
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

  const task = createTask(
    request,
    node,
    frame.boundary,
    segment,
    cloneContextValues(frame.contextValues),
    frame.abortSet,
    frame.idPath,
    frame.selectProps,
    frame.stack,
    frame.hiddenActivity,
    frame.hiddenActivityId,
    frame.hostAncestors,
  );
  thenable.then(
    () => pingTask(request, task),
    () => pingTask(request, task),
  );
}

function pingTask(request: Request, task: Task): void {
  if (request.status === "closed" || request.status === "aborting") return;
  request.pingedTasks.push(task);
  queueMicrotask(() => performWork(request));
}

function finishedTask(request: Request, task: Task, segment: Segment): void {
  request.pendingTasks -= 1;

  const boundary = task.blockedBoundary;
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
      enqueueUnique(request.partialBoundaries, boundary);
    }
  }

  if (request.pendingTasks === 0) request.closeAllReady();
}

function erroredTask(request: Request, task: Task, error: unknown): void {
  request.pendingTasks -= 1;

  const boundary = task.blockedBoundary;
  if (boundary === null) {
    request.pendingRootTasks -= 1;
    fatalError(request, error);
    return;
  }

  boundary.pendingTasks -= 1;
  markBoundaryClientRendered(request, boundary, error, task.stack);

  if (request.pendingTasks === 0) request.closeAllReady();
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

  const boundary = task.blockedBoundary;
  if (boundary === null) {
    request.pendingRootTasks -= 1;
    if (request.pendingRootTasks === 0) finishRootShell(request);
  } else {
    boundary.pendingTasks -= 1;
    completeBoundaryIfReady(request, boundary);
  }

  if (request.pendingTasks === 0) request.closeAllReady();
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
  if (boundary.parentFlushed) request.completedBoundaries.push(boundary);
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
  removeQueuedBoundary(request.completedBoundaries, boundary);
  removeQueuedBoundary(request.partialBoundaries, boundary);

  for (const task of Array.from(request.abortableTasks)) {
    if (task.blockedBoundary === boundary) abortTask(request, task);
  }

  for (const task of Array.from(boundary.fallbackAbortableTasks)) {
    abortTask(request, task);
  }

  if (boundary.parentFlushed) {
    enqueueUnique(request.clientRenderedBoundaries, boundary);
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
    const boundary = task.blockedBoundary;
    if (boundary !== null) {
      markBoundaryClientRendered(request, boundary, error, task.stack);
    }
  }

  request.abortableTasks.clear();
  request.pendingTasks = 0;
  request.closeAllReady();
  flushCompletedQueues(request);
}

function fatalError(request: Request, error: unknown): void {
  if (request.status === "closed") return;

  request.status = "closed";
  request.dataStore.dispose();
  request.fatalError = error;
  request.onShellError?.(error);
  request.recoverHeadReady(error);
  request.recoverShellReady(error);
  request.recoverAllReady(error);
  request.controller?.error(error);
}

function finishRootShell(request: Request): void {
  if (request.document !== null && !request.document.hasHead) {
    fatalError(request, invalidDocumentShellError());
    return;
  }

  if (!request.headSealed) {
    request.headSealed = true;
    request.closeHeadReady();
  }
  request.closeShellReady();
}

function flushCompletedQueues(request: Request): void {
  if (request.controller === null || request.status === "closed") return;
  if (request.status === "opening") return;
  if (request.pendingRootTasks > 0) return;

  if (request.completedRootSegment !== null) {
    flushSegment(request, request.completedRootSegment);
    request.completedRootSegment = null;
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

  if (
    request.pendingTasks === 0 &&
    request.completedBoundaries.length === 0 &&
    request.clientRenderedBoundaries.length === 0 &&
    request.partialBoundaries.length === 0
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
    segment.id ??= request.nextSegmentId++;
    write(request, placeholderMarkup(request, segment.id));
    return;
  }

  if (segment.status === "flushed") return;

  segment.status = "flushed";
  if (request.document === null || segment !== request.rootSegment) {
    flushSegmentResources(request, segment);
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

  boundary.id ??= request.nextBoundaryId++;
  if (boundary.contentSegment !== null)
    flushSegmentResources(request, boundary.contentSegment);
  write(request, `<!--${SUSPENSE_PENDING_PREFIX}${boundary.id}-->`);
  write(request, boundaryPlaceholderMarkup(request, boundary.id));
  flushSubtree(request, segment);
  write(request, `<!--${SUSPENSE_END_MARKER}-->`);

  if (boundary.status === "client-rendered") {
    enqueueUnique(request.clientRenderedBoundaries, boundary);
  } else if (boundary.completedSegments.length > 0) {
    enqueueUnique(request.partialBoundaries, boundary);
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

function flushCompletedBoundary(
  request: Request,
  boundary: SuspenseBoundary,
): void {
  boundary.id ??= request.nextBoundaryId++;
  for (const segment of boundary.completedSegments) {
    flushBoundarySegment(request, boundary, segment);
  }
  boundary.completedSegments = [];
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
  boundary.id ??= request.nextBoundaryId++;
  segment.id ??= request.nextSegmentId++;
  if (segment === boundary.contentSegment) {
    boundary.contentSegmentId = segment.id;
  }
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
  const id = requireSegmentId(segment);
  writeRuntime(request);
  // Partial segments — including those of a hidden-Activity boundary — stage and
  // fill in light-DOM hidden divs; only the boundary's final reveal (`ac`) moves
  // the assembled content into the inert activity template.
  writeScript(
    request,
    withResourceGate(
      blockingIds,
      `__figSSR.s(${jsString(placeholderId(request, id))},${jsString(
        segmentId(request, id),
      )})`,
    ),
  );
}

function writeBoundaryRevealScript(
  request: Request,
  boundary: SuspenseBoundary,
): void {
  const blockingIds =
    boundary.contentSegment === null
      ? []
      : flushSegmentResources(request, boundary.contentSegment);
  writeRuntime(request);
  const boundaryRef = jsString(
    boundaryId(request, requireBoundaryId(boundary)),
  );
  const contentRef = jsString(
    segmentId(request, requireBoundaryContentId(boundary)),
  );
  // Inside a hidden Activity the boundary markers live in the activity
  // template's inert content; reveal the completion there with `ac`.
  const call =
    boundary.activityId === null
      ? `__figSSR.c(${boundaryRef},${contentRef})`
      : `__figSSR.ac(${jsString(boundary.activityId)},${boundaryRef},${contentRef})`;
  writeScript(request, withResourceGate(blockingIds, call));
}

function flushSegmentContainer(request: Request, segment: Segment): string[] {
  if (segment.status === "flushed") return [];
  const blockingIds = flushSegmentResources(request, segment);

  write(
    request,
    segmentContainerStartMarkup(request, requireSegmentId(segment)),
  );
  flushSegment(request, segment);
  write(request, "</div>");
  return blockingIds;
}

function flushSegmentResources(request: Request, segment: Segment): string[] {
  const blockingIds = new Set<string>();
  collectSegmentResources(request, segment, resourceSink(request), blockingIds);
  return [...blockingIds];
}

function collectSegmentResources(
  request: Request,
  segment: Segment,
  sink: ResourceSink,
  blockingIds: Set<string>,
): void {
  if (segment.status !== "pending" && segment.status !== "rendering") {
    flushResourceList(request, segment.resources, sink, blockingIds);
  }

  for (const child of segment.children) {
    collectSegmentResources(request, child, sink, blockingIds);
  }
}

function flushResourceList(
  request: Request,
  resources: FigResource[],
  sink: ResourceSink,
  blockingIds: Set<string>,
): void {
  for (const resource of resources) {
    const id = request.resourceRegistry.write(resource, sink);
    if (id !== null) blockingIds.add(id);
  }
}

function withResourceGate(blockingIds: string[], call: string): string {
  if (blockingIds.length === 0) return call;
  return `__figSSR.r([${blockingIds.map(jsString).join(",")}],()=>{${call}})`;
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
  const call =
    boundary.activityId === null
      ? `__figSSR.x(${boundaryRef},${digest},${message})`
      : `__figSSR.ax(${jsString(boundary.activityId)},${boundaryRef},${digest},${message})`;
  writeScript(request, call);
}

function drainBoundaryQueue(
  request: Request,
  queue: SuspenseBoundary[],
  flush: (request: Request, boundary: SuspenseBoundary) => void,
): void {
  while (queue.length > 0) {
    const boundary = queue[0];
    flush(request, boundary);
    queue.splice(0, 1);
  }
}

function enqueueUnique<T>(queue: T[], item: T): void {
  if (!queue.includes(item)) queue.push(item);
}

function removeQueuedBoundary(
  queue: SuspenseBoundary[],
  boundary: SuspenseBoundary,
): void {
  for (let index = queue.length - 1; index >= 0; index -= 1) {
    if (queue[index] === boundary) queue.splice(index, 1);
  }
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

function writeScript(request: Request, code: string): void {
  writeProtocolScript(request, code, (chunk) => write(request, chunk));
}

function writeChunk(request: Request, chunk: string, segment: Segment): void {
  if (request.document === null || chunk !== documentHeadMarker) {
    write(request, chunk);
    return;
  }

  write(request, request.resourceRegistry.headHtml(request.nonce));
  flushResourceList(
    request,
    segment.resources,
    resourceSink(request),
    new Set(),
  );
}

function resourceSink(request: Request): ResourceSink {
  return {
    nonce: request.nonce,
    write: (chunk) => write(request, chunk),
  };
}

function write(request: Request, chunk: string): void {
  request.controller?.enqueue(request.textEncoder.encode(chunk));
}

function invalidDocumentShellError(): Error {
  return new Error(
    "renderToDocumentStream requires the root to render an <html> document with a <head>.",
  );
}

function requireSegmentId(segment: Segment): number {
  if (segment.id === null) {
    throw new Error("Expected a segment id before flushing.");
  }
  return segment.id;
}

function requireBoundaryId(boundary: SuspenseBoundary): number {
  if (boundary.id === null) {
    throw new Error("Expected a Suspense boundary id before revealing.");
  }
  return boundary.id;
}

function requireBoundaryContentId(boundary: SuspenseBoundary): number {
  if (boundary.contentSegmentId === null) {
    throw new Error("Expected a Suspense content segment before revealing.");
  }
  return boundary.contentSegmentId;
}

function collectChildren(node: FigNode): FigChild[] {
  const children: FigChild[] = [];
  collectChild(node, children);
  return children;
}

function collectChild(node: FigNode, children: FigChild[]): void {
  if (Array.isArray(node)) {
    for (const child of node) collectChild(child as FigNode, children);
    return;
  }

  if (node === null || node === undefined || typeof node === "boolean") return;

  if (typeof node === "string" || typeof node === "number") {
    appendTextChild(children, String(node));
    return;
  }

  if (isValidElement(node) || isPortal(node)) {
    children.push(node);
    return;
  }

  throw invalidChildError(node);
}

function appendTextChild(children: FigChild[], text: string): void {
  const previous = children.at(-1);

  if (typeof previous === "string" || typeof previous === "number") {
    children[children.length - 1] = `${previous}${text}`;
  } else {
    children.push(text);
  }
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
  if (reason === undefined) return new Error("Server render was aborted.");
  if (typeof reason === "string") return new Error(reason);
  return new Error("Server render was aborted.");
}

function abortReason(reason: unknown): unknown {
  return reason ?? new Error("Server render was aborted.");
}

function invalidChildError(value: unknown): Error {
  return new Error(
    `Invalid Fig child: ${describeInvalidChild(value)}. Render a string, number, element, array, boolean, null, or undefined.`,
  );
}

function describeElementType(type: ElementType): string {
  if (typeof type === "symbol") return String(type);
  if (typeof type === "function") return type.name || "anonymous function";
  return typeof type;
}
