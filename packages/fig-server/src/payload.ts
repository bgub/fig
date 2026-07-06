import type { DataResourceKeyInput } from "@bgub/fig";
import {
  clientReference,
  createElement,
  type ElementType,
  type FigAssetResource,
  type FigAssetResourceList,
  type FigClientReference,
  type FigContext,
  type FigDataHydrationEntry,
  type FigDataStoreHandle,
  type FigElement,
  type FigNode,
  type FontResource,
  Fragment,
  type Key,
  type ModulePreloadResource,
  type PreconnectResource,
  type PreloadResource,
  type Props,
  readPromise,
  type ScriptResource,
  type StylesheetResource,
  Suspense,
} from "@bgub/fig";
import {
  assetResourceDestination,
  assetResourceKey,
  clientReferenceAssets,
  createDataStore,
  type DataStore,
  describeInvalidChild,
  isActivity,
  isAssets,
  isClientReference,
  isContext,
  isErrorBoundary,
  isFigAssetResource,
  isPortal,
  isSuspense,
  isThenable,
  isValidElement,
  normalizeDataResourceKey,
  type RenderDispatcher,
  readThenable,
  setCurrentDataStore,
  setCurrentDispatcher,
  type Thenable,
  trackThenable,
} from "@bgub/fig/internal";
import {
  type ContextValues,
  cloneContextValues,
  createStaticDispatcher,
  type Deferred,
  deferred,
  withContextValue,
} from "./shared.ts";
import type { ServerErrorPayload } from "./types.ts";

declare const process: { env: { NODE_ENV?: string } };

export interface PayloadRenderResult {
  allReady: Promise<void>;
  contentType: string;
  stream: ReadableStream<Uint8Array>;
}

export interface PayloadRenderOptions {
  clientReferenceAssets?: (metadata: { id: string }) => FigAssetResourceList;
  codec?: PayloadCodec;
  dataPartition?: DataResourceKeyInput;
  /**
   * Decides what crosses the wire when a server render throws, mirroring the
   * HTML renderer's contract: the returned payload is authoritative. Without
   * a handler, development includes the error message and production sends
   * an empty payload.
   */
  onError?: (error: unknown) => ServerErrorPayload | undefined;
  refreshBoundary?: string;
}

export interface PayloadRootLike {
  data?: FigDataStoreHandle;
  render(node: FigNode): void;
}

// Stream-safe asset resources only (no head-only title/meta). These are the
// FigAssetResource subtypes whose fields are already JSON scalars, so they travel as
// plain data with no implementation detail exposed. The per-kind field lists
// are the single source of truth: the wire type derives from them, and
// serializeAssetResource picks exactly these fields.
export type SerializedAssetResource =
  | Pick<
      StylesheetResource,
      "crossOrigin" | "href" | "kind" | "media" | "precedence"
    >
  | Pick<
      PreloadResource,
      "as" | "crossOrigin" | "fetchPriority" | "href" | "kind" | "type"
    >
  | Pick<
      ModulePreloadResource,
      "crossOrigin" | "fetchPriority" | "href" | "kind"
    >
  | Pick<
      ScriptResource,
      "async" | "crossOrigin" | "defer" | "kind" | "module" | "src"
    >
  | Pick<
      FontResource,
      "crossOrigin" | "fetchPriority" | "href" | "kind" | "type"
    >
  | Pick<PreconnectResource, "crossOrigin" | "href" | "kind">;

/**
 * Semantic payload row before a PayloadCodec turns it into bytes. This row
 * model is the stable contract; a codec's byte layout is intentionally opaque.
 */
export type PayloadRow =
  | { tag: "assets"; value: SerializedAssetResource[] }
  | {
      id: number;
      tag: "client";
      value: {
        id: string;
        assets?: SerializedAssetResource[];
        exportName?: string;
        ssr?: true;
      };
    }
  | { tag: "data"; value: PayloadDataHydrationEntry[] }
  | { id: number; tag: "error"; value: ServerErrorPayload }
  | { id: number; tag: "model"; value: PayloadModel }
  | { boundary: string; tag: "refresh"; value: PayloadModel };

/**
 * Transport-safe model value used inside payload rows. The shape is public so
 * custom codecs and framework integrations can encode/decode rows, but callers
 * should not treat the exact tagged representation as an app data format.
 */
export type PayloadModel =
  | null
  | boolean
  | number
  | string
  | PayloadModel[]
  | { [key: string]: PayloadModel }
  | PayloadElementModel
  | PayloadSpecialModel;

type PayloadElementModel = {
  $fig: "element";
  key: Key | null;
  props: Record<string, PayloadModel>;
  type: string | PayloadSpecialModel;
};

type PayloadSpecialModel =
  | { $fig: "boundary"; child: PayloadModel; id: string }
  | { $fig: "bigint"; value: string }
  | { $fig: "client"; id: number }
  | { $fig: "date"; value: string }
  | { $fig: "fragment" }
  | { $fig: "lazy"; id: number }
  | { $fig: "map"; entries: Array<[PayloadModel, PayloadModel]> }
  | { $fig: "number"; value: "Infinity" | "-Infinity" | "-0" | "NaN" }
  | { $fig: "object"; value: Record<string, PayloadModel> }
  | { $fig: "promise"; id: number }
  | { $fig: "set"; values: PayloadModel[] }
  | { $fig: "symbol"; key: string }
  | { $fig: "suspense" }
  | { $fig: "undefined" };

type PayloadValueSpecialModel = Extract<
  PayloadSpecialModel,
  {
    $fig:
      | "bigint"
      | "date"
      | "map"
      | "number"
      | "object"
      | "set"
      | "symbol"
      | "undefined";
  }
>;

export type PayloadDataHydrationEntry = Omit<FigDataHydrationEntry, "value"> & {
  value: PayloadModel;
};

export interface PayloadClientReferenceMetadata {
  // Opaque unique key for loading and dedupe. Fig's bundler tooling authors
  // ids as "<module specifier>#<export>", but only the server ever splits
  // that convention — it derives exportName once at serialization, so
  // loaders and the client treat id as a black box.
  id: string;
  exportName?: string;
  ssr?: boolean;
}

export interface PayloadClientReferenceRecord extends PayloadClientReferenceMetadata {
  assets?: readonly FigAssetResource[];
}

export interface PayloadResponseOptions {
  codec?: PayloadCodec;
  loadClientReference?: (
    metadata: PayloadClientReferenceMetadata,
  ) => Promise<unknown>;
  resolveClientReference?: (
    metadata: PayloadClientReferenceMetadata,
  ) => ElementType<any> | undefined;
}

export interface PayloadResponse {
  beginRefreshPayload(): void;
  bindRoot(root: PayloadRootLike): () => void;
  readonly codec: PayloadCodec;
  getAssetResources(): readonly FigAssetResource[];
  getClientReferences(): readonly PayloadClientReferenceRecord[];
  getRoot(): FigNode;
  preloadClientReferences(): Promise<void>;
  processBytesChunk(chunk: Uint8Array): void;
  processStream(
    stream: ReadableStream<Uint8Array>,
    signal?: AbortSignal | null,
  ): Promise<void>;
  processStringChunk(chunk: string): void;
  // Resolves when the root row (id 0) of the initial payload has been
  // decoded. Never rejects; race with a timeout or the processing promise
  // for streams that may end without a root.
  readonly rootReady: Promise<void>;
  subscribe(listener: () => void): () => void;
}

export type PayloadFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export interface PayloadFetchOptions extends RequestInit {
  fetch?: PayloadFetch;
  refreshBoundary?: string;
}

export interface PayloadCodec {
  /**
   * Opaque implementation id, e.g. "json" or "binary". Fig checks this id at
   * transport boundaries; the encoded byte layout is not a public contract.
   */
  readonly id: string;
  readonly contentType: string;
  createDecoder(onRow: (row: PayloadRow) => void): PayloadDecoder;
  encodeRow(row: PayloadRow): Uint8Array;
}

export interface PayloadDecoder {
  decode(chunk: Uint8Array): void;
  flush(): void;
}

class PayloadRequestCancelledError extends Error {
  constructor() {
    super("Payload request cancelled.");
    this.name = "PayloadRequestCancelledError";
  }
}

type PayloadRequest = {
  allReady: Deferred<void>;
  boundaryIds: Set<string> | null;
  clientReferenceRows: Map<string, number>;
  clientReferenceAssets?: (metadata: { id: string }) => FigAssetResourceList;
  codec: PayloadCodec;
  controller: ReadableStreamDefaultController<Uint8Array> | null;
  dataStore: DataStore<object, null>;
  emittedAssetKeys: Set<string>;
  emittedDataKeys: Set<string>;
  nextRowId: number;
  nextUseId: number;
  onError: PayloadRenderOptions["onError"];
  pendingTasks: number;
  pingedTasks: Task[];
  queuedRows: Uint8Array[];
  refreshBoundary: string | null;
  status: "opening" | "open" | "closed";
  stream: ReadableStream<Uint8Array>;
  workScheduled: boolean;
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
  // Built lazily on the first function component; reused for the whole task
  // (the dispatcher reads context through the frame, so it stays current).
  dispatcher: RenderDispatcher | null;
  request: PayloadRequest;
};

type DecodedChunk = {
  decoded: unknown;
  hasDecoded: boolean;
  model: PayloadModel | null;
  promise: Promise<unknown>;
  reject(reason: unknown): void;
  resolve(value: unknown): void;
  status: "pending" | "fulfilled" | "rejected";
  value: unknown;
};

const textEncoder = new TextEncoder();
const PayloadBoundarySymbol = Symbol.for("fig.payload-boundary");

/**
 * Readable development-oriented codec: one JSON payload row per newline.
 */
export const jsonPayloadCodec: PayloadCodec = {
  id: "json",
  contentType: "text/x-fig-payload; codec=json; charset=utf-8",
  createDecoder(onRow) {
    return createJsonPayloadDecoder(onRow);
  },
  encodeRow(row) {
    return textEncoder.encode(`${JSON.stringify(row)}\n`);
  },
};

function createJsonPayloadDecoder(
  onRow: (row: PayloadRow) => void,
): PayloadDecoder {
  const decoder = new TextDecoder();
  let buffer = "";

  function processBufferedLines(): void {
    let start = 0;

    for (;;) {
      const newlineIndex = buffer.indexOf("\n", start);
      if (newlineIndex === -1) break;
      processPayloadLine(buffer.slice(start, newlineIndex), onRow);
      start = newlineIndex + 1;
    }

    buffer = start === 0 ? buffer : buffer.slice(start);
  }

  return {
    decode(chunk) {
      buffer += decoder.decode(chunk, { stream: true });
      processBufferedLines();
    },
    flush() {
      buffer += decoder.decode();
      if (buffer.length > 0) {
        processPayloadLine(buffer, onRow);
        buffer = "";
      }
    },
  };
}

function processPayloadLine(
  line: string,
  onRow: (row: PayloadRow) => void,
): void {
  if (line.length > 0) onRow(JSON.parse(line) as PayloadRow);
}

function payloadCodecIdFromContentType(
  contentTypeHeader: string,
): string | null {
  const parts = contentTypeHeader.split(";").slice(1);
  for (const part of parts) {
    const [name, rawValue] = part.split("=");
    if (name?.trim().toLowerCase() !== "codec") continue;
    const value = rawValue?.trim();
    if (value === undefined || value.length === 0) return null;
    return value.replace(/^"|"$/g, "");
  }
  return null;
}

type PayloadBoundaryProps = { children?: FigNode; id: string };

export const PayloadBoundary: {
  (props: PayloadBoundaryProps): FigNode;
  readonly $$typeof: symbol;
} = Object.assign((props: PayloadBoundaryProps) => props.children, {
  $$typeof: PayloadBoundarySymbol,
});

export function renderToPayloadStream(
  node: FigNode,
  options: PayloadRenderOptions = {},
): PayloadRenderResult {
  const request = createPayloadRequest(node, options);
  return {
    allReady: request.allReady.promise,
    contentType: request.codec.contentType,
    stream: request.stream,
  };
}

export function createPayloadResponse(
  options: PayloadResponseOptions = {},
): PayloadResponse {
  return new PayloadResponseImpl(options);
}

async function processPayloadStream(
  response: PayloadResponse,
  stream: ReadableStream<Uint8Array>,
  signal?: AbortSignal | null,
): Promise<void> {
  await response.processStream(stream, signal);
}

export function isPayloadRequestCancelled(error: unknown): boolean {
  return (
    error instanceof PayloadRequestCancelledError ||
    (typeof DOMException !== "undefined" &&
      error instanceof DOMException &&
      error.name === "AbortError")
  );
}

export async function fetchPayload(
  response: PayloadResponse,
  input: RequestInfo | URL,
  options: PayloadFetchOptions = {},
): Promise<Response> {
  const {
    fetch: fetchImpl = globalThis.fetch,
    headers,
    refreshBoundary,
    signal,
    ...init
  } = options;
  if (fetchImpl === undefined) {
    throw new Error("fetchPayload requires a fetch implementation.");
  }
  throwIfAborted(signal);

  const result = await fetchImpl(input, {
    ...init,
    headers: appendPayloadHeaders(response.codec, headers, refreshBoundary),
    signal,
  });
  throwIfAborted(signal);
  if (!result.ok) {
    throw new Error(`Payload request failed with status ${result.status}.`);
  }
  if (result.body === null) {
    throw new Error("Payload response did not include a body.");
  }
  assertPayloadCodecMatches(response.codec, result.headers.get("content-type"));

  // A refresh reuses this response's chunks Map but its row ids restart at 1 on
  // the server; namespace them past existing chunks before decoding the stream.
  if (refreshBoundary !== undefined) response.beginRefreshPayload();

  await processPayloadStream(response, result.body, signal);
  return result;
}

function createPayloadRequest(
  node: FigNode,
  options: PayloadRenderOptions,
): PayloadRequest {
  const request: PayloadRequest = {
    allReady: deferred<void>(),
    boundaryIds: process.env.NODE_ENV !== "production" ? new Set() : null,
    clientReferenceRows: new Map(),
    clientReferenceAssets: options.clientReferenceAssets,
    codec: options.codec ?? jsonPayloadCodec,
    controller: null,
    dataStore: createDataStore<object, null>({
      getLane: () => null,
      partition: options.dataPartition,
      schedule: () => undefined,
    }),
    emittedAssetKeys: new Set(),
    emittedDataKeys: new Set(),
    nextRowId: 1,
    nextUseId: 0,
    onError: options.onError,
    pendingTasks: 0,
    pingedTasks: [],
    queuedRows: [],
    refreshBoundary: options.refreshBoundary ?? null,
    status: "opening",
    stream: null as never,
    workScheduled: false,
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

  request.workScheduled = true;
  queueMicrotask(() => {
    request.workScheduled = false;
    performWork(request);
  });

  return request;
}

interface PayloadClientReferenceEntry {
  component?: ElementType;
  load: Promise<unknown>;
}

class PayloadResponseImpl implements PayloadResponse {
  private readonly assetResources = new Map<string, FigAssetResource>();
  private readonly boundaries = new Map<string, PayloadModel>();
  private readonly decodedBoundaries = new Map<string, FigNode>();
  private readonly clientReferences = new Map<
    string,
    PayloadClientReferenceRecord
  >();
  private readonly chunks = new Map<number, DecodedChunk>();
  // One entry per loader-backed reference id: stable component identity keeps
  // island state across re-decodes, and each load is registered with
  // trackThenable at creation, so a reference whose module settled before its
  // first render read resolves synchronously instead of suspending.
  private readonly clientReferenceEntries = new Map<
    string,
    PayloadClientReferenceEntry
  >();
  private listeners = new Set<() => void>();
  private resolveRootReady: () => void = () => undefined;
  readonly rootReady: Promise<void> = new Promise((resolve) => {
    this.resolveRootReady = resolve;
  });
  private maxRowId = 0;
  private pendingData: FigDataHydrationEntry[] = [];
  private rootData: FigDataStoreHandle | null = null;
  private rowIdBase = 0;
  private readonly decoder: PayloadDecoder;
  readonly codec: PayloadCodec;

  constructor(private readonly options: PayloadResponseOptions) {
    this.codec = options.codec ?? jsonPayloadCodec;
    this.decoder = this.codec.createDecoder((row) => this.processRow(row));
  }

  beginRefreshPayload(): void {
    // Refresh payloads restart their row ids at 1 on the server, but every
    // payload shares one chunks Map here. Offset an incoming refresh payload's
    // ids past every id seen so far so its outlined client/lazy/promise rows
    // cannot collide with — and clobber — still-mounted chunks from the initial
    // (or an earlier refresh) payload.
    this.rowIdBase = this.maxRowId;
  }

  getAssetResources(): readonly FigAssetResource[] {
    return [...this.assetResources.values()];
  }

  getClientReferences(): readonly PayloadClientReferenceRecord[] {
    return [...this.clientReferences.values()];
  }

  recordAssetResources(
    assets: readonly SerializedAssetResource[] | undefined,
  ): void {
    if (assets === undefined) return;

    // Dedupe per payload by resource key: a shared asset referenced by several
    // client references is recorded once.
    for (const resource of assets) {
      if (
        !isFigAssetResource(resource) ||
        assetResourceDestination(resource) !== "stream"
      ) {
        continue;
      }
      const key = assetResourceKey(resource);
      if (!this.assetResources.has(key)) this.assetResources.set(key, resource);
    }
  }

  recordClientReference(
    value: Extract<PayloadRow, { tag: "client" }>["value"],
  ): void {
    if (this.clientReferences.has(value.id)) return;
    const reference: PayloadClientReferenceRecord = { id: value.id };
    const assets = value.assets?.filter(isFigAssetResource);
    if (assets !== undefined) reference.assets = assets;
    if (value.exportName !== undefined) reference.exportName = value.exportName;
    if (value.ssr === true) reference.ssr = true;
    this.clientReferences.set(value.id, reference);

    // Start the module import as soon as the reference row arrives so it
    // overlaps the rest of the stream (and any asset gates) instead of
    // serializing behind them.
    const load = this.options.loadClientReference;
    if (load !== undefined) {
      const metadata = clientRowMetadata(value);
      if (this.options.resolveClientReference?.(metadata) === undefined) {
        this.clientReferenceEntry(metadata, load);
      }
    }
  }

  bindRoot(root: PayloadRootLike): () => void {
    this.rootData = root.data ?? null;
    this.hydratePendingData();
    const render = () => root.render(this.getRoot());
    const unsubscribe = this.subscribe(render);
    render();
    return unsubscribe;
  }

  getRoot(): FigNode {
    return createElement(PayloadResponseRoot, {
      response: this,
    });
  }

  private processRow(row: PayloadRow): void {
    if (this.rowIdBase > 0) shiftRowIds(row, this.rowIdBase);

    if (row.tag === "data") {
      this.pendingData.push(...decodePayloadDataEntries(row.value));
      this.hydratePendingData();
      return;
    }

    if (row.tag === "assets") {
      this.recordAssetResources(row.value);
      this.notify();
      return;
    }

    if (row.tag === "refresh") {
      this.boundaries.set(row.boundary, row.value);
      // Refreshed content must reach its slot through fresh element
      // identities (slots read the boundaries map without subscribing), so
      // drop every decode cache; the caches only need to survive the common
      // per-notify and per-re-render paths, and refreshes are rare.
      this.invalidateDecodeCaches();
      this.notify();
      return;
    }

    resolveDecodedRow(this, row);
    if (row.id === 0) {
      this.resolveRootReady();
      this.notify();
    }
  }

  async processStream(
    stream: ReadableStream<Uint8Array>,
    signal?: AbortSignal | null,
  ): Promise<void> {
    await readByteStream(
      stream,
      (chunk) => this.processBytesChunk(chunk),
      signal,
    );
    this.decoder.flush();
  }

  processBytesChunk(chunk: Uint8Array): void {
    this.decoder.decode(chunk);
  }

  processStringChunk(chunk: string): void {
    this.processBytesChunk(textEncoder.encode(chunk));
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private invalidateDecodeCaches(): void {
    this.decodedBoundaries.clear();
    for (const chunk of this.chunks.values()) {
      chunk.decoded = undefined;
      chunk.hasDecoded = false;
    }
  }

  readBoundary(id: string, initial: PayloadModel): FigNode {
    let decoded = this.decodedBoundaries.get(id);
    if (decoded === undefined) {
      decoded = decodeModel(
        this,
        this.boundaries.get(id) ?? initial,
      ) as FigNode;
      this.decodedBoundaries.set(id, decoded);
    }
    return decoded;
  }

  readChunk(id: number): FigNode {
    const chunk = this.getChunk(id);
    if (chunk.status === "rejected") throw chunk.value;
    if (chunk.status === "pending") readPromise(chunk.promise);
    if (chunk.model === null) return chunk.value as FigNode;
    // Decoded trees are cached per chunk: models are immutable once resolved,
    // and stable element identities let the client reconciler bail out of
    // unchanged subtrees instead of re-rendering the whole payload on every
    // notify.
    if (!chunk.hasDecoded) {
      chunk.decoded = decodeModel(this, chunk.model);
      chunk.hasDecoded = true;
    }
    return chunk.decoded as FigNode;
  }

  decodeClientReference(metadata: PayloadClientReferenceMetadata): ElementType {
    const cached = this.clientReferenceEntries.get(metadata.id)?.component;
    if (cached !== undefined) return cached;

    const resolved = this.options.resolveClientReference?.(metadata);
    if (resolved !== undefined) return resolved;

    const load = this.options.loadClientReference;
    if (load !== undefined) {
      const entry = this.clientReferenceEntry(metadata, load);
      let type: ElementType | null = null;

      entry.component = function PayloadClientComponent(props: Props) {
        if (type === null) {
          type = resolveClientReferenceExport(
            readPromise(entry.load),
            metadata,
          );
        }
        return createElement(type, props);
      };
      return entry.component;
    }

    return clientReference({
      id: metadata.id,
      load: () => Promise.resolve({}),
    });
  }

  // Loads start when reference rows are recorded; awaiting this before
  // revealing a navigated payload lets its islands render synchronously.
  // Load failures resolve anyway and surface when the component reads the
  // rejected promise.
  preloadClientReferences(): Promise<void> {
    const loads = [...this.clientReferenceEntries.values()].map(
      (entry) => entry.load,
    );
    return Promise.allSettled(loads).then(() => undefined);
  }

  private clientReferenceEntry(
    metadata: PayloadClientReferenceMetadata,
    load: (metadata: PayloadClientReferenceMetadata) => Promise<unknown>,
  ): PayloadClientReferenceEntry {
    let entry = this.clientReferenceEntries.get(metadata.id);
    if (entry === undefined) {
      entry = { load: load(metadata) };
      this.clientReferenceEntries.set(metadata.id, entry);
      // Track immediately: once the module settles, the first render read
      // resolves synchronously instead of suspending for a retry beat.
      trackThenable(entry.load);
    }
    return entry;
  }

  getChunk(id: number): DecodedChunk {
    if (id > this.maxRowId) this.maxRowId = id;
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
}

function createTask(
  request: PayloadRequest,
  id: number,
  kind: Task["kind"],
  value: unknown,
  contextValues: ContextValues,
): Task {
  request.pendingTasks += 1;
  return { contextValues, id, kind, value };
}

function performWork(request: PayloadRequest): void {
  if (request.status === "closed") return;
  if (request.status === "opening") request.status = "open";

  const tasks = request.pingedTasks;
  request.pingedTasks = [];

  for (const task of tasks) retryTask(request, task);

  flushRows(request);
}

function retryTask(request: PayloadRequest, task: Task): void {
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
      value: errorRowPayload(request, error),
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

  for (const snapshot of request.dataStore.inspectDataEntries()) {
    // Stream only settled values. A "refreshing" entry exposes a transient stale
    // value while its background refresh is in flight; emitting it would mark the
    // key emitted forever and permanently suppress the fresh value. Skipping it
    // lets the entry stream once its refresh settles.
    if (!snapshot.hasValue || snapshot.status === "refreshing") continue;

    const key = normalizeDataResourceKey(snapshot.key);
    if (request.emittedDataKeys.has(key)) continue;

    request.emittedDataKeys.add(key);
    entries.push({ key: snapshot.key, value: snapshot.value });
  }

  if (entries.length > 0) {
    emitRow(request, { tag: "data", value: encodePayloadDataEntries(entries) });
  }
}

function createRenderFrame(
  request: PayloadRequest,
  contextValues: ContextValues,
): RenderFrame {
  return { contextValues, dispatcher: null, request };
}

function createPayloadDispatcher(frame: RenderFrame): RenderDispatcher {
  return createStaticDispatcher({
    contextValues: frame.contextValues,
    externalStoreError:
      "useExternalStore requires getServerSnapshot during payload render.",
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
}

function serializeNode(node: FigNode, frame: RenderFrame): PayloadModel {
  if (Array.isArray(node)) {
    return flattenChildArrays(node).map((child) =>
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

function serializeNodeOrLazy(node: FigNode, frame: RenderFrame): PayloadModel {
  try {
    return serializeNode(node, frame);
  } catch (error) {
    if (isThenable(error)) {
      return outlineTask(frame, "node", node, "lazy", error);
    }
    return outlineError(frame.request, error, "lazy");
  }
}

function serializeElement(
  element: FigElement,
  frame: RenderFrame,
): PayloadModel {
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

  if (isPayloadBoundary(type)) {
    const id = element.props.id;
    if (typeof id !== "string" || id.length === 0) {
      throw new Error("Payload boundaries require a non-empty string id.");
    }
    if (frame.request.boundaryIds !== null) {
      if (frame.request.boundaryIds.has(id)) {
        throw new Error(`Duplicate payload boundary id "${id}".`);
      }
      frame.request.boundaryIds.add(id);
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

  if (isAssets(type)) {
    return serializeAssets(element.props, frame);
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

  throw new Error("Unsupported Fig element type during payload render.");
}

function serializeElementModel(
  element: FigElement,
  type: PayloadElementModel["type"],
  frame: RenderFrame,
): PayloadElementModel {
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
): PayloadModel {
  frame.dispatcher ??= createPayloadDispatcher(frame);
  const previousDispatcher = setCurrentDispatcher(frame.dispatcher);
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
): PayloadModel {
  return withContextValue(frame.contextValues, context, props.value, () =>
    serializeNode(props.children, frame),
  );
}

function serializeAssets(props: Props, frame: RenderFrame): PayloadModel {
  const serialized = serializeAssetResources(frame.request, props.assets);
  if (serialized.length > 0) {
    emitRow(frame.request, { tag: "assets", value: serialized });
  }
  return serializeNode(props.children, frame);
}

function serializeProps(
  props: Props,
  frame: RenderFrame,
): { [key: string]: PayloadModel } {
  const serialized: { [key: string]: PayloadModel } = {};

  for (const [name, value] of Object.entries(props)) {
    serialized[name] = serializeValue(value, frame);
  }

  return serialized;
}

function serializeValue(value: unknown, frame: RenderFrame): PayloadModel {
  if (isPlainPayloadValue(value)) return encodePayloadValue(value);

  if (typeof value === "function") {
    if (isClientReference(value)) {
      return { $fig: "client", id: emitClientReference(frame.request, value) };
    }

    throw new Error("Functions cannot be passed to client references.");
  }

  if (isThenable(value)) {
    return outlineTask(frame, "promise", value, "promise", value);
  }
  if (isValidElement(value)) return serializeNodeOrLazy(value, frame);
  if (isPortal(value)) return null;

  if (typeof value === "object" && value !== null) {
    if (value instanceof Map || value instanceof Set || value instanceof Date) {
      return encodePayloadValue(value);
    }

    if (Array.isArray(value)) {
      return value.map((item) => serializeValue(item, frame));
    }

    return encodePayloadRecord(plainPayloadObject(value), (child) =>
      serializeValue(child, frame),
    );
  }

  throw new Error(`Cannot serialize ${typeof value} into the payload.`);
}

function isPlainPayloadValue(value: unknown): boolean {
  return (
    value === null ||
    value === undefined ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint" ||
    typeof value === "symbol"
  );
}

/**
 * Encode ordinary data values into PayloadModel. Server component references
 * such as Fig elements, promises, and client references are handled by the
 * payload renderer before ordinary values reach this helper.
 */
export function encodePayloadValue(value: unknown): PayloadModel {
  return encodePayloadValueInternal(value, new WeakSet<object>());
}

function encodePayloadValueInternal(
  value: unknown,
  seen: WeakSet<object>,
): PayloadModel {
  if (value === null) return null;
  if (value === undefined) return { $fig: "undefined" };

  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return encodePayloadNumber(value);
  if (typeof value === "bigint") {
    return { $fig: "bigint", value: value.toString() };
  }
  if (typeof value === "symbol") {
    const key = Symbol.keyFor(value);
    if (key === undefined) {
      throw new Error("Only global Symbol.for symbols can be serialized.");
    }
    return { $fig: "symbol", key };
  }
  if (typeof value === "function") {
    throw new Error("Functions cannot be serialized into the payload.");
  }

  if (Array.isArray(value)) {
    return withSeen(value, seen, () =>
      value.map((item) => encodePayloadValueInternal(item, seen)),
    );
  }
  if (value instanceof Date) {
    return { $fig: "date", value: value.toJSON() };
  }
  if (value instanceof Map) {
    return withSeen(value, seen, () => ({
      $fig: "map",
      entries: [...value.entries()].map(([key, item]) => [
        encodePayloadValueInternal(key, seen),
        encodePayloadValueInternal(item, seen),
      ]),
    }));
  }
  if (value instanceof Set) {
    return withSeen(value, seen, () => ({
      $fig: "set",
      values: [...value.values()].map((item) =>
        encodePayloadValueInternal(item, seen),
      ),
    }));
  }

  if (typeof value === "object" && value !== null) {
    const record = plainPayloadObject(value);
    return withSeen(value, seen, () =>
      encodePayloadRecord(record, (child) =>
        encodePayloadValueInternal(child, seen),
      ),
    );
  }

  throw new Error(`Cannot serialize ${typeof value} into the payload.`);
}

function plainPayloadObject(value: object): Record<string, unknown> {
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error(
      `Cannot serialize ${prototype?.constructor?.name ?? "object"} into the payload.`,
    );
  }
  return value as Record<string, unknown>;
}

function encodePayloadRecord(
  record: Record<string, unknown>,
  encodeChild: (value: unknown) => PayloadModel,
): PayloadModel {
  const encoded: Record<string, PayloadModel> = {};
  for (const [name, child] of Object.entries(record)) {
    encoded[name] = encodeChild(child);
  }
  return "$fig" in encoded ? { $fig: "object", value: encoded } : encoded;
}

function encodePayloadNumber(value: number): number | PayloadSpecialModel {
  if (Number.isNaN(value)) return { $fig: "number", value: "NaN" };
  if (value === Infinity) return { $fig: "number", value: "Infinity" };
  if (value === -Infinity) return { $fig: "number", value: "-Infinity" };
  if (Object.is(value, -0)) return { $fig: "number", value: "-0" };
  return value;
}

function withSeen<T>(value: object, seen: WeakSet<object>, run: () => T): T {
  if (seen.has(value)) {
    throw new Error("Cannot serialize cyclic values into the payload.");
  }
  seen.add(value);
  try {
    return run();
  } finally {
    seen.delete(value);
  }
}

/** Decode values produced by encodePayloadValue. */
export function decodePayloadValue(model: PayloadModel): unknown {
  return decodeModelValue(model);
}

function decodeModelValue(model: PayloadModel): unknown {
  if (model === null) return null;
  if (Array.isArray(model)) return model.map((item) => decodeModelValue(item));
  if (typeof model !== "object") return model;

  if (isPayloadValueSpecialModel(model)) {
    return decodePayloadSpecialValue(model);
  }

  return decodePayloadRecord(
    model as Record<string, PayloadModel>,
    decodeModelValue,
  );
}

function isPayloadValueSpecialModel(
  model: object,
): model is PayloadValueSpecialModel {
  if (!("$fig" in model)) return false;
  const tag = model.$fig;
  return (
    tag === "bigint" ||
    tag === "date" ||
    tag === "map" ||
    tag === "number" ||
    tag === "object" ||
    tag === "set" ||
    tag === "symbol" ||
    tag === "undefined"
  );
}

function decodePayloadSpecialValue(model: PayloadValueSpecialModel): unknown {
  switch (model.$fig) {
    case "bigint":
      return BigInt(model.value);
    case "date":
      return new Date(model.value);
    case "map":
      return new Map(
        model.entries.map(([key, value]) => [
          decodeModelValue(key),
          decodeModelValue(value),
        ]),
      );
    case "number":
      return decodePayloadNumber(model.value);
    case "object":
      return decodePayloadPlainObject(model.value);
    case "set":
      return new Set(model.values.map((value) => decodeModelValue(value)));
    case "symbol":
      return Symbol.for(model.key);
    case "undefined":
      return undefined;
  }
}

function decodePayloadPlainObject(
  value: Record<string, PayloadModel>,
): Record<string, unknown> {
  return decodePayloadRecord(value, decodeModelValue);
}

function decodePayloadRecord(
  value: Record<string, PayloadModel>,
  decodeChild: (model: PayloadModel) => unknown,
): Record<string, unknown> {
  const decoded: Record<string, unknown> = {};
  for (const [name, child] of Object.entries(value)) {
    decoded[name] = decodeChild(child);
  }
  return decoded;
}

function decodePayloadNumber(
  value: "Infinity" | "-Infinity" | "-0" | "NaN",
): number {
  switch (value) {
    case "Infinity":
      return Infinity;
    case "-Infinity":
      return -Infinity;
    case "-0":
      return -0;
    case "NaN":
      return NaN;
  }
}

export function encodePayloadDataEntries(
  entries: readonly FigDataHydrationEntry[],
): PayloadDataHydrationEntry[] {
  return entries.map(encodePayloadDataEntry);
}

export function decodePayloadDataEntries(
  entries: readonly PayloadDataHydrationEntry[],
): FigDataHydrationEntry[] {
  return entries.map(decodePayloadDataEntry);
}

/** Encode one Fig data hydration entry for transport in payload/data streams. */
export function encodePayloadDataEntry(
  entry: FigDataHydrationEntry,
): PayloadDataHydrationEntry {
  return {
    ...entry,
    value: encodePayloadValue(entry.value),
  };
}

/** Decode one payload data hydration entry back into a Fig data entry. */
export function decodePayloadDataEntry(
  entry: PayloadDataHydrationEntry,
): FigDataHydrationEntry {
  return {
    ...entry,
    value: decodePayloadValue(entry.value),
  };
}

function outlineTask(
  frame: RenderFrame,
  kind: Task["kind"],
  value: unknown,
  referenceKind: "lazy" | "promise",
  wakeable: Thenable,
): PayloadSpecialModel {
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
  request: PayloadRequest,
  error: unknown,
  referenceKind: "lazy" | "promise",
): PayloadSpecialModel {
  const id = request.nextRowId++;
  emitRow(request, {
    id,
    tag: "error",
    value: errorRowPayload(request, error),
  });
  return { $fig: referenceKind, id };
}

// The onError return value is authoritative, like the HTML renderer's
// reportBoundaryError: message crosses the wire only when the handler says
// so. Without a handler, development keeps the real message for debugging
// (payload errors never re-execute on the client, so the wire is the only
// surface) and production sends an empty payload.
function errorRowPayload(
  request: PayloadRequest,
  error: unknown,
): ServerErrorPayload {
  if (request.onError === undefined) {
    return process.env.NODE_ENV !== "production"
      ? { message: errorMessage(error) }
      : {};
  }

  try {
    return request.onError(error) ?? {};
  } catch {
    return {};
  }
}

// The metadata shape hooks receive: the wire row minus assets (those are
// recorded separately and never concern loaders/resolvers).
function clientRowMetadata(
  value: Extract<PayloadRow, { tag: "client" }>["value"],
): PayloadClientReferenceMetadata {
  const metadata: PayloadClientReferenceMetadata = { id: value.id };
  if (value.exportName !== undefined) metadata.exportName = value.exportName;
  if (value.ssr === true) metadata.ssr = true;
  return metadata;
}

function clientReferenceExportName(id: string): string | undefined {
  const hashIndex = id.lastIndexOf("#");
  if (hashIndex === -1) return undefined;
  const exportName = id.slice(hashIndex + 1);
  return exportName === "" ? undefined : exportName;
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
  const assets = serializeClientReferenceAssets(request, reference);
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

function serializeClientReferenceAssets(
  request: PayloadRequest,
  reference: FigClientReference,
): SerializedAssetResource[] {
  return serializeAssetResources(
    request,
    collectClientReferenceAssets(request, reference),
  );
}

function serializeAssetResources(
  request: PayloadRequest,
  value: unknown,
): SerializedAssetResource[] {
  const input = isFigAssetResource(value)
    ? [value]
    : Array.isArray(value)
      ? value
      : [];
  const resources: SerializedAssetResource[] = [];

  for (const resource of input) {
    if (!isFigAssetResource(resource)) continue;
    // Only stream-safe assets travel on the wire; head-only title/meta are
    // document state, not client-component assets (see the asset-resources plan).
    if (assetResourceDestination(resource) !== "stream") continue;

    const key = assetResourceKey(resource);
    if (request.emittedAssetKeys.has(key)) continue;
    request.emittedAssetKeys.add(key);
    resources.push(serializeAssetResource(resource));
  }

  return resources;
}

function collectClientReferenceAssets(
  request: PayloadRequest,
  reference: FigClientReference,
): readonly FigAssetResource[] {
  const resources = [...clientReferenceAssets(reference)];
  const resolved = request.clientReferenceAssets?.({ id: reference.id });
  if (resolved === undefined) return resources;
  if (isFigAssetResource(resolved)) return [...resources, resolved];
  return Array.isArray(resolved) ? [...resources, ...resolved] : resources;
}

function serializeAssetResource(
  resource: FigAssetResource,
): SerializedAssetResource {
  // The payload asset wire format is descriptor-only and intentionally does not
  // carry author-supplied `key`; streamed assets dedupe by their concrete URL.
  // SSR/head resources still round-trip keys through data-fig-resource-key.
  switch (resource.kind) {
    case "stylesheet":
      return {
        ...(resource.crossOrigin === undefined
          ? {}
          : { crossOrigin: resource.crossOrigin }),
        href: resource.href,
        kind: resource.kind,
        ...(resource.media === undefined ? {} : { media: resource.media }),
        ...(resource.precedence === undefined
          ? {}
          : { precedence: resource.precedence }),
      };
    case "preload":
      return {
        as: resource.as,
        ...(resource.crossOrigin === undefined
          ? {}
          : { crossOrigin: resource.crossOrigin }),
        ...(resource.fetchPriority === undefined
          ? {}
          : { fetchPriority: resource.fetchPriority }),
        href: resource.href,
        kind: resource.kind,
        ...(resource.type === undefined ? {} : { type: resource.type }),
      };
    case "modulepreload":
      return {
        ...(resource.crossOrigin === undefined
          ? {}
          : { crossOrigin: resource.crossOrigin }),
        ...(resource.fetchPriority === undefined
          ? {}
          : { fetchPriority: resource.fetchPriority }),
        href: resource.href,
        kind: resource.kind,
      };
    case "script":
      return {
        ...(resource.async === undefined ? {} : { async: resource.async }),
        ...(resource.crossOrigin === undefined
          ? {}
          : { crossOrigin: resource.crossOrigin }),
        ...(resource.defer === undefined ? {} : { defer: resource.defer }),
        kind: resource.kind,
        ...(resource.module === undefined ? {} : { module: resource.module }),
        src: resource.src,
      };
    case "font":
      return {
        ...(resource.crossOrigin === undefined
          ? {}
          : { crossOrigin: resource.crossOrigin }),
        ...(resource.fetchPriority === undefined
          ? {}
          : { fetchPriority: resource.fetchPriority }),
        href: resource.href,
        kind: resource.kind,
        type: resource.type,
      };
    case "preconnect":
      return {
        ...(resource.crossOrigin === undefined
          ? {}
          : { crossOrigin: resource.crossOrigin }),
        href: resource.href,
        kind: resource.kind,
      };
    case "title":
    case "meta":
      throw new Error(
        "Head-only resources cannot be serialized into the payload.",
      );
  }
}

function emitRow(request: PayloadRequest, row: PayloadRow): void {
  request.queuedRows.push(request.codec.encodeRow(row));
  flushRows(request);
}

function pingTask(request: PayloadRequest, task: Task): void {
  if (request.status === "closed") return;
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

function flushRows(request: PayloadRequest): void {
  if (request.controller === null || request.status === "closed") return;
  if (request.status === "opening") return;

  if (request.queuedRows.length > 0) {
    for (const row of request.queuedRows) request.controller.enqueue(row);
    request.queuedRows = [];
  }

  if (request.pendingTasks === 0) {
    request.status = "closed";
    request.dataStore.dispose();
    request.controller.close();
  }
}

function closeWithError(request: PayloadRequest, error: unknown): void {
  if (request.status === "closed") return;
  request.status = "closed";
  request.dataStore.dispose();
  request.allReady.reject(error);
  request.controller?.error(error);
}

// Wire-format flattening only: unlike the shared collectChildren, this keeps
// empty children and does NOT merge adjacent text — the client decodes rows
// and re-collects children itself, so merging here would double-apply.
function flattenChildArrays(children: FigNode[]): FigNode[] {
  const collected: FigNode[] = [];

  for (const child of children) {
    if (Array.isArray(child)) collected.push(...flattenChildArrays(child));
    else collected.push(child);
  }

  return collected;
}

function invalidChildError(value: unknown): Error {
  return new Error(
    `Invalid Fig child in payload render: ${describeInvalidChild(value)}.`,
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function readByteStream(
  stream: ReadableStream<Uint8Array>,
  onChunk: (chunk: Uint8Array) => void,
  signal?: AbortSignal | null,
): Promise<void> {
  const reader = stream.getReader();
  const abort = () => {
    void reader.cancel(signal?.reason).catch(() => undefined);
  };

  try {
    signal?.addEventListener("abort", abort, { once: true });

    while (true) {
      throwIfAborted(signal);

      const { done, value } = await reader.read();
      throwIfAborted(signal);

      if (done) return;

      onChunk(value);
    }
  } finally {
    signal?.removeEventListener("abort", abort);
    throwIfAborted(signal);
  }
}

function throwIfAborted(signal?: AbortSignal | null): void {
  if (signal?.aborted) throw new PayloadRequestCancelledError();
}

function resolveDecodedRow(
  response: PayloadResponseImpl,
  row: Extract<PayloadRow, { id: number }>,
): void {
  const chunk = response.getChunk(row.id);

  if (row.tag === "error") {
    const error = new Error(
      row.value.message ?? "The server render failed.",
    ) as Error & { digest?: string };
    if (row.value.digest !== undefined) error.digest = row.value.digest;
    chunk.model = null;
    chunk.status = "rejected";
    chunk.value = error;
    chunk.reject(error);
    void chunk.promise.catch(() => undefined);
    return;
  }

  let value: unknown;
  if (row.tag === "client") {
    response.recordClientReference(row.value);
    response.recordAssetResources(row.value.assets);
    value = response.decodeClientReference(clientRowMetadata(row.value));
  } else {
    value = decodeModel(response, row.value);
  }

  chunk.model = row.tag === "model" ? row.value : null;
  chunk.status = "fulfilled";
  chunk.value = value;
  chunk.resolve(value);
}

function shiftRowIds(row: PayloadRow, offset: number): void {
  if (row.tag === "client" || row.tag === "error" || row.tag === "model") {
    // The row's own chunk id. A client row's value.id is a string module id and
    // must not be shifted.
    row.id += offset;
  }
  if (row.tag === "model" || row.tag === "refresh") {
    shiftModelIds(row.value, offset);
  }
}

function shiftModelIds(model: PayloadModel, offset: number): void {
  if (model === null || typeof model !== "object") return;

  if (Array.isArray(model)) {
    for (const item of model) shiftModelIds(item, offset);
    return;
  }

  if ("$fig" in model) {
    const special = model as PayloadElementModel | PayloadSpecialModel;
    switch (special.$fig) {
      case "client":
      case "lazy":
      case "promise":
        special.id += offset;
        return;
      case "element":
        shiftModelIds(special.type, offset);
        shiftModelIds(special.props, offset);
        return;
      case "boundary":
        // boundary.id is a string boundary name, not a numeric chunk id.
        shiftModelIds(special.child, offset);
        return;
      default:
        return;
    }
  }

  for (const value of Object.values(model)) shiftModelIds(value, offset);
}

function decodeModel(
  response: PayloadResponseImpl,
  model: PayloadModel,
): unknown {
  if (model === null) return null;
  if (Array.isArray(model))
    return model.map((item) => decodeModel(response, item));

  if (typeof model !== "object") return model;

  if ("$fig" in model) {
    return decodeSpecialModel(
      response,
      model as PayloadElementModel | PayloadSpecialModel,
    );
  }

  const decoded: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(model)) {
    decoded[name] = decodeModel(response, value);
  }
  return decoded;
}

function decodeSpecialModel(
  response: PayloadResponseImpl,
  model: PayloadElementModel | PayloadSpecialModel,
): unknown {
  switch (model.$fig) {
    case "bigint":
    case "date":
    case "map":
    case "number":
    case "object":
    case "set":
    case "symbol":
    case "undefined":
      return decodePayloadSpecialValue(model);
    case "boundary":
      return createElement(PayloadBoundarySlot, {
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
      return createElement(PayloadLazyNode, { id: model.id, response });
    case "promise":
      return response.getChunk(model.id).promise;
    case "suspense":
      return Suspense;
  }
}

function decodeElementType(
  response: PayloadResponseImpl,
  type: string | PayloadSpecialModel,
): ElementType<any> {
  if (typeof type === "string") return type;
  return decodeSpecialModel(response, type) as ElementType<any>;
}

function PayloadResponseRoot(props: {
  response: PayloadResponseImpl;
}): FigNode {
  return props.response.readChunk(0);
}

function PayloadBoundarySlot(props: {
  id: string;
  initial: PayloadModel;
  response: PayloadResponseImpl;
}): FigNode {
  return props.response.readBoundary(props.id, props.initial);
}

function PayloadLazyNode(props: {
  id: number;
  response: PayloadResponseImpl;
}): FigNode {
  return props.response.readChunk(props.id);
}

function resolveClientReferenceExport(
  moduleValue: unknown,
  metadata: PayloadClientReferenceMetadata,
): ElementType<any> {
  if (typeof moduleValue === "function") return moduleValue as ElementType<any>;

  if (
    typeof moduleValue === "object" &&
    moduleValue !== null &&
    metadata.exportName !== undefined
  ) {
    const candidate = (moduleValue as Record<string, unknown>)[
      metadata.exportName
    ];
    if (typeof candidate === "function") return candidate as ElementType<any>;
  }

  throw new Error(
    `Client reference "${metadata.id}" did not load a component.`,
  );
}

function appendPayloadHeaders(
  codec: PayloadCodec,
  headers: HeadersInit | undefined,
  boundary?: string,
): Headers {
  const next = new Headers(headers);
  if (!next.has("accept")) next.set("accept", codec.contentType);
  if (boundary !== undefined) next.set("x-fig-payload-boundary", boundary);
  return next;
}

function assertPayloadCodecMatches(
  codec: PayloadCodec,
  contentTypeHeader: string | null,
): void {
  if (contentTypeHeader === null) return;
  const received = payloadCodecIdFromContentType(contentTypeHeader);
  if (received === null || received === codec.id) return;
  throw new Error(
    `Payload codec mismatch: response used "${received}" but this client expects "${codec.id}".`,
  );
}

function getOrCreateChunk(
  chunks: Map<number, DecodedChunk>,
  id: number,
): DecodedChunk {
  const existing = chunks.get(id);
  if (existing !== undefined) return existing;

  const settled = deferred<unknown>();
  const chunk: DecodedChunk = {
    decoded: undefined,
    hasDecoded: false,
    model: null,
    promise: settled.promise,
    reject: settled.reject,
    resolve: settled.resolve,
    status: "pending",
    value: undefined,
  };
  chunks.set(id, chunk);
  return chunk;
}

function isPayloadBoundary(value: unknown): value is typeof PayloadBoundary {
  return (
    typeof value === "function" &&
    (value as typeof PayloadBoundary).$$typeof === PayloadBoundarySymbol
  );
}
