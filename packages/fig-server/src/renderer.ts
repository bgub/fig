import {
  type ComponentType,
  createElement,
  type ElementType,
  type FigAssetResource,
  type FigClientReference,
  type FigContext,
  type FigElement,
  type FigNode,
  Fragment,
  isValidElement,
  type PreloadResource,
  type Props,
  type ViewTransitionProps,
} from "@bgub/fig";
import {
  ACTIVITY_TEMPLATE_ATTRIBUTE,
  assetResourceFromHostProps,
  attachDataStore,
  collectChildren,
  createRendererDataStore,
  type FigDataStore,
  invalidChildError,
  isActivity,
  isAssets,
  isClientReference,
  isContext,
  isErrorBoundary,
  isFigAssetResource,
  isPortal,
  isSuspense,
  isThenable,
  isViewTransition,
  type NormalizedChild,
  type RenderDispatcher,
  readThenable,
  setCurrentDataStore,
  setCurrentDispatcher,
  type Thenable,
  TEXT_SEPARATOR_DATA,
  validateInstanceNesting,
  validateTextNesting,
  VIEW_TRANSITION_CLASS_ATTRIBUTE,
  VIEW_TRANSITION_NAME_ATTRIBUTE,
} from "@bgub/fig/internal";
import {
  AssetResourceRegistry,
  type HeadMetadataHtml,
} from "./asset-registry.ts";
import {
  escapeAttribute,
  escapeText,
  formTextContent,
  hasRenderableChild,
  isVoidElement,
  unsafeHTMLContent,
  writeElementEnd,
  writeElementStart,
  writeText,
} from "./html.ts";
import {
  imagePreloadFromHostProps,
  suppressesImagePreloads,
} from "./image-preloads.ts";
import { activityId, earlyEventCaptureMarkup } from "./protocol.ts";
import {
  createPreloadHeaderEntries,
  formatPreloadHeader,
  type PreloadHeaderEntry,
  type PreloadHeaderResourceSnapshot,
} from "./preload-header.ts";
import {
  documentHeadMarker,
  flushCompletedQueues,
  leadingNewlineEndMarker,
  leadingNewlineStartMarker,
  sealHead,
  type SegmentChunk,
} from "./renderer-flush.ts";
import {
  type ContextValues,
  type StackFrame,
  cloneContextValues,
  createStaticDispatcher,
  type Deferred,
  deferred,
  noLane,
  noop,
  serverErrorPayload,
  streamHighWaterMark,
  withContextValue,
} from "./shared.ts";
import type { RenderTreeNode } from "./render-tree.ts";
import type {
  ServerErrorPayload,
  ServerFragmentRenderResult,
  ServerRenderOptions,
} from "./types.ts";

declare const __FIG_DEV__: boolean | undefined;

const __DEV__ = typeof __FIG_DEV__ === "boolean" ? __FIG_DEV__ : false;

interface HeadSnapshot extends HeadMetadataHtml {
  preloadHeaderEntries: readonly PreloadHeaderEntry[] | null;
  preloadHeaderResources: PreloadHeaderResourceSnapshot | null;
}

export interface Request {
  abortableTasks: Set<Task>;
  allReady: Deferred<void>;
  cleanupAbortListener: (() => void) | null;
  completedBoundaries: Set<SuspenseBoundary>;
  controller: ReadableStreamDefaultController<Uint8Array> | null;
  dataStore: FigDataStore;
  dispose(): void;
  abortReason: unknown;
  identifierPrefix: string;
  // Flush-time parser state for nested <pre>/<textarea> hosts. Rendering may
  // complete child segments out of order; only logical flush order can decide
  // which text is the parser's first child.
  leadingNewlineStack: boolean[];
  nextBoundaryId: number;
  nextSegmentId: number;
  nextActivityId: number;
  nextViewTransitionId: number;
  nonce?: string;
  onError?: ServerRenderOptions["onError"];
  pendingRootTasks: number;
  pingedTasks: Task[];
  rootSegment: Segment;
  runtimeName: string;
  runtimeWritten: boolean;
  headReady: Deferred<string>;
  // Set exactly once, when the shell completes and the head is sealed; also
  // the "head is sealed" flag.
  headSnapshot: HeadSnapshot | null;
  shellReady: Deferred<void>;
  status: "open" | "aborting" | "closed";
  clientRenderedBoundaries: Set<SuspenseBoundary>;
  clientReferenceFallback?: ServerRenderOptions["clientReferenceFallback"];
  partialBoundaries: Set<SuspenseBoundary>;
  prerender: boolean;
  componentAssets?: ServerRenderOptions["assets"];
  // null for fragment renders; otherwise whether the document's <head> has
  // been rendered.
  documentHasHead: boolean | null;
  assetRegistry: AssetResourceRegistry;
  resolveAssetKey?: ServerRenderOptions["resolveAssetKey"];
  // Reentrancy guard: enqueueing inside a flush pass can synchronously invoke
  // the stream's pull handler, which must not restart the pass — a boundary
  // stays in its queue while it flushes, so a reentrant drain would emit it
  // twice.
  flushing: boolean;
  // Markup accumulates here per flush pass and leaves as one encoded enqueue,
  // instead of one tiny Uint8Array per attribute/text write.
  writeBuffer: string;
  write(chunk: string): void;
}

// Mutable state for one synchronous render branch. A suspended branch keeps
// this frame on its Task and resumes it directly; forks clone only the state
// that must be isolated from the parent branch.
interface RenderFrame {
  // Only fallback work needs a second owner; every task already belongs to
  // request.abortableTasks.
  fallbackTasks: Set<Task> | null;
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
  // Namespace inherited by the next host element. Unlike dev-only nesting
  // ancestry this is runtime semantics: asset lowering applies only to HTML.
  hostNamespace: HostNamespace;
  // True inside HTML <picture> and <noscript>, where an <img> does not name a
  // standalone preload candidate.
  imagePreloadsSuppressed: boolean;
  idPath: number[];
  pendingLeadingNewline: boolean;
  selectProps: Props | null;
  stack: StackFrame | null;
  // Where collected render-tree nodes attach; null when no collector was
  // passed. Forked into suspended tasks so resumed content lands under its
  // boundary's node.
  treeParent: RenderTreeNode | null;
  viewTransition: ServerViewTransitionContext | null;
  dispatcher: RenderDispatcher | null;
  idPathString: string | null;
  localIdCounter: number;
  request: Request;
  segment: Segment;
}

interface Task {
  // Index of the suspended child within its original normalized children
  // sequence. Resuming id-path numbering here keeps useId paths identical to
  // the never-suspending render (and to client fiber indices).
  childIndexBase: number;
  frame: RenderFrame;
  node: FigNode;
}

export interface Segment {
  readonly boundary: SuspenseBoundary | null;
  children: Segment[];
  chunks: SegmentChunk[];
  id: number | null;
  index: number;
  // True when the trailing edge of everything written so far — including the
  // inherited parent position for spawned segments — is document text. The
  // next text write must lead with TEXT_SEPARATOR so the browser's parser
  // does not merge the two into one DOM text node.
  lastPushedText: boolean;
  parentFlushed: boolean;
  assetResources: FigAssetResource[];
  status: SegmentStatus;
  // Spawned suspended segments splice between their parent's chunks, so text
  // may directly follow their end; when such a segment completes ending in
  // text, it closes with a trailing TEXT_SEPARATOR.
  textEmbedded: boolean;
  write(chunk: SegmentChunk): void;
}

export interface SuspenseBoundary {
  // Non-null when this boundary lives inside a hidden Activity: the activity
  // template id its streamed completion must be revealed into. See `ac`/`ax` in
  // protocol.ts.
  activityId: string | null;
  completedSegments: Segment[];
  contentSegment: Segment;
  error: ServerErrorPayload | null;
  fallbackSegment: Segment | null;
  fallbackTasks: Set<Task>;
  id: number | null;
  parentFlushed: boolean;
  pendingTasks: number;
  status: BoundaryStatus;
  metadataVisible: boolean;
}

type BoundaryStatus = "pending" | "completed" | "client-rendered";
type SegmentStatus = "pending" | "rendering" | "completed" | "flushed";
type HostNamespace = "html" | "mathml" | "svg";

interface ServerViewTransitionContext {
  className: string | null;
  index: number;
  name: string;
}

const errorStacks = new WeakMap<object, StackFrame>();
// Emitted between two adjacent text writes that come from different
// normalized text children (component seams, resumed suspended segments).
// The HTML parser merges back-to-back character data into ONE DOM text node,
// while the client tree keeps one text fiber per normalized child (see
// collectChildren in @bgub/fig) — the comment keeps the nodes apart so each
// fiber can claim its own during hydration. The comment data is the shared
// TEXT_SEPARATOR_DATA protocol constant that fig-dom's hydration cursor
// skips (and only that; suspense markers use the fig:suspense prefixes).
const TEXT_SEPARATOR = `<!--${TEXT_SEPARATOR_DATA}-->`;
let nextRuntimeId = 0;

export function createServerRenderRequest(
  node: FigNode,
  options: ServerRenderOptions,
  mode?: { document?: boolean; prerender?: boolean },
): ServerFragmentRenderResult {
  throwIfAborted(options.signal);

  const identifierPrefix = options.identifierPrefix ?? "";
  const shellReady = deferred<void>();
  const headReady = deferred<string>();
  const allReady = deferred<void>();
  // The readiness promises also reject through the stream; pre-attached
  // no-op handlers keep the ones a caller does not await from becoming
  // unhandled rejections (await-ers still observe the rejection).
  void shellReady.promise.catch(noop);
  void headReady.promise.catch(noop);
  void allReady.promise.catch(noop);
  const rootSegment = createSegment(0);
  const dataStoreHost = {
    getLane: noLane,
    partition: options.dataPartition,
    schedule: noop,
  };
  const dataStore =
    options.dataStore === undefined
      ? createRendererDataStore<object, null>(dataStoreHost)
      : attachDataStore(options.dataStore, dataStoreHost, options.initialData);

  const request: Request = {
    abortableTasks: new Set<Task>(),
    allReady,
    cleanupAbortListener: null,
    completedBoundaries: new Set(),
    controller: null,
    dataStore,
    dispose: disposeRequest,
    abortReason: null,
    identifierPrefix,
    leadingNewlineStack: [],
    nextBoundaryId: 0,
    nextSegmentId: 0,
    nextActivityId: 0,
    nextViewTransitionId: 0,
    nonce: options.nonce,
    onError: options.onError,
    pendingRootTasks: 0,
    pingedTasks: [],
    rootSegment,
    runtimeName: createRuntimeName(identifierPrefix),
    runtimeWritten: false,
    headReady,
    headSnapshot: null,
    shellReady,
    status: "open",
    clientRenderedBoundaries: new Set(),
    clientReferenceFallback: options.clientReferenceFallback,
    partialBoundaries: new Set(),
    prerender: mode?.prerender === true,
    componentAssets: options.assets,
    documentHasHead: mode?.document === true ? false : null,
    assetRegistry: new AssetResourceRegistry(identifierPrefix),
    resolveAssetKey: options.resolveAssetKey,
    flushing: false,
    writeBuffer: "",
    write: writeRequestChunk,
  };
  if (options.dataStore === undefined && options.initialData !== undefined) {
    request.dataStore.hydrate(options.initialData);
  }

  rootSegment.parentFlushed = true;
  const rootTask = createTask(node, {
    boundary: null,
    contextValues: new Map(),
    dispatcher: null,
    fallbackTasks: null,
    hiddenActivityId: null,
    hostAncestors: [],
    hostNamespace: "html",
    imagePreloadsSuppressed: false,
    idPath: [],
    idPathString: null,
    localIdCounter: 0,
    pendingLeadingNewline: false,
    request,
    selectProps: null,
    segment: rootSegment,
    stack: null,
    treeParent: options.renderTree?.tree ?? null,
    viewTransition: null,
  });
  pingTask(rootTask);

  const stream = new ReadableStream<Uint8Array>(
    {
      start(streamController) {
        request.controller = streamController;
        flushCompletedQueues(request);
      },
      pull() {
        // The consumer drained below the high-water mark: resume flushing
        // whatever completed while the flow was blocked.
        flushCompletedQueues(request);
      },
      cancel(reason) {
        // The consumer is gone: drop the sink before aborting so the abort
        // pass does not enqueue into (or close) a cancelled stream.
        request.controller = null;
        request.writeBuffer = "";
        abort(request, reason);
        request.status = "closed";
      },
    },
    new ByteLengthQueuingStrategy({
      highWaterMark: streamHighWaterMark(options.highWaterMark),
    }),
  );

  if (options.signal !== undefined) {
    const signal = options.signal;
    const abortListener = () => abort(request, signal.reason);
    signal.addEventListener("abort", abortListener, { once: true });
    request.cleanupAbortListener = () => {
      signal.removeEventListener("abort", abortListener);
      request.cleanupAbortListener = null;
    };
  }

  return {
    abort: (reason?: unknown) => abort(request, reason),
    allReady: allReady.promise,
    contentType: "text/html; charset=utf-8",
    data: request.dataStore,
    getData: () => request.dataStore.snapshot(),
    getPreloadHeader: (headerOptions) => {
      const snapshot = request.headSnapshot;
      if (snapshot === null) return undefined;

      let entries = snapshot.preloadHeaderEntries;
      if (entries === null) {
        const resources = snapshot.preloadHeaderResources;
        if (resources === null) {
          throw new Error("Missing preload-header resource snapshot.");
        }
        entries = createPreloadHeaderEntries(resources);
        snapshot.preloadHeaderEntries = entries;
        snapshot.preloadHeaderResources = null;
      }
      return formatPreloadHeader(entries, headerOptions);
    },
    getHead: () => {
      const snapshot = request.headSnapshot;
      return snapshot === null
        ? request.assetRegistry.headHtml(request.nonce)
        : snapshot.preamble + snapshot.metadata;
    },
    headReady: headReady.promise,
    shellReady: shellReady.promise,
    stream,
  };
}

function createTask(
  node: FigNode,
  frame: RenderFrame,
  childIndexBase = 0,
): Task {
  const { request } = frame;
  if (frame.boundary === null) {
    request.pendingRootTasks += 1;
  } else {
    frame.boundary.pendingTasks += 1;
  }

  const task: Task = { childIndexBase, frame, node };
  request.abortableTasks.add(task);
  frame.fallbackTasks?.add(task);
  return task;
}

// Forks a branch that can outlive the current stack. Context values, the id
// path, and the view-transition cursor are snapshots; the remaining fields
// are immutable or restored by balanced push/pop pairs.
function forkFrame(
  frame: RenderFrame,
  segment: Segment,
  boundary = frame.boundary,
  fallbackTasks = frame.fallbackTasks,
): RenderFrame {
  return {
    boundary,
    contextValues: cloneContextValues(frame.contextValues),
    dispatcher: null,
    fallbackTasks,
    hiddenActivityId: frame.hiddenActivityId,
    hostAncestors: frame.hostAncestors,
    hostNamespace: frame.hostNamespace,
    imagePreloadsSuppressed: frame.imagePreloadsSuppressed,
    idPath: [...frame.idPath],
    idPathString: null,
    localIdCounter: 0,
    pendingLeadingNewline: frame.pendingLeadingNewline,
    request: frame.request,
    selectProps: frame.selectProps,
    segment,
    stack: frame.stack,
    treeParent: frame.treeParent,
    // Forked branches get their own surface-index cursor from the same
    // snapshot. A Suspense fallback and its streamed content then produce
    // the SAME name sequence, so the reveal pairs (morphs) them instead of
    // cross-fading two differently suffixed names — and names stay
    // deterministic under parallel task completion.
    viewTransition:
      frame.viewTransition === null ? null : { ...frame.viewTransition },
  };
}

function createSegment(
  index: number,
  boundary: SuspenseBoundary | null = null,
): Segment {
  return {
    boundary,
    children: [],
    chunks: [],
    id: null,
    index,
    lastPushedText: false,
    parentFlushed: false,
    assetResources: [],
    status: "pending",
    textEmbedded: false,
    write: writeSegmentChunk,
  };
}

function writeRequestChunk(this: Request, chunk: string): void {
  if (chunk !== "" && this.leadingNewlineStack.length > 0) {
    this.leadingNewlineStack[this.leadingNewlineStack.length - 1] = true;
  }
  this.writeBuffer += chunk;
}

function disposeRequest(this: Request): void {
  this.cleanupAbortListener?.();
  this.dataStore.dispose();
}

function writeSegmentChunk(this: Segment, chunk: SegmentChunk): void {
  // Every non-text write (tags, comments, scripts) breaks text adjacency;
  // renderNode's text path re-marks the flag after writing text.
  this.lastPushedText = false;
  this.chunks.push(chunk);
}

function performWork(request: Request): void {
  if (request.status === "closed") return;

  const tasks = request.pingedTasks;
  request.pingedTasks = [];

  for (const task of tasks) retryTask(task);

  flushCompletedQueues(request);
}

function retryTask(task: Task): void {
  const { frame } = task;
  if (frame.segment.status !== "pending") return;

  frame.segment.status = "rendering";

  try {
    renderChildren(task.node, frame, task.childIndexBase);
    completeSegmentText(frame.segment);
    frame.segment.status = "completed";
    detachTask(task);
    settleTask(task, "completed");
  } catch (error) {
    detachTask(task);
    frame.segment.status = "completed";
    settleTask(task, "errored", error);
  }
}

function createServerDispatcher(frame: RenderFrame): RenderDispatcher {
  return createStaticDispatcher({
    contextValues: frame.contextValues,
    externalStoreError:
      "useSyncExternalStore requires getServerSnapshot during server render.",
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
      frame.idPathString ??= formatIdPath(frame.idPath);
      const id = `${frame.request.identifierPrefix}fig-${frame.idPathString}-${frame.localIdCounter.toString(32)}`;
      frame.localIdCounter += 1;
      return id;
    },
    updateError: "State updates are not allowed during server render.",
  });
}

function renderNode(node: NormalizedChild | number, frame: RenderFrame): void {
  if (typeof node === "string" || typeof node === "number") {
    const text = String(node);
    if (frame.request.documentHasHead === false) {
      if (text.trim() !== "") throw invalidDocumentShellError();
    }
    if (__DEV__ && frame.hostNamespace === "html") {
      validateTextNesting(text, frame.hostAncestors);
    }
    if (text !== "") {
      if (frame.treeParent !== null) {
        frame.treeParent.children.push({
          children: [],
          key: null,
          kind: "text",
          name: "#text",
          props: { nodeValue: text },
        });
      }
      // Directly adjacent text from a different fiber: separate it so the
      // browser's parser yields one DOM text node per client text fiber.
      if (frame.segment.lastPushedText) frame.segment.write(TEXT_SEPARATOR);
      if (consumePendingLeadingNewline(frame)) {
        frame.segment.write({ value: escapeText(text) });
      } else {
        writeText(text, frame.segment);
      }
      frame.segment.lastPushedText = true;
    }
    return;
  }

  if (isPortal(node)) return;

  if (isValidElement(node)) {
    renderElement(node, frame);
    return;
  }

  if (isThenable(node)) {
    renderChildren(readThenable(node), frame);
    return;
  }

  throw invalidChildError(node);
}

function renderChildren(
  node: FigNode,
  frame: RenderFrame,
  indexBase = 0,
): void {
  if (Array.isArray(node)) {
    const children = collectChildren(node);
    for (let index = 0; index < children.length; index += 1) {
      renderChildAtIndex(children[index], frame, indexBase + index);
    }
    return;
  }
  if (
    node === null ||
    node === undefined ||
    typeof node === "boolean" ||
    node === ""
  ) {
    return;
  }
  renderChildAtIndex(node, frame, indexBase);
}

function renderChildAtIndex(
  child: NormalizedChild | number,
  frame: RenderFrame,
  index: number,
): void {
  const previousIdPathString = frame.idPathString;
  frame.idPath.push(index);
  frame.idPathString = null;

  try {
    renderNode(child, frame);
  } catch (error) {
    // A retry task stores the parent path plus this child index, so fork its
    // scope only after restoring the parent path.
    frame.idPath.pop();
    frame.idPathString = previousIdPathString;
    if (isThenable(error)) {
      spawnSuspendedTask(frame, child, error, index);
      return;
    }
    throw error;
  }

  frame.idPath.pop();
  frame.idPathString = previousIdPathString;
}

function formatIdPath(path: readonly number[]): string {
  let value = "";
  for (let index = 0; index < path.length; index += 1) {
    if (index > 0) value += "-";
    value += path[index].toString(32);
  }
  return value;
}

// A spawned segment cannot know what follows its splice point once its
// parent resumes (or what a sibling spawned segment will start with), so a
// segment ending in text conservatively closes with a separator; hydration
// skips any it did not need.
function completeSegmentText(segment: Segment): void {
  if (segment.textEmbedded && segment.lastPushedText) {
    segment.write(TEXT_SEPARATOR);
  }
}

function renderElement(element: FigElement, frame: RenderFrame): void {
  if (frame.treeParent === null) {
    renderElementKind(element, frame);
    return;
  }

  const treeNode = collectedTreeNode(element);
  frame.treeParent.children.push(treeNode);
  const previousTreeParent = frame.treeParent;
  frame.treeParent = treeNode;
  try {
    renderElementKind(element, frame);
  } finally {
    frame.treeParent = previousTreeParent;
  }
}

function collectedTreeNode(element: FigElement): RenderTreeNode {
  const { children: _children, ...ownProps } = element.props;
  const [name, kind] = collectedNameAndKind(element.type);
  return {
    children: [],
    key: element.key ?? null,
    kind,
    name,
    props: ownProps,
  };
}

function collectedNameAndKind(type: unknown): [string, RenderTreeNode["kind"]] {
  if (typeof type === "string") return [type, "host"];
  if (type === Fragment) return ["Fragment", "fragment"];
  if (isContext(type)) return ["Context.Provider", "context-provider"];
  if (isAssets(type)) return ["Assets", "assets"];
  if (isSuspense(type)) return ["Suspense", "suspense"];
  if (isErrorBoundary(type)) return ["ErrorBoundary", "error-boundary"];
  if (isActivity(type)) return ["Activity", "activity"];
  if (isViewTransition(type)) return ["ViewTransition", "view-transition"];
  if (isClientReference(type)) {
    const name = type.id.slice(type.id.lastIndexOf("#") + 1);
    return [name || "ClientReference", "client-reference"];
  }
  if (typeof type === "function") {
    return [type.name === "" ? "Anonymous" : type.name, "function"];
  }
  return ["Anonymous", "function"];
}

function renderElementKind(element: FigElement, frame: RenderFrame): void {
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

  if (isViewTransition(type)) {
    renderViewTransition(element.props, frame);
    return;
  }

  if (typeof type === "function") {
    renderFunctionComponent(type, element.props, frame);
    return;
  }

  throw new Error(
    `Unsupported Fig element type: ${describeElementType(type)}.`,
  );
}

function renderFunctionComponent(
  type: ComponentType,
  props: Props,
  frame: RenderFrame,
): void {
  frame.dispatcher ??= createServerDispatcher(frame);
  const previousDispatcher = setCurrentDispatcher(frame.dispatcher);
  const previousDataStore = setCurrentDataStore(frame.request.dataStore);
  const previousStack = frame.stack;
  const previousLocalIdCounter = frame.localIdCounter;
  if (__DEV__ || frame.request.onError !== undefined) {
    frame.stack = { name: type.name || "Anonymous", parent: previousStack };
  }
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
    renderFunctionComponent(type, props, frame);
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

  if (Array.isArray(value)) {
    for (const resource of value) renderAssetResource(resource, frame);
  } else {
    renderAssetResource(value, frame);
  }
}

function renderAssetResource(resource: unknown, frame: RenderFrame): void {
  if (!isFigAssetResource(resource)) {
    throw new Error("The assets prop must contain Fig asset resources.");
  }

  try {
    frame.request.assetRegistry.register(resource);
  } catch (error) {
    recordErrorStack(error, frame.stack);
    throw error;
  }

  frame.segment.assetResources.push(resource);
}

function renderAutomaticImagePreload(
  resource: PreloadResource,
  frame: RenderFrame,
): void {
  try {
    frame.request.assetRegistry.registerAutomaticImage(resource);
  } catch (error) {
    recordErrorStack(error, frame.stack);
    throw error;
  }
  frame.segment.assetResources.push(resource);
}

function renderSuspense(props: Props, frame: RenderFrame): void {
  consumePendingLeadingNewline(frame);
  const contentSegment = createSegment(0);
  const boundary: SuspenseBoundary = {
    activityId: frame.hiddenActivityId,
    completedSegments: [],
    contentSegment,
    error: null,
    fallbackSegment: null,
    fallbackTasks: new Set(),
    id: null,
    metadataVisible: false,
    parentFlushed: false,
    pendingTasks: 0,
    status: "pending",
  };
  const parentSegment = frame.segment;
  const boundarySegment = createSegment(parentSegment.chunks.length, boundary);
  boundary.fallbackSegment = boundarySegment;
  parentSegment.children.push(boundarySegment);
  // The boundary always flushes comment markers around its content, so text
  // on either side of it never merges; no separators needed at this seam.
  parentSegment.lastPushedText = false;

  contentSegment.parentFlushed = true;
  const contentFrame = forkFrame(frame, contentSegment, boundary);

  try {
    renderChildren(props.children, contentFrame);
    contentSegment.status = "completed";
    boundary.completedSegments.push(contentSegment);
    if (boundary.pendingTasks === 0) boundary.status = "completed";
  } catch (error) {
    // Suspensions never reach here: renderChildAtIndex is the single
    // suspend seam and contentFrame always has a boundary, so it spawns a
    // suspended task and continues instead of throwing.
    contentSegment.status = "completed";
    markBoundaryClientRendered(frame.request, boundary, error, frame.stack);
  }

  // Surfaces after the boundary must not reuse suffixes the branches
  // already claimed. Suspended content tasks may still allocate past this
  // watermark; those deep-tail collisions are accepted (the browser skips
  // pairing for duplicated names rather than breaking the reveal).
  advanceViewTransitionWatermark(frame, contentFrame);

  if (boundary.status === "completed") return;

  const fallbackFrame = forkFrame(
    frame,
    boundarySegment,
    frame.boundary,
    boundary.fallbackTasks,
  );

  try {
    renderChildren(props.fallback, fallbackFrame);
    boundarySegment.status = "completed";
  } catch (error) {
    if (boundary.pendingTasks > 0) {
      for (const task of boundary.fallbackTasks) {
        abortTask(task);
      }
    }
    throw error;
  } finally {
    advanceViewTransitionWatermark(frame, fallbackFrame);
  }
}

function advanceViewTransitionWatermark(
  parent: RenderFrame,
  branch: RenderFrame,
): void {
  if (parent.viewTransition !== null && branch.viewTransition !== null) {
    parent.viewTransition.index = Math.max(
      parent.viewTransition.index,
      branch.viewTransition.index,
    );
  }
}

function renderViewTransition(
  props: ViewTransitionProps,
  frame: RenderFrame,
): void {
  const previousViewTransition = frame.viewTransition;
  const className = props.default;
  frame.viewTransition = {
    className:
      className === undefined || className === "auto" || className === "none"
        ? null
        : className,
    index: 0,
    name:
      props.name === undefined || props.name === "auto"
        ? `fig-vt-${frame.request.nextViewTransitionId++}`
        : props.name,
  };

  try {
    renderChildren(props.children, frame);
  } finally {
    frame.viewTransition = previousViewTransition;
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
  const normalizedType = type.toLowerCase();
  const namespace =
    normalizedType === "svg"
      ? "svg"
      : normalizedType === "math"
        ? "mathml"
        : frame.hostNamespace;
  if (namespace === "html" && renderHostAsset(normalizedType, props, frame)) {
    return;
  }

  if (__DEV__ && namespace === "html") {
    validateInstanceNesting(type, frame.hostAncestors);
  }

  const isDocument = frame.request.documentHasHead !== null;
  const isDocumentHead = isDocument && type === "head";
  if (frame.request.documentHasHead === false) {
    if (type !== "html" && type !== "head") throw invalidDocumentShellError();
  }

  if (isDocument && type === "html") {
    frame.segment.write("<!doctype html>");
  }
  if (isDocumentHead) frame.request.documentHasHead = true;

  const isVoid = namespace === "html" && isVoidElement(type);
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

  if (namespace === "html") {
    const imagePreload = imagePreloadFromHostProps(
      type,
      props,
      frame.imagePreloadsSuppressed,
    );
    if (imagePreload !== null) {
      renderAutomaticImagePreload(imagePreload, frame);
    }
  }

  consumePendingLeadingNewline(frame);
  const viewTransition = frame.viewTransition;
  const hostProps =
    viewTransition === null
      ? props
      : viewTransitionHostProps(props, viewTransition);
  writeElementStart(type, hostProps, frame.segment, frame.selectProps);
  if (isDocumentHead) {
    // First thing in <head>: events must be capturable before any content
    // can paint, or a user's first interaction races bundle execution.
    frame.segment.write(earlyEventCaptureMarkup(frame.request));
  }
  if (isVoid) return;

  const previousPendingLeadingNewline = frame.pendingLeadingNewline;
  const tracksLeadingNewline = type === "pre" || type === "textarea";
  frame.pendingLeadingNewline = tracksLeadingNewline;

  const formText = namespace === "html" ? formTextContent(type, props) : null;
  const staticContent = unsafeHTML ?? formText;
  if (staticContent !== null) {
    const content =
      consumePendingLeadingNewline(frame) && staticContent.startsWith("\n")
        ? `\n${staticContent}`
        : staticContent;
    if (unsafeHTML === null) writeText(content, frame.segment);
    else frame.segment.write(content);
    frame.pendingLeadingNewline = previousPendingLeadingNewline;
    writeElementEnd(type, frame.segment);
    return;
  }

  const previousSelectProps = frame.selectProps;
  if (namespace === "html" && type === "select") frame.selectProps = props;
  const previousHostAncestors = frame.hostAncestors;
  const previousHostNamespace = frame.hostNamespace;
  const previousImagePreloadsSuppressed = frame.imagePreloadsSuppressed;
  const previousViewTransition = frame.viewTransition;
  if (viewTransition !== null) frame.viewTransition = null;
  if (__DEV__) {
    frame.hostAncestors = [type, ...previousHostAncestors];
  }
  frame.hostNamespace =
    namespace === "svg" && normalizedType === "foreignobject"
      ? "html"
      : namespace;
  frame.imagePreloadsSuppressed =
    previousImagePreloadsSuppressed ||
    (namespace === "html" && suppressesImagePreloads(type));
  if (tracksLeadingNewline) {
    frame.segment.chunks.push(leadingNewlineStartMarker);
  }

  try {
    // Suspensions are handled inside renderChildAtIndex (the single suspend
    // seam), so no thenable can reach this frame; plain errors propagate.
    renderChildren(props.children, frame);
  } finally {
    frame.selectProps = previousSelectProps;
    frame.hostAncestors = previousHostAncestors;
    frame.hostNamespace = previousHostNamespace;
    frame.imagePreloadsSuppressed = previousImagePreloadsSuppressed;
    frame.viewTransition = previousViewTransition;
    frame.pendingLeadingNewline = previousPendingLeadingNewline;
  }
  if (tracksLeadingNewline) {
    frame.segment.chunks.push(leadingNewlineEndMarker);
  }
  if (isDocumentHead) frame.segment.write(documentHeadMarker);
  writeElementEnd(type, frame.segment);
}

function renderHostAsset(
  normalizedType: string,
  props: Props,
  frame: RenderFrame,
): boolean {
  // Deliberately gate before assetResourceFromHostProps, which allocates a
  // prop accessor. These names mirror the core classifier; other tags dominate.
  if (normalizedType.length < 4 || normalizedType.length > 6) return false;
  switch (normalizedType) {
    case "link":
    case "meta":
    case "script":
    case "title":
      break;
    default:
      return false;
  }

  const resource = assetResourceFromHostProps(normalizedType, props);
  if (resource === null) return false;

  renderAssetValue(resource, frame);
  return true;
}

function viewTransitionHostProps(
  props: Props,
  viewTransition: ServerViewTransitionContext,
): Props {
  const index = viewTransition.index++;
  const name =
    index === 0 ? viewTransition.name : `${viewTransition.name}_${index}`;
  const nextProps: Props = {
    ...props,
    [VIEW_TRANSITION_NAME_ATTRIBUTE]: name,
  };

  if (viewTransition.className !== null) {
    nextProps[VIEW_TRANSITION_CLASS_ATTRIBUTE] = viewTransition.className;
  }

  return nextProps;
}

function spawnSuspendedTask(
  frame: RenderFrame,
  node: FigNode,
  thenable: Thenable,
  childIndexBase: number,
): void {
  // The spawned segment splices between the parent's text chunks: it adopts
  // the parent's trailing-text state (so its own leading text writes a
  // separator against the text before the splice point) and marks itself
  // text-embedded (so completeSegmentText appends a trailing separator when
  // it ends in text). The parent's cursor resets — the seam is now owned by
  // the spawned segment.
  const segment = createSegment(frame.segment.chunks.length);
  segment.lastPushedText = frame.segment.lastPushedText;
  segment.textEmbedded = true;
  frame.segment.lastPushedText = false;
  frame.segment.children.push(segment);

  const task = createTask(node, forkFrame(frame, segment), childIndexBase);
  const ping = () => pingTask(task);
  thenable.then(ping, ping);
}

function pingTask(task: Task): void {
  const { request } = task.frame;
  if (request.status === "closed" || request.status === "aborting") return;
  const shouldSchedule = request.pingedTasks.length === 0;
  request.pingedTasks.push(task);
  // An empty queue has no scheduled drain. Many thenables settling in one
  // tick append behind the first and share its microtask.
  if (shouldSchedule) queueMicrotask(() => performWork(request));
}

function settleTask(
  task: Task,
  outcome: "aborted" | "completed" | "errored",
  error?: unknown,
): void {
  const { boundary, request, segment, stack } = task.frame;
  if (boundary === null) {
    request.pendingRootTasks -= 1;
    if (outcome === "errored") {
      fatalError(request, error);
      return;
    }
    if (request.pendingRootTasks === 0) finishRootShell(request);
  } else {
    boundary.pendingTasks -= 1;

    if (outcome === "errored") {
      markBoundaryClientRendered(request, boundary, error, stack);
    } else if (outcome === "completed" && segment.parentFlushed) {
      boundary.completedSegments.push(segment);
    }

    if (outcome !== "errored") {
      const boundaryCompleted = completeBoundaryIfReady(request, boundary);
      if (
        outcome === "completed" &&
        !boundaryCompleted &&
        boundary.parentFlushed
      ) {
        request.partialBoundaries.add(boundary);
      }
    }
  }

  if (request.abortableTasks.size === 0) request.allReady.resolve(undefined);
}

function detachTask(task: Task): boolean {
  task.frame.fallbackTasks?.delete(task);
  return task.frame.request.abortableTasks.delete(task);
}

function abortTask(task: Task): void {
  if (!detachTask(task)) return;

  const { frame } = task;
  frame.segment.status = "completed";
  settleTask(task, "aborted");
}

function completeBoundaryIfReady(
  request: Request,
  boundary: SuspenseBoundary,
): boolean {
  if (boundary.pendingTasks !== 0 || boundary.status !== "pending") {
    return false;
  }

  boundary.status = "completed";
  for (const fallbackTask of boundary.fallbackTasks) {
    abortTask(fallbackTask);
  }
  if (boundary.parentFlushed) request.completedBoundaries.add(boundary);
  return true;
}

function markBoundaryClientRendered(
  request: Request,
  boundary: SuspenseBoundary,
  error: unknown,
  stack: StackFrame | null,
  payload?: ServerErrorPayload,
): void {
  if (boundary.status !== "client-rendered") {
    boundary.status = "client-rendered";
    boundary.error =
      payload ??
      serverErrorPayload(error, stackForError(error, stack), request.onError);
  }

  boundary.completedSegments.length = 0;
  request.completedBoundaries.delete(boundary);
  request.partialBoundaries.delete(boundary);

  for (const task of request.abortableTasks) {
    if (task.frame.boundary === boundary) abortTask(task);
  }

  for (const task of boundary.fallbackTasks) {
    abortTask(task);
  }

  if (boundary.parentFlushed) {
    request.clientRenderedBoundaries.add(boundary);
  }
}

function abort(request: Request, reason?: unknown): void {
  if (request.status === "closed") return;
  request.status = "aborting";
  const error = abortError(reason);
  request.abortReason = error;

  if (request.pendingRootTasks > 0) {
    fatalError(request, error);
    return;
  }

  request.dispose();
  for (const task of request.abortableTasks) {
    const { boundary, stack } = task.frame;
    if (boundary !== null) {
      markBoundaryClientRendered(request, boundary, error, stack, {});
    }
  }

  request.abortableTasks.clear();
  request.allReady.resolve(undefined);
  flushCompletedQueues(request);
}

function fatalError(request: Request, error: unknown): void {
  if (request.status === "closed") return;

  request.status = "closed";
  request.dispose();
  request.headReady.reject(error);
  request.shellReady.reject(error);
  request.allReady.reject(error);
  request.controller?.error(error);
}

function finishRootShell(request: Request): void {
  if (request.documentHasHead === false) {
    fatalError(request, invalidDocumentShellError());
    return;
  }

  if (!request.prerender) sealHead(request);
  request.shellReady.resolve(undefined);
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

function createRuntimeName(identifierPrefix: string): string {
  const id = nextRuntimeId.toString(36);
  nextRuntimeId += 1;
  const prefix = identifierPrefix.replace(/[^A-Za-z0-9_$]/g, "_");
  return prefix === "" ? `__figSSR_${id}` : `__figSSR_${prefix}_${id}`;
}

function consumePendingLeadingNewline(frame: RenderFrame): boolean {
  const pending = frame.pendingLeadingNewline;
  frame.pendingLeadingNewline = false;
  return pending;
}

function invalidDocumentShellError(): Error {
  return new Error(
    "renderToDocumentStream requires the root to render an <html> document with a <head>.",
  );
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) throw abortReason(signal.reason);
}

function throwIfAborting(request: Request): void {
  if (request.status === "aborting") throw abortReason(request.abortReason);
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
