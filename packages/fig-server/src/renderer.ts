import {
  type Dispatch,
  type ElementType,
  type FigChild,
  type FigContext,
  type FigElement,
  type FigNode,
  Fragment,
  isContext,
  isErrorBoundary,
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
  boundaryId,
  jsString,
  placeholderId,
  placeholderMarkup,
  segmentId,
  writeRuntime as writeProtocolRuntime,
  writeScript as writeProtocolScript,
} from "./protocol.ts";
import type {
  ServerErrorPayload,
  ServerRenderOptions,
  ServerRenderRequest,
} from "./types.ts";

interface Request {
  abortableTasks: Set<Task>;
  allReady: Promise<void>;
  closeAllReady(): void;
  closeShellReady(): void;
  completedBoundaries: SuspenseBoundary[];
  completedRootSegment: Segment | null;
  controller: ReadableStreamDefaultController<Uint8Array> | null;
  fatalError: unknown;
  identifierPrefix: string;
  nextBoundaryId: number;
  nextSegmentId: number;
  nonce?: string;
  onError?: ServerRenderOptions["onError"];
  onShellError?: (error: unknown) => void;
  pendingRootTasks: number;
  pendingTasks: number;
  pingedTasks: Task[];
  recoverShellReady(error: unknown): void;
  recoverAllReady(error: unknown): void;
  runtimeWritten: boolean;
  shellReady: Promise<void>;
  status: "opening" | "open" | "aborting" | "closed";
  stream: ReadableStream<Uint8Array>;
  textEncoder: TextEncoder;
  clientRenderedBoundaries: SuspenseBoundary[];
  partialBoundaries: SuspenseBoundary[];
}

interface Task {
  abortSet: Set<Task>;
  blockedBoundary: SuspenseBoundary | null;
  contextValues: ContextValues;
  node: FigNode;
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
  status: SegmentStatus;
  write(chunk: string): void;
}

interface SuspenseBoundary {
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
type ContextValues = Map<FigContext<unknown>, unknown[]>;
type Component = (props: Props & { children?: FigNode }) => FigNode;
type Thenable<T = unknown> = PromiseLike<T> & object;

interface RenderFrame {
  abortSet: Set<Task>;
  boundary: SuspenseBoundary | null;
  contextValues: ContextValues;
  dispatcher: RenderDispatcher;
  request: Request;
  segment: Segment;
  stack: StackFrame | null;
}

interface StackFrame {
  name: string;
  parent: StackFrame | null;
}

interface ThenableRecord<T> {
  status: "pending" | "fulfilled" | "rejected";
  value?: T;
  reason?: unknown;
}

const thenableRecords = new WeakMap<object, ThenableRecord<unknown>>();
const errorStacks = new WeakMap<object, StackFrame>();

export function createServerRenderRequest(
  node: FigNode,
  options: ServerRenderOptions = {},
): ServerRenderRequest {
  throwIfAborted(options.signal);

  const textEncoder = new TextEncoder();
  let resolveShellReady: () => void = () => undefined;
  let rejectShellReady: (error: unknown) => void = () => undefined;
  let resolveAllReady: () => void = () => undefined;
  let rejectAllReady: (error: unknown) => void = () => undefined;

  const shellReady = new Promise<void>((resolve, reject) => {
    resolveShellReady = resolve;
    rejectShellReady = reject;
  });
  const allReady = new Promise<void>((resolve, reject) => {
    resolveAllReady = resolve;
    rejectAllReady = reject;
  });

  const request: Request = {
    abortableTasks: new Set<Task>(),
    allReady,
    closeAllReady: resolveAllReady,
    closeShellReady: resolveShellReady,
    completedBoundaries: [],
    completedRootSegment: null,
    controller: null,
    fatalError: null,
    identifierPrefix: validateIdentifierPrefix(
      options.identifierPrefix ?? "fig",
    ),
    nextBoundaryId: 0,
    nextSegmentId: 0,
    nonce: options.nonce,
    onError: options.onError,
    onShellError: options.onShellError,
    pendingRootTasks: 0,
    pendingTasks: 0,
    pingedTasks: [],
    recoverAllReady: rejectAllReady,
    recoverShellReady: rejectShellReady,
    runtimeWritten: false,
    shellReady,
    status: "opening",
    stream: null as never,
    textEncoder,
    clientRenderedBoundaries: [],
    partialBoundaries: [],
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

  const rootSegment = createSegment(0, null);
  rootSegment.parentFlushed = true;
  const rootTask = createTask(
    request,
    node,
    null,
    rootSegment,
    new Map(),
    request.abortableTasks,
    null,
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
    allReady,
    shellReady,
    stream,
  };
}

function createTask(
  request: Request,
  node: FigNode,
  blockedBoundary: SuspenseBoundary | null,
  segment: Segment,
  contextValues: ContextValues,
  abortSet: Set<Task>,
  stack: StackFrame | null,
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
    node,
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
    status: "pending",
    write(chunk) {
      this.chunks.push(chunk);
    },
  };
}

function createBoundary(fallbackAbortableTasks: Set<Task>): SuspenseBoundary {
  return {
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
    task.stack,
  );

  try {
    renderNode(task.node, frame);
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
  stack: StackFrame | null,
): RenderFrame {
  const frame = {
    abortSet,
    boundary,
    contextValues,
    dispatcher: null as never,
    request,
    segment,
    stack,
  };
  frame.dispatcher = createServerDispatcher(request, frame);
  return frame;
}

function createServerDispatcher(
  request: Request,
  frame: RenderFrame,
): RenderDispatcher {
  return {
    useState(initialState) {
      const value = resolveInitialState(initialState);
      const dispatch: Dispatch<SetStateAction<typeof value>> = () => {
        throw new Error("State updates are not allowed during server render.");
      };
      return [value, dispatch];
    },
    useMemo(calculate) {
      return calculate();
    },
    useReactive: noopEffect,
    useBeforePaint: noopEffect,
    useBeforeLayout: noopEffect,
    useOnMount: noopEffect,
    readContext(context) {
      return readContextValue(frame, context);
    },
    readPromise(promise) {
      throwIfAborting(request);
      return readThenable(promise);
    },
  };
}

function renderNode(node: FigNode, frame: RenderFrame): void {
  if (Array.isArray(node)) {
    renderChildSequence(collectChildren(node), frame);
    return;
  }

  if (node === null || node === undefined || typeof node === "boolean") {
    return;
  }

  if (typeof node === "string" || typeof node === "number") {
    writeText(String(node), frame.segment);
    return;
  }

  if (!isValidElement(node)) throw invalidChildError(node);

  renderElement(node, frame);
}

function renderChildSequence(children: FigChild[], frame: RenderFrame): void {
  for (let index = 0; index < children.length; index += 1) {
    try {
      renderNode(children[index], frame);
    } catch (error) {
      if (isThenable(error) && frame.boundary !== null) {
        spawnSuspendedTask(frame, children.slice(index), error);
        return;
      }

      throw error;
    }
  }
}

function renderElement(element: FigElement, frame: RenderFrame): void {
  const type = element.type;

  if (typeof type === "string") {
    renderHostElement(type, element.props, frame);
    return;
  }

  if (type === Fragment) {
    renderNode(element.props.children, frame);
    return;
  }

  if (isContext(type)) {
    renderContextProvider(type, element.props, frame);
    return;
  }

  if (isSuspense(type)) {
    renderSuspense(element.props, frame);
    return;
  }

  if (isErrorBoundary(type)) {
    renderNode(element.props.children, frame);
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
  const previousStack = frame.stack;
  frame.stack = { name: type.name || "Anonymous", parent: previousStack };

  try {
    renderNode(type(props), frame);
  } catch (error) {
    recordErrorStack(error, frame.stack);
    throw error;
  } finally {
    frame.stack = previousStack;
    setCurrentDispatcher(previousDispatcher);
  }
}

function renderContextProvider(
  context: FigContext<unknown>,
  props: Props,
  frame: RenderFrame,
): void {
  const stack = contextStack(frame, context);
  stack.push(props.value);

  try {
    renderNode(props.children, frame);
  } finally {
    stack.pop();
  }
}

function renderSuspense(props: Props, frame: RenderFrame): void {
  const fallbackAbortableTasks = new Set<Task>();
  const boundary = createBoundary(fallbackAbortableTasks);
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
    frame.stack,
  );

  try {
    renderNode(props.children, contentFrame);
    contentSegment.status = "completed";
    boundary.completedSegments.push(contentSegment);
    if (boundary.pendingTasks === 0) boundary.status = "completed";
  } catch (error) {
    contentSegment.status = "completed";

    if (isThenable(error)) {
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
    frame.stack,
  );

  try {
    renderNode(props.fallback as FigNode, fallbackFrame);
    boundarySegment.status = "completed";
  } catch (error) {
    if (boundary.pendingTasks > 0) {
      for (const task of [...boundary.fallbackAbortableTasks]) {
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
  const isVoid = isVoidElement(type);

  if (isVoid && hasRenderableChild(props.children)) {
    throw new Error(`Void element <${type}> cannot have children.`);
  }

  writeElementStart(type, props, frame.segment);
  if (isVoid) return;

  try {
    renderNode(props.children, frame);
  } catch (error) {
    if (isThenable(error) && frame.boundary !== null) {
      spawnSuspendedTask(frame, props.children, error);
    } else {
      throw error;
    }
  }
  writeElementEnd(type, frame.segment);
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
    frame.stack,
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
    if (request.pendingRootTasks === 0) request.closeShellReady();
  } else {
    boundary.pendingTasks -= 1;

    if (segment.parentFlushed) queueCompletedSegment(boundary, segment);

    if (boundary.pendingTasks === 0 && boundary.status === "pending") {
      boundary.status = "completed";
      for (const fallbackTask of [...boundary.fallbackAbortableTasks]) {
        abortTask(request, fallbackTask);
      }

      if (boundary.parentFlushed) {
        request.completedBoundaries.push(boundary);
      }
    } else if (boundary.parentFlushed) {
      enqueuePartialBoundary(request, boundary);
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
    if (request.pendingRootTasks === 0) request.closeShellReady();
  } else {
    boundary.pendingTasks -= 1;

    if (boundary.pendingTasks === 0 && boundary.status === "pending") {
      boundary.status = "completed";

      for (const fallbackTask of [...boundary.fallbackAbortableTasks]) {
        abortTask(request, fallbackTask);
      }

      if (boundary.parentFlushed) {
        request.completedBoundaries.push(boundary);
      }
    }
  }

  if (request.pendingTasks === 0) request.closeAllReady();
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

  for (const task of [...request.abortableTasks]) {
    if (task.blockedBoundary === boundary) abortTask(request, task);
  }

  for (const task of [...boundary.fallbackAbortableTasks]) {
    abortTask(request, task);
  }

  if (boundary.parentFlushed) enqueueClientRenderedBoundary(request, boundary);
}

function abort(request: Request, reason?: unknown): void {
  if (request.status === "closed") return;
  request.status = "aborting";
  const error = abortError(reason);
  request.fatalError = error;

  if (request.pendingRootTasks > 0) {
    fatalError(request, error);
    return;
  }

  for (const task of [...request.abortableTasks]) {
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
  request.fatalError = error;
  request.onShellError?.(error);
  request.recoverShellReady(error);
  request.recoverAllReady(error);
  request.controller?.error(error);
}

function flushCompletedQueues(request: Request): void {
  if (request.controller === null || request.status === "closed") return;
  if (request.status === "opening") return;
  if (request.pendingRootTasks > 0) return;

  if (request.completedRootSegment !== null) {
    flushSegment(request, request.completedRootSegment);
    request.completedRootSegment = null;
  }

  for (let index = 0; index < request.clientRenderedBoundaries.length; ) {
    flushClientRenderedBoundary(
      request,
      request.clientRenderedBoundaries[index],
    );
    request.clientRenderedBoundaries.splice(index, 1);
  }

  for (let index = 0; index < request.completedBoundaries.length; ) {
    flushCompletedBoundary(request, request.completedBoundaries[index]);
    request.completedBoundaries.splice(index, 1);
  }

  for (let index = 0; index < request.partialBoundaries.length; ) {
    flushPartialBoundary(request, request.partialBoundaries[index]);
    request.partialBoundaries.splice(index, 1);
  }

  if (
    request.pendingTasks === 0 &&
    request.completedBoundaries.length === 0 &&
    request.clientRenderedBoundaries.length === 0 &&
    request.partialBoundaries.length === 0
  ) {
    request.status = "closed";
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
  let chunkIndex = 0;

  for (const child of segment.children) {
    for (; chunkIndex < child.index; chunkIndex += 1) {
      write(request, segment.chunks[chunkIndex]);
    }
    flushSegment(request, child);
  }

  for (; chunkIndex < segment.chunks.length; chunkIndex += 1) {
    write(request, segment.chunks[chunkIndex]);
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
    write(request, "<!--fig:suspense:completed-->");
    flushBoundaryContent(request, boundary);
    write(request, "<!--/fig:suspense-->");
    return;
  }

  boundary.id ??= request.nextBoundaryId++;
  write(request, `<!--fig:suspense:pending:${boundary.id}-->`);
  write(
    request,
    `<template id="${boundaryId(request, boundary.id)}"></template>`,
  );
  flushSubtree(request, segment);
  write(request, "<!--/fig:suspense-->");

  if (boundary.status === "client-rendered") {
    enqueueClientRenderedBoundary(request, boundary);
  } else if (boundary.completedSegments.length > 0) {
    enqueuePartialBoundary(request, boundary);
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
    segment.id ??= request.nextSegmentId++;
    if (segment === boundary.contentSegment) {
      boundary.contentSegmentId = segment.id;
    }
    flushSegmentContainer(request, segment);

    if (segment !== boundary.contentSegment) {
      writeRuntime(request);
      writeScript(
        request,
        `__figSSR.s(${jsString(placeholderId(request, segment.id))},${jsString(
          segmentId(request, segment.id),
        )})`,
      );
    }
  }
  boundary.completedSegments = [];
  writeRuntime(request);
  writeScript(
    request,
    `__figSSR.c(${jsString(boundaryId(request, boundary.id))},${jsString(
      segmentId(request, requireBoundaryContentId(boundary)),
    )})`,
  );
}

function flushPartialBoundary(
  request: Request,
  boundary: SuspenseBoundary,
): void {
  for (const segment of boundary.completedSegments) {
    flushPartiallyCompletedSegment(request, boundary, segment);
  }
  boundary.completedSegments = [];
}

function flushPartiallyCompletedSegment(
  request: Request,
  boundary: SuspenseBoundary,
  segment: Segment,
): void {
  boundary.id ??= request.nextBoundaryId++;
  segment.id ??= request.nextSegmentId++;
  if (segment === boundary.contentSegment) {
    boundary.contentSegmentId = segment.id;
  }
  flushSegmentContainer(request, segment);

  if (segment !== boundary.contentSegment) {
    writeRuntime(request);
    writeScript(
      request,
      `__figSSR.s(${jsString(placeholderId(request, segment.id))},${jsString(
        segmentId(request, segment.id),
      )})`,
    );
  }
}

function flushSegmentContainer(request: Request, segment: Segment): void {
  if (segment.status === "flushed") return;

  write(
    request,
    `<div hidden id="${segmentId(request, requireSegmentId(segment))}">`,
  );
  flushSegment(request, segment);
  write(request, "</div>");
}

function flushClientRenderedBoundary(
  request: Request,
  boundary: SuspenseBoundary,
): void {
  if (boundary.id === null) return;
  writeRuntime(request);
  writeScript(
    request,
    `__figSSR.x(${jsString(boundaryId(request, boundary.id))},${jsString(
      boundary.error?.digest ?? "",
    )},${jsString(boundary.error?.message ?? "")})`,
  );
}

function queueCompletedSegment(
  boundary: SuspenseBoundary,
  segment: Segment,
): void {
  if (!boundary.completedSegments.includes(segment)) {
    boundary.completedSegments.push(segment);
  }
}

function enqueuePartialBoundary(
  request: Request,
  boundary: SuspenseBoundary,
): void {
  if (!request.partialBoundaries.includes(boundary)) {
    request.partialBoundaries.push(boundary);
  }
}

function enqueueClientRenderedBoundary(
  request: Request,
  boundary: SuspenseBoundary,
): void {
  if (!request.clientRenderedBoundaries.includes(boundary)) {
    request.clientRenderedBoundaries.push(boundary);
  }
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

function write(request: Request, chunk: string): void {
  request.controller?.enqueue(request.textEncoder.encode(chunk));
}

function requireSegmentId(segment: Segment): number {
  if (segment.id === null) {
    throw new Error("Expected a segment id before flushing.");
  }
  return segment.id;
}

function requireBoundaryContentId(boundary: SuspenseBoundary): number {
  if (boundary.contentSegmentId === null) {
    throw new Error("Expected a Suspense content segment before revealing.");
  }
  return boundary.contentSegmentId;
}

function readContextValue<T>(frame: RenderFrame, context: FigContext<T>): T {
  const stack = frame.contextValues.get(context);
  if (stack !== undefined && stack.length > 0) {
    return stack[stack.length - 1] as T;
  }

  return context.defaultValue;
}

function contextStack(
  frame: RenderFrame,
  context: FigContext<unknown>,
): unknown[] {
  let stack = frame.contextValues.get(context);

  if (stack === undefined) {
    stack = [];
    frame.contextValues.set(context, stack);
  }

  return stack;
}

function cloneContextValues(values: ContextValues): ContextValues {
  const clone: ContextValues = new Map();
  for (const [context, stack] of values) clone.set(context, [...stack]);
  return clone;
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

  if (isValidElement(node)) {
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
  if (signal?.aborted === true) throw abortReason(signal.reason);
}

function throwIfAborting(request: Request): void {
  if (request.status === "aborting") throw abortReason(request.fatalError);
}

function abortError(reason: unknown): Error {
  if (reason instanceof Error) return reason;
  if (reason === undefined) return new Error("Server render was aborted.");
  return new Error(String(reason));
}

function abortReason(reason: unknown): unknown {
  return reason ?? new Error("Server render was aborted.");
}

function validateIdentifierPrefix(value: string): string {
  if (/^[A-Za-z0-9:_-]+$/.test(value)) return value;
  throw new Error(
    "identifierPrefix may only contain letters, numbers, colons, underscores, and dashes.",
  );
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
