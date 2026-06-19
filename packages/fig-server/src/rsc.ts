import {
  clientReference,
  createElement,
  type ElementType,
  type FigChild,
  type FigClientReference,
  type FigContext,
  type FigElement,
  type FigNode,
  Fragment,
  type Key,
  type Props,
  readPromise,
  Suspense,
} from "@bgub/fig";
import {
  isClientReference,
  isContext,
  isActivity,
  isErrorBoundary,
  isPortal,
  isSuspense,
  isValidElement,
  setCurrentDispatcher,
  setCurrentDataStore,
  type FigDataHydrationEntry,
  type FigDataStoreHandle,
  type RenderDispatcher,
} from "@bgub/fig/internal";
import {
  createDataStore,
  type DataResourceKeyInput,
  normalizeDataResourceKey,
  type DataStore,
} from "@bgub/fig-data";
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

export interface RscRenderResult {
  allReady: Promise<void>;
  contentType: string;
  stream: ReadableStream<Uint8Array>;
}

export interface RscRenderOptions {
  dataContext?: unknown;
  dataPartition?: DataResourceKeyInput;
  refreshBoundary?: string;
}

export interface RscRootLike {
  data?: FigDataStoreHandle;
  render(node: FigNode): void;
}

type RscRow =
  | { id: number; tag: "client"; value: { id: string } }
  | { tag: "data"; value: FigDataHydrationEntry[] }
  | { id: number; tag: "error"; value: { message: string } }
  | { id: number; tag: "model"; value: RscModel }
  | { boundary: string; tag: "refresh"; value: RscModel };

type RscModel =
  | null
  | boolean
  | number
  | string
  | RscModel[]
  | { [key: string]: RscModel }
  | RscElementModel
  | RscSpecialModel;

type RscElementModel = {
  $fig: "element";
  key: Key | null;
  props: Record<string, RscModel>;
  type: string | RscSpecialModel;
};

type RscSpecialModel =
  | { $fig: "boundary"; child: RscModel; id: string }
  | { $fig: "client"; id: number }
  | { $fig: "fragment" }
  | { $fig: "lazy"; id: number }
  | { $fig: "promise"; id: number }
  | { $fig: "suspense" }
  | { $fig: "undefined" };

export interface RscResponseOptions {
  loadClientReference?: (metadata: { id: string }) => Promise<unknown>;
  resolveClientReference?: (metadata: { id: string }) => ElementType<any>;
}

export interface RscResponse {
  bindRoot(root: RscRootLike): () => void;
  getRoot(): FigNode;
  processStream(stream: ReadableStream<Uint8Array>): Promise<void>;
  processStringChunk(chunk: string): void;
  subscribe(listener: () => void): () => void;
}

export type RscFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export interface RscFetchOptions extends RequestInit {
  fetch?: RscFetch;
  refreshBoundary?: string;
}

class RscRequestCancelledError extends Error {
  constructor() {
    super("RSC request cancelled.");
    this.name = "RscRequestCancelledError";
  }
}

type RscRequest = {
  allReady: Promise<void>;
  clientReferenceRows: Map<string, number>;
  closeAllReady(): void;
  controller: ReadableStreamDefaultController<Uint8Array> | null;
  dataStore: DataStore<object, null>;
  emittedDataKeys: Set<string>;
  nextId: number;
  nextRowId: number;
  pendingTasks: number;
  pingedTasks: Task[];
  queuedRows: string[];
  recoverAllReady(error: unknown): void;
  refreshBoundary: string | null;
  status: "opening" | "open" | "closed";
  stream: ReadableStream<Uint8Array>;
  textEncoder: TextEncoder;
};

type Task = {
  contextValues: ContextValues;
  id: number;
  kind: "node" | "promise";
  value: unknown;
};

type Component = (props: Props & { children?: FigNode }) => unknown;

type RenderFrame = {
  contextValues: ContextValues;
  request: RscRequest;
};

type DecodedChunk = {
  model: RscModel | null;
  promise: Promise<unknown>;
  reject(reason: unknown): void;
  resolve(value: unknown): void;
  status: "pending" | "fulfilled" | "rejected";
  value: unknown;
};

const contentType = "text/x-component; charset=utf-8";
const RscBoundarySymbol = Symbol.for("fig.rsc-boundary");

type RscBoundaryProps = { children?: FigNode; id: string };

interface RscBoundaryComponent {
  (props: RscBoundaryProps): FigNode;
  readonly $$typeof: symbol;
}

const RscBoundaryImpl: RscBoundaryComponent = Object.assign(
  (props: RscBoundaryProps) => props.children,
  { $$typeof: RscBoundarySymbol },
);

export const RscBoundary: (props: {
  children?: FigNode;
  id: string;
}) => FigNode = RscBoundaryImpl;

export function renderToRscStream(
  node: FigNode,
  options: RscRenderOptions = {},
): RscRenderResult {
  const request = createRscRequest(
    node,
    options.refreshBoundary ?? null,
    options.dataContext,
    options.dataPartition,
  );
  return { allReady: request.allReady, contentType, stream: request.stream };
}

export function createRscResponse(
  options: RscResponseOptions = {},
): RscResponse {
  return new RscResponseImpl(options);
}

async function processRscStream(
  response: RscResponse,
  stream: ReadableStream<Uint8Array>,
  signal?: AbortSignal | null,
): Promise<void> {
  await readTextStream(
    stream,
    (chunk) => response.processStringChunk(chunk),
    signal,
  );
  response.processStringChunk("\n");
}

export function isRscRequestCancelled(error: unknown): boolean {
  return (
    error instanceof RscRequestCancelledError ||
    (typeof DOMException !== "undefined" &&
      error instanceof DOMException &&
      error.name === "AbortError")
  );
}

export async function fetchRsc(
  response: RscResponse,
  input: RequestInfo | URL,
  options: RscFetchOptions = {},
): Promise<Response> {
  const {
    fetch: fetchImpl = globalThis.fetch,
    headers,
    refreshBoundary,
    signal,
    ...init
  } = options;
  if (fetchImpl === undefined) {
    throw new Error("fetchRsc requires a fetch implementation.");
  }
  throwIfAborted(signal);

  const result = await fetchImpl(input, {
    ...init,
    headers: appendRscHeaders(headers, refreshBoundary),
    signal,
  });
  throwIfAborted(signal);
  if (!result.ok) {
    throw new Error(`RSC request failed with status ${result.status}.`);
  }
  if (result.body === null) {
    throw new Error("RSC response did not include a body.");
  }

  await processRscStream(response, result.body, signal);
  return result;
}

function createRscRequest(
  node: FigNode,
  refreshBoundary: string | null,
  dataContext: unknown,
  dataPartition: DataResourceKeyInput | undefined,
): RscRequest {
  let resolveAllReady: () => void = () => undefined;
  let rejectAllReady: (error: unknown) => void = () => undefined;
  const allReady = new Promise<void>((resolve, reject) => {
    resolveAllReady = resolve;
    rejectAllReady = reject;
  });

  const request: RscRequest = {
    allReady,
    clientReferenceRows: new Map(),
    closeAllReady: resolveAllReady,
    controller: null,
    dataStore: createDataStore<object, null>({
      context: dataContext ?? {},
      getLane: () => null,
      partition: dataPartition,
      schedule: () => undefined,
    }),
    emittedDataKeys: new Set(),
    nextId: 0,
    nextRowId: 1,
    pendingTasks: 0,
    pingedTasks: [],
    queuedRows: [],
    recoverAllReady: rejectAllReady,
    refreshBoundary,
    status: "opening",
    stream: null as never,
    textEncoder: new TextEncoder(),
  };

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      request.controller = controller;
      flushRows(request);
    },
    cancel(reason) {
      closeWithError(request, reason);
    },
  });
  request.stream = stream;
  request.pingedTasks.push(createTask(request, 0, "node", node, new Map()));

  queueMicrotask(() => performWork(request));

  return request;
}

class RscResponseImpl implements RscResponse {
  private readonly boundaries = new Map<string, RscModel>();
  private readonly chunks = new Map<number, DecodedChunk>();
  private listeners = new Set<() => void>();
  private pendingData: FigDataHydrationEntry[] = [];
  private rootData: FigDataStoreHandle | null = null;
  private stringBuffer = "";

  constructor(private readonly options: RscResponseOptions) {}

  bindRoot(root: RscRootLike): () => void {
    this.rootData = root.data ?? null;
    this.hydratePendingData();
    const render = () => root.render(this.getRoot());
    const unsubscribe = this.subscribe(render);
    render();
    return unsubscribe;
  }

  getRoot(): FigNode {
    return createElement(RscResponseRoot, {
      response: this,
    });
  }

  private processRow(row: RscRow): void {
    if (row.tag === "data") {
      this.pendingData.push(...row.value);
      this.hydratePendingData();
      return;
    }

    if (row.tag === "refresh") {
      this.boundaries.set(row.boundary, row.value);
      this.notify();
      return;
    }

    resolveDecodedRow(this, row);
    if (row.id === 0) this.notify();
  }

  processStream(stream: ReadableStream<Uint8Array>): Promise<void> {
    return processRscStream(this, stream);
  }

  processStringChunk(chunk: string): void {
    this.stringBuffer += chunk;

    while (true) {
      const newlineIndex = this.stringBuffer.indexOf("\n");
      if (newlineIndex === -1) return;

      const line = this.stringBuffer.slice(0, newlineIndex);
      this.stringBuffer = this.stringBuffer.slice(newlineIndex + 1);
      this.processLine(line);
    }
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  readBoundary(id: string, initial: RscModel): FigNode {
    return decodeModel(this, this.boundaries.get(id) ?? initial) as FigNode;
  }

  readChunk(id: number): FigNode {
    const chunk = this.getChunk(id);
    if (chunk.status === "rejected") throw chunk.value;
    if (chunk.status === "pending") readPromise(chunk.promise);
    if (chunk.model === null) return chunk.value as FigNode;
    return decodeModel(this, chunk.model) as FigNode;
  }

  decodeClientReference(metadata: { id: string }): ElementType {
    const resolved = this.options.resolveClientReference?.(metadata);
    if (resolved !== undefined) return resolved;

    if (this.options.loadClientReference !== undefined) {
      const loaded = this.options.loadClientReference(metadata);

      return function RscClientComponent(props: Props) {
        const moduleValue = readPromise(loaded);
        const type = resolveClientReferenceExport(moduleValue, metadata.id);
        return createElement(type, props);
      };
    }

    return clientReference({
      id: metadata.id,
      load: () => Promise.resolve({}),
    });
  }

  getChunk(id: number): DecodedChunk {
    return getOrCreateChunk(this.chunks, id);
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }

  private hydratePendingData(): void {
    if (this.rootData === null || this.pendingData.length === 0) return;

    const entries = this.pendingData;
    this.pendingData = [];
    this.rootData.hydrate(entries);
  }

  private processLine(line: string): void {
    if (line.length > 0) this.processRow(JSON.parse(line) as RscRow);
  }
}

function createTask(
  request: RscRequest,
  id: number,
  kind: Task["kind"],
  value: unknown,
  contextValues: ContextValues,
): Task {
  request.pendingTasks += 1;
  return { contextValues, id, kind, value };
}

function performWork(request: RscRequest): void {
  if (request.status === "closed") return;
  if (request.status === "opening") request.status = "open";

  const tasks = request.pingedTasks;
  request.pingedTasks = [];

  for (const task of tasks) retryTask(request, task);

  flushRows(request);
}

function retryTask(request: RscRequest, task: Task): void {
  const frame = createRenderFrame(
    request,
    cloneContextValues(task.contextValues),
  );

  try {
    const value =
      task.kind === "node"
        ? serializeNode(task.value as FigNode, frame)
        : serializeValue(readThenable(task.value as Thenable), frame);
    emitDataRows(request);
    if (request.refreshBoundary !== null && task.id === 0) {
      emitRow(request, {
        boundary: request.refreshBoundary,
        tag: "refresh",
        value,
      });
    } else {
      emitRow(request, { id: task.id, tag: "model", value });
    }
    finishTask(request);
  } catch (error) {
    if (isThenable(error)) {
      error.then(
        () => pingTask(request, task),
        () => pingTask(request, task),
      );
      return;
    }

    emitRow(request, {
      id: task.id,
      tag: "error",
      value: { message: errorMessage(error) },
    });
    finishTask(request);
  }
}

function finishTask(request: RscRequest): void {
  request.pendingTasks -= 1;
  if (request.pendingTasks === 0) request.closeAllReady();
}

function emitDataRows(request: RscRequest): void {
  const entries = request.dataStore.snapshot().filter((entry) => {
    const key = normalizeDataResourceKey(entry.key);
    if (request.emittedDataKeys.has(key)) return false;

    request.emittedDataKeys.add(key);
    return true;
  });

  if (entries.length > 0) emitRow(request, { tag: "data", value: entries });
}

function createRenderFrame(
  request: RscRequest,
  contextValues: ContextValues,
): RenderFrame {
  return { contextValues, request };
}

function createRscDispatcher(frame: RenderFrame): RenderDispatcher {
  return createStaticDispatcher({
    contextValues: frame.contextValues,
    externalStoreError:
      "useExternalStore requires getServerSnapshot during RSC render.",
    readPromise: readThenable,
    readData(resource, args) {
      return frame.request.dataStore.readData(resource, args, frame);
    },
    preloadData(resource, args) {
      frame.request.dataStore.preloadData(resource, args);
    },
    useId() {
      const id = `fig-rsc-${frame.request.nextId.toString(32)}`;
      frame.request.nextId += 1;
      return id;
    },
    updateError: "State updates are not allowed during RSC render.",
  });
}

function serializeNode(node: FigNode, frame: RenderFrame): RscModel {
  if (Array.isArray(node)) {
    return collectChildren(node).map((child) =>
      serializeNodeOrLazy(child, frame),
    );
  }

  if (node === null || node === undefined || typeof node === "boolean") {
    return node === undefined ? { $fig: "undefined" } : node;
  }

  if (typeof node === "string" || typeof node === "number") {
    return node;
  }

  if (isPortal(node)) return null;
  if (!isValidElement(node)) throw invalidChildError(node);

  return serializeElement(node, frame);
}

function serializeNodeOrLazy(node: FigNode, frame: RenderFrame): RscModel {
  try {
    return serializeNode(node, frame);
  } catch (error) {
    if (isThenable(error)) {
      return outlineTask(frame, "node", node, "lazy", error);
    }
    return outlineError(frame.request, error, "lazy");
  }
}

function serializeElement(element: FigElement, frame: RenderFrame): RscModel {
  const type = element.type;

  if (typeof type === "string") {
    return serializeElementModel(element, type, frame);
  }

  if (type === Fragment) {
    return serializeElementModel(element, { $fig: "fragment" }, frame);
  }

  if (isClientReference(type)) {
    const clientId = emitClientReference(frame.request, type);
    return serializeElementModel(
      element,
      { $fig: "client", id: clientId },
      frame,
    );
  }

  if (isRscBoundary(type)) {
    const id = element.props.id;
    if (typeof id !== "string" || id.length === 0) {
      throw new Error("RSC boundaries require a non-empty string id.");
    }

    return {
      $fig: "boundary",
      child: serializeValue(element.props.children, frame),
      id,
    };
  }

  if (isContext(type)) {
    return serializeContextProvider(type, element.props, frame);
  }

  if (isSuspense(type)) {
    return serializeElementModel(element, { $fig: "suspense" }, frame);
  }

  if (isErrorBoundary(type)) {
    return serializeNode(element.props.children, frame);
  }

  if (isActivity(type)) {
    return serializeNode(element.props.children, frame);
  }

  if (typeof type === "function") {
    return serializeFunctionComponent(type as Component, element.props, frame);
  }

  throw new Error("Unsupported Fig element type during RSC render.");
}

function serializeElementModel(
  element: FigElement,
  type: RscElementModel["type"],
  frame: RenderFrame,
): RscElementModel {
  return {
    $fig: "element",
    key: element.key,
    props: serializeProps(element.props, frame),
    type,
  };
}

function serializeFunctionComponent(
  type: Component,
  props: Props,
  frame: RenderFrame,
): RscModel {
  const previousDispatcher = setCurrentDispatcher(createRscDispatcher(frame));
  const previousDataStore = setCurrentDataStore(frame.request.dataStore);

  try {
    const result = type(props);
    const node = isThenable(result) ? readThenable(result) : result;
    return serializeNode(node as FigNode, frame);
  } finally {
    setCurrentDataStore(previousDataStore);
    setCurrentDispatcher(previousDispatcher);
  }
}

function serializeContextProvider(
  context: FigContext<unknown>,
  props: Props,
  frame: RenderFrame,
): RscModel {
  return withContextValue(frame.contextValues, context, props.value, () =>
    serializeNode(props.children, frame),
  );
}

function serializeProps(
  props: Props,
  frame: RenderFrame,
): { [key: string]: RscModel } {
  const serialized: { [key: string]: RscModel } = {};

  for (const [name, value] of Object.entries(props)) {
    serialized[name] = serializeValue(value, frame);
  }

  return serialized;
}

function serializeValue(value: unknown, frame: RenderFrame): RscModel {
  if (value === null) return null;
  if (value === undefined) return { $fig: "undefined" };

  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (typeof value === "bigint") return value.toString();
  if (typeof value === "symbol") return String(value);
  if (typeof value === "function") {
    if (isClientReference(value)) {
      return { $fig: "client", id: emitClientReference(frame.request, value) };
    }

    throw new Error("Functions cannot be passed to Client Components.");
  }

  if (isThenable(value)) {
    return outlineTask(frame, "promise", value, "promise", value);
  }
  if (isValidElement(value)) return serializeNodeOrLazy(value, frame);
  if (Array.isArray(value)) {
    return value.map((item) => serializeValue(item, frame));
  }
  if (isPortal(value)) return null;
  if (value instanceof Date) return value.toISOString();

  if (typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error(
        `Cannot serialize ${prototype?.constructor?.name ?? "object"} to RSC.`,
      );
    }

    const serialized: { [key: string]: RscModel } = {};
    for (const [name, child] of Object.entries(value)) {
      serialized[name] = serializeValue(child, frame);
    }
    return serialized;
  }

  throw new Error(`Cannot serialize ${typeof value} to RSC.`);
}

function outlineTask(
  frame: RenderFrame,
  kind: Task["kind"],
  value: unknown,
  referenceKind: "lazy" | "promise",
  wakeable: Thenable,
): RscSpecialModel {
  const request = frame.request;
  const id = request.nextRowId++;
  const task = createTask(
    request,
    id,
    kind,
    value,
    cloneContextValues(frame.contextValues),
  );

  wakeable.then(
    () => pingTask(request, task),
    () => pingTask(request, task),
  );

  return { $fig: referenceKind, id };
}

function outlineError(
  request: RscRequest,
  error: unknown,
  referenceKind: "lazy" | "promise",
): RscSpecialModel {
  const id = request.nextRowId++;
  emitRow(request, {
    id,
    tag: "error",
    value: { message: errorMessage(error) },
  });
  return { $fig: referenceKind, id };
}

function emitClientReference(
  request: RscRequest,
  reference: FigClientReference,
): number {
  const existing = request.clientReferenceRows.get(reference.id);
  if (existing !== undefined) return existing;

  const id = request.nextRowId++;
  request.clientReferenceRows.set(reference.id, id);
  emitRow(request, { id, tag: "client", value: { id: reference.id } });
  return id;
}

function emitRow(request: RscRequest, row: RscRow): void {
  request.queuedRows.push(`${JSON.stringify(row)}\n`);
  flushRows(request);
}

function pingTask(request: RscRequest, task: Task): void {
  if (request.status === "closed") return;
  request.pingedTasks.push(task);
  queueMicrotask(() => performWork(request));
}

function flushRows(request: RscRequest): void {
  if (request.controller === null || request.status === "closed") return;
  if (request.status === "opening") return;

  for (const row of request.queuedRows) {
    request.controller.enqueue(request.textEncoder.encode(row));
  }
  request.queuedRows = [];

  if (request.pendingTasks === 0) {
    request.status = "closed";
    request.dataStore.dispose();
    request.controller.close();
  }
}

function closeWithError(request: RscRequest, error: unknown): void {
  if (request.status === "closed") return;
  request.status = "closed";
  request.dataStore.dispose();
  request.recoverAllReady(error);
  request.controller?.error(error);
}

function collectChildren(children: FigChild[]): FigChild[] {
  const collected: FigChild[] = [];

  for (const child of children) {
    if (Array.isArray(child)) collected.push(...collectChildren(child));
    else collected.push(child);
  }

  return collected;
}

function invalidChildError(value: unknown): Error {
  return new Error(
    `Invalid Fig child in RSC render: ${describeInvalidChild(value)}.`,
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function readTextStream(
  stream: ReadableStream<Uint8Array>,
  onChunk: (chunk: string) => void,
  signal?: AbortSignal | null,
): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const abort = () => {
    void reader.cancel(signal?.reason).catch(() => undefined);
  };

  try {
    signal?.addEventListener("abort", abort, { once: true });

    while (true) {
      throwIfAborted(signal);

      const { done, value } = await reader.read();
      throwIfAborted(signal);

      if (done) {
        onChunk(decoder.decode());
        return;
      }

      onChunk(decoder.decode(value, { stream: true }));
    }
  } finally {
    signal?.removeEventListener("abort", abort);
    throwIfAborted(signal);
  }
}

function throwIfAborted(signal?: AbortSignal | null): void {
  if (signal?.aborted) throw new RscRequestCancelledError();
}

function resolveDecodedRow(
  response: RscResponseImpl,
  row: Extract<RscRow, { id: number }>,
): void {
  const chunk = response.getChunk(row.id);

  if (row.tag === "error") {
    const error = new Error(row.value.message);
    chunk.model = null;
    chunk.status = "rejected";
    chunk.value = error;
    chunk.reject(error);
    return;
  }

  const value =
    row.tag === "client"
      ? response.decodeClientReference(row.value)
      : decodeModel(response, row.value);

  chunk.model = row.tag === "model" ? row.value : null;
  chunk.status = "fulfilled";
  chunk.value = value;
  chunk.resolve(value);
}

function decodeModel(response: RscResponseImpl, model: RscModel): unknown {
  if (model === null) return null;
  if (Array.isArray(model))
    return model.map((item) => decodeModel(response, item));

  if (typeof model !== "object") return model;

  if ("$fig" in model) {
    return decodeSpecialModel(
      response,
      model as RscElementModel | RscSpecialModel,
    );
  }

  const decoded: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(model)) {
    decoded[name] = decodeModel(response, value);
  }
  return decoded;
}

function decodeSpecialModel(
  response: RscResponseImpl,
  model: RscElementModel | RscSpecialModel,
): unknown {
  switch (model.$fig) {
    case "boundary":
      return createElement(RscBoundarySlot, {
        id: model.id,
        initial: model.child,
        response,
      });
    case "element": {
      const type = decodeElementType(response, model.type);
      const props = decodeModel(response, model.props) as Props & {
        key?: Key | null;
      };
      if (model.key !== null) props.key = model.key;
      return createElement(type, props);
    }
    case "client":
      return response.readChunk(model.id);
    case "fragment":
      return Fragment;
    case "lazy":
      return createElement(RscLazyNode, { id: model.id, response });
    case "promise":
      return response.getChunk(model.id).promise;
    case "suspense":
      return Suspense;
    case "undefined":
      return undefined;
  }
}

function decodeElementType(
  response: RscResponseImpl,
  type: string | RscSpecialModel,
): ElementType<any> {
  if (typeof type === "string") return type;
  return decodeSpecialModel(response, type) as ElementType<any>;
}

function RscResponseRoot(props: { response: RscResponseImpl }): FigNode {
  return props.response.readChunk(0);
}

function RscBoundarySlot(props: {
  id: string;
  initial: RscModel;
  response: RscResponseImpl;
}): FigNode {
  return props.response.readBoundary(props.id, props.initial);
}

function RscLazyNode(props: {
  id: number;
  response: RscResponseImpl;
}): FigNode {
  return props.response.readChunk(props.id);
}

function resolveClientReferenceExport(
  moduleValue: unknown,
  id: string,
): ElementType<any> {
  if (typeof moduleValue === "function") return moduleValue as ElementType<any>;

  if (typeof moduleValue === "object" && moduleValue !== null) {
    const exportName = id.includes("#")
      ? id.slice(id.lastIndexOf("#") + 1)
      : "";
    const candidate =
      exportName === ""
        ? undefined
        : (moduleValue as Record<string, unknown>)[exportName];

    if (typeof candidate === "function") return candidate as ElementType<any>;
  }

  throw new Error(`Client reference "${id}" did not load a component.`);
}

function appendRscHeaders(
  headers: HeadersInit | undefined,
  boundary?: string,
): Headers {
  const next = new Headers(headers);
  if (!next.has("accept")) next.set("accept", contentType);
  if (boundary !== undefined) next.set("x-fig-rsc-boundary", boundary);
  return next;
}

function getOrCreateChunk(
  chunks: Map<number, DecodedChunk>,
  id: number,
): DecodedChunk {
  const existing = chunks.get(id);
  if (existing !== undefined) return existing;

  let resolve: (value: unknown) => void = () => undefined;
  let reject: (reason: unknown) => void = () => undefined;
  const promise = new Promise<unknown>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  const chunk: DecodedChunk = {
    model: null,
    promise,
    reject,
    resolve,
    status: "pending",
    value: undefined,
  };
  chunks.set(id, chunk);
  return chunk;
}

function isRscBoundary(value: unknown): value is RscBoundaryComponent {
  return (
    typeof value === "function" &&
    (value as RscBoundaryComponent).$$typeof === RscBoundarySymbol
  );
}
