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
  Fragment,
  type Key,
  type Props,
  readPromise,
  Suspense,
  ViewTransition,
} from "@bgub/fig";
import {
  assetResourceDestination,
  assetResourceKey,
  checkpointPayloadGraph,
  clientReferenceAssets,
  createDataStore,
  createPayloadGraphEncodeContext,
  type DataStore,
  type DataStoreEntrySnapshot,
  decodePayloadNumber,
  definePayloadGraphElement,
  definePayloadProperty,
  describeInvalidChild,
  encodePayloadValueWithGraph,
  isActivity,
  isAssets,
  isClientReference,
  isContext,
  isErrorBoundary,
  FigElementSymbol,
  isFigAssetResource,
  isPayloadSpecialModel,
  isPlainPayloadValue,
  isPortal,
  isSuspense,
  isThenable,
  isValidElement,
  isViewTransition,
  normalizeDataResourceKey,
  type PayloadGraphEncodeContext,
  type RenderDispatcher,
  readThenable,
  rollbackPayloadGraph,
  serializePayloadArray,
  serializePayloadMap,
  serializePayloadPlainObject,
  serializePayloadSet,
  setCurrentDataStore,
  setCurrentDispatcher,
  type Thenable,
  trackThenable,
} from "@bgub/fig/internal";
import {
  assertPayloadCodecMatches,
  decodePayloadDataEntries,
  encodePayloadDataEntries,
  encodePayloadValue,
  errorFromPayloadValue,
  jsonPayloadCodec,
  type PayloadClientReferenceMetadata,
  type PayloadCodec,
  type PayloadElementModel,
  type PayloadModel,
  type PayloadRow,
  type PayloadRowDecoder,
  type PayloadSpecialModel,
  type SerializedAssetResource,
} from "@bgub/fig/payload";
import {
  type ContextValues,
  cloneContextValues,
  createStaticDispatcher,
  type Deferred,
  deferred,
  streamFlowBlocked,
  streamHighWaterMark,
  withContextValue,
} from "./shared.ts";
import type { ServerErrorInfo, ServerErrorPayload } from "./types.ts";

// The inline frame transport is part of the payload subpath's public
// surface; its implementation lives in payload-frames.ts.
export {
  getPayloadFrameStream,
  payloadFrameBootstrapCode,
  payloadFrameBootstrapScript,
  payloadFrameScript,
  type PayloadFrameStream,
  type PayloadFrameTransportOptions,
} from "./payload-frames.ts";

declare const __FIG_DEV__: boolean | undefined;

const __DEV__ = typeof __FIG_DEV__ === "boolean" ? __FIG_DEV__ : false;

export interface PayloadRenderResult {
  abort(reason?: unknown): void;
  allReady: Promise<void>;
  contentType: string;
  stream: ReadableStream<Uint8Array>;
}

export interface PayloadRenderOptions {
  clientReferenceAssets?: (metadata: { id: string }) => FigAssetResourceList;
  codec?: PayloadCodec;
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
  refreshBoundary?: string;
}

export interface PayloadRootLike {
  data?: FigDataStoreHandle;
  render(node: FigNode): void;
}

export interface PayloadClientReferenceRecord extends PayloadClientReferenceMetadata {
  assets?: readonly FigAssetResource[];
}

export interface PayloadConsumerOptions {
  codec?: PayloadCodec;
  loadClientReference?: (
    metadata: PayloadClientReferenceMetadata,
  ) => Promise<unknown>;
  resolveClientReference?: (
    metadata: PayloadClientReferenceMetadata,
  ) => ElementType<any> | undefined;
}

export interface PayloadConsumer {
  bindRoot(root: PayloadRootLike): () => void;
  readonly codec: PayloadCodec;
  fetch(
    input: RequestInfo | URL,
    options?: PayloadFetchOptions,
  ): Promise<Response>;
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

export const PAYLOAD_BOUNDARY_HEADER = "x-fig-payload-boundary";

class PayloadRequestCancelledError extends Error {
  constructor() {
    super("Payload request cancelled.");
    this.name = "PayloadRequestCancelledError";
  }
}

export class PayloadFetchError extends Error {
  readonly response: Response;
  readonly status: number;

  constructor(response: Response) {
    super(`Payload request failed with status ${response.status}.`);
    this.name = "PayloadFetchError";
    this.response = response;
    this.status = response.status;
  }
}

type PayloadRequest = {
  abortListener: (() => void) | null;
  abortSignal: AbortSignal | null;
  allReady: Deferred<void>;
  boundaryIds: Set<string> | null;
  clientReferenceRows: Map<string, number>;
  clientReferenceAssets?: (metadata: { id: string }) => FigAssetResourceList;
  codec: PayloadCodec;
  controller: ReadableStreamDefaultController<Uint8Array> | null;
  dataStore: DataStore<object, null>;
  emittedAssetKeys: Set<string>;
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
  refreshBoundary: string | null;
  status: "opening" | "open" | "closed";
  stream: ReadableStream<Uint8Array>;
  workScheduled: boolean;
};

type Task = {
  contextValues: ContextValues;
  id: number;
  kind: "node" | "promise";
  stack: StackFrame | null;
  value: unknown;
};

type Component = (props: Props & { children?: FigNode }) => unknown;

type RenderFrame = {
  contextValues: ContextValues;
  // Built lazily on the first function component; reused for the whole task
  // (the dispatcher reads context through the frame, so it stays current).
  dispatcher: RenderDispatcher | null;
  request: PayloadRequest;
  stack: StackFrame | null;
  // The row id this frame's serialization will settle into. Assets rows carry
  // it as `for` so the client gates exactly that row's reveal on the assets.
  taskId: number;
};

interface PayloadObjectRef {
  value: unknown;
}

interface BoundaryModelEntry {
  id?: string;
  model: PayloadModel;
  revision: number;
  source?: "initial" | "refresh";
}

interface StackFrame {
  name: string;
  parent: StackFrame | null;
}

type DecodedChunk = {
  decoded: unknown;
  hasDecoded: boolean;
  model: PayloadModel | null;
  promise: Promise<unknown>;
  reject(reason: unknown): void;
  resolve(value: unknown): void;
  revision: number;
  status: "pending" | "fulfilled" | "rejected";
  value: unknown;
};

const textEncoder = new TextEncoder();
const PayloadBoundarySymbol = Symbol.for("fig.payload-boundary");
const errorStacks = new WeakMap<object, StackFrame>();
const childrenTreeProps = new Set(["children"]);
const emptyTreeProps = new Set<string>();
const suspenseTreeProps = new Set(["children", "fallback"]);

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
    abort: (reason?: unknown) => abortPayloadRequest(request, reason),
    allReady: request.allReady.promise,
    contentType: request.codec.contentType,
    stream: request.stream,
  };
}

export function createPayloadConsumer(
  options: PayloadConsumerOptions = {},
): PayloadConsumer {
  return new PayloadConsumerImpl(options);
}

export function isPayloadRequestCancelled(error: unknown): boolean {
  return (
    error instanceof PayloadRequestCancelledError ||
    (typeof DOMException !== "undefined" &&
      error instanceof DOMException &&
      error.name === "AbortError")
  );
}

function createPayloadRequest(
  node: FigNode,
  options: PayloadRenderOptions,
): PayloadRequest {
  throwIfAborted(options.signal);

  const pendingDataSnapshots = new Map<string, DataStoreEntrySnapshot>();
  const request: PayloadRequest = {
    abortListener: null,
    abortSignal: null,
    allReady: deferred<void>(),
    boundaryIds: __DEV__ ? new Set() : null,
    clientReferenceRows: new Map(),
    clientReferenceAssets: options.clientReferenceAssets,
    codec: options.codec ?? jsonPayloadCodec,
    controller: null,
    dataStore: createDataStore<object, null>({
      getLane: () => null,
      onEntryChange: (entry: DataStoreEntrySnapshot) => {
        pendingDataSnapshots.set(entry.canonicalKey, entry);
      },
      partition: options.dataPartition,
      schedule: () => undefined,
    }),
    emittedAssetKeys: new Set(),
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
    refreshBoundary: options.refreshBoundary ?? null,
    status: "opening",
    stream: null as never,
    workScheduled: false,
  };
  // allReady also rejects through the stream when a consumer cancels (the
  // normal client-disconnect path); the pre-attached no-op handler keeps it
  // from becoming an unhandled rejection for callers that do not await it
  // (await-ers still observe the rejection).
  void request.allReady.promise.catch(() => undefined);

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
  request.stream = stream;

  if (options.signal !== undefined) {
    const abortListener = () =>
      abortPayloadRequest(request, options.signal?.reason);
    request.abortListener = abortListener;
    request.abortSignal = options.signal;
    options.signal.addEventListener("abort", abortListener, { once: true });
  }

  request.pingedTasks.push(
    createTask(request, 0, "node", node, new Map(), null),
  );

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

class PayloadConsumerImpl implements PayloadConsumer {
  private readonly assetResources = new Map<string, FigAssetResource>();
  private readonly boundaries = new Map<string, BoundaryModelEntry>();
  private readonly decodedBoundaries = new Map<string, FigNode>();
  private readonly initialBoundaries = new Map<string, BoundaryModelEntry>();
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
  private readonly resolvedClientReferenceComponents = new Map<
    string,
    ElementType
  >();
  private listeners = new Set<() => void>();
  private resolveRootReady: () => void = () => undefined;
  readonly rootReady: Promise<void> = new Promise((resolve) => {
    this.resolveRootReady = resolve;
  });
  private maxRowId = 0;
  private maxObjectId = 0;
  private objectIdBase = 0;
  private readonly objectRefs = new Map<number, PayloadObjectRef>();
  private pendingData: FigDataHydrationEntry[] = [];
  private rootData: FigDataStoreHandle | null = null;
  private rowIdBase = 0;
  private currentDecodeRevision = 0;
  private stringDecoder: PayloadRowDecoder;
  private nextModelRevision = 1;
  private maxObjectIdScanDirty = false;
  readonly codec: PayloadCodec;

  constructor(private readonly options: PayloadConsumerOptions) {
    this.codec = options.codec ?? jsonPayloadCodec;
    this.stringDecoder = this.createDecoder(this.rowIdBase, this.objectIdBase);
  }

  beginRefreshPayload(): void {
    // Refresh payloads restart their row ids at 1 on the server, but every
    // payload shares one chunks Map here. Offset an incoming refresh payload's
    // ids past every id seen so far so its outlined client/lazy/promise rows
    // cannot collide with — and clobber — still-mounted chunks from the initial
    // (or an earlier refresh) payload.
    this.ensureMaxObjectIdScanned();
    this.rowIdBase = this.maxRowId;
    this.objectIdBase = this.maxObjectId;
    this.stringDecoder = this.createDecoder(this.rowIdBase, this.objectIdBase);
  }

  private resetPayloadDecoder(): void {
    this.rowIdBase = 0;
    this.objectIdBase = 0;
    this.stringDecoder = this.createDecoder(this.rowIdBase, this.objectIdBase);
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

  async fetch(
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
      throw new Error("PayloadConsumer.fetch requires a fetch implementation.");
    }
    throwIfAborted(signal);

    const response = await fetchImpl(input, {
      ...init,
      headers: appendPayloadHeaders(this.codec, headers, refreshBoundary),
      signal,
    });
    throwIfAborted(signal);
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new PayloadFetchError(response);
    }
    if (response.body === null) {
      throw new Error("Payload response did not include a body.");
    }
    assertPayloadCodecMatches(this.codec, response.headers.get("content-type"));

    // A refresh reuses this consumer's chunks Map but its row ids restart at
    // 1 on the server; namespace them past existing chunks before decoding
    // the stream.
    if (refreshBoundary !== undefined) this.beginRefreshPayload();

    await this.processStream(response.body, signal);
    return response;
  }

  getRoot(): FigNode {
    return createElement(PayloadConsumerRoot, {
      consumer: this,
    });
  }

  private createDecoder(
    rowIdBase: number,
    objectIdBase: number,
  ): PayloadRowDecoder {
    return this.codec.createDecoder((row) =>
      this.processRow(row, rowIdBase, objectIdBase),
    );
  }

  private processRow(
    row: PayloadRow,
    rowIdBase: number,
    objectIdBase: number,
  ): void {
    if (rowIdBase > 0 || objectIdBase > 0) {
      shiftRowIds(row, rowIdBase, objectIdBase);
    }
    this.markMaxObjectIdScanDirty(row);

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
      const revision = this.claimModelRevision();
      this.boundaries.set(row.boundary, { model: row.value, revision });
      this.invalidateDecodeCachesForBoundary(row.boundary);
      this.decodedBoundaries.set(
        row.boundary,
        this.decodeModelAtRevision(row.value, revision) as FigNode,
      );
      const activeBoundaries = this.refreshRetainedChunks();
      this.pruneObjectRefs(activeBoundaries);
      this.notify();
      return;
    }

    if (row.tag === "refresh-error") {
      this.notify();
      throw errorFromPayloadValue(row.value);
    }

    const revision = row.tag === "model" ? this.claimModelRevision() : 0;
    resolveDecodedRow(this, row, revision);
    if (row.id === 0) {
      if (row.tag === "model") {
        const activeBoundaries = this.refreshRetainedChunks();
        this.pruneObjectRefs(activeBoundaries);
      }
      this.resolveRootReady();
      this.notify();
    }
  }

  async processStream(
    stream: ReadableStream<Uint8Array>,
    signal?: AbortSignal | null,
  ): Promise<void> {
    const decoder = this.createDecoder(this.rowIdBase, this.objectIdBase);
    try {
      await readByteStream(stream, (chunk) => decoder.decode(chunk), signal);
      decoder.flush();
    } finally {
      this.resetPayloadDecoder();
    }
  }

  processBytesChunk(chunk: Uint8Array): void {
    this.stringDecoder.decode(chunk);
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

  private invalidateDecodeCachesForBoundary(id: string): void {
    for (const boundaryId of this.decodedBoundaries.keys()) {
      const entry = this.currentBoundaryEntry(boundaryId);
      if (
        boundaryId === id ||
        (entry !== undefined && this.modelCanReachBoundary(entry.model, id))
      ) {
        this.decodedBoundaries.delete(boundaryId);
      }
    }

    for (const chunk of this.chunks.values()) {
      if (chunk.model !== null && this.modelCanReachBoundary(chunk.model, id)) {
        chunk.decoded = undefined;
        chunk.hasDecoded = false;
      }
    }
  }

  defineObjectRef<T>(id: number, create: () => T, fill: (value: T) => void): T {
    const existing = this.objectRefs.get(id);
    if (existing !== undefined) return existing.value as T;

    const value = create();
    this.objectRefs.set(id, { value });
    if (id > this.maxObjectId) this.maxObjectId = id;
    try {
      fill(value);
      return value;
    } catch (error) {
      this.objectRefs.delete(id);
      throw error;
    }
  }

  readObjectRef(id: number): unknown {
    const ref = this.objectRefs.get(id);
    if (ref === undefined) {
      throw new Error(`Payload referenced unknown object id ${id}.`);
    }
    return ref.value;
  }

  noteObjectId(id: number): void {
    if (id > this.maxObjectId) this.maxObjectId = id;
  }

  prepareBoundaryInitial(id: string, initial: PayloadModel): void {
    const revision = this.currentDecodeRevision;
    const previous = this.initialBoundaries.get(id);
    this.initialBoundaries.set(id, { model: initial, revision });
    if (this.currentBoundaryEntry(id)?.model !== initial) return;
    if (
      previous?.model === initial &&
      previous.revision === revision &&
      this.decodedBoundaries.has(id)
    ) {
      return;
    }

    const decoded = this.decodeModelAtRevision(initial, revision) as FigNode;
    this.decodedBoundaries.set(id, decoded);
  }

  pruneObjectRefs(activeBoundaries = this.activeBoundaryEntries()): void {
    if (
      [...this.chunks.entries()].some(
        ([id, chunk]) => id !== 0 && chunk.status === "pending",
      )
    ) {
      return;
    }

    const retained = new Set<number>();
    // Chunks are the graph-object lifetime boundary: refreshRetainedChunks
    // removes dead chunks from this map, so scanning remaining models preserves
    // exactly the graph ids reachable from live payload content.
    for (const chunk of this.chunks.values()) {
      if (chunk.model !== null) collectObjectIds(chunk.model, retained);
    }
    for (const entry of activeBoundaries) {
      collectObjectIds(entry.model, retained);
    }
    for (const id of this.objectRefs.keys()) {
      if (!retained.has(id)) this.objectRefs.delete(id);
    }
  }

  readBoundary(id: string, initial: PayloadModel): FigNode {
    let decoded = this.decodedBoundaries.get(id);
    if (decoded === undefined) {
      const entry = this.currentBoundaryEntry(id);
      const model = entry?.model ?? initial;
      const revision = entry?.revision ?? this.currentDecodeRevision;
      decoded = this.decodeModelAtRevision(model, revision) as FigNode;
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
      chunk.decoded = this.decodeModelAtRevision(chunk.model, chunk.revision);
      chunk.hasDecoded = true;
    }
    return chunk.decoded as FigNode;
  }

  decodeClientReference(metadata: PayloadClientReferenceMetadata): ElementType {
    const resolvedCached = this.resolvedClientReferenceComponents.get(
      metadata.id,
    );
    if (resolvedCached !== undefined) return resolvedCached;

    const cached = this.clientReferenceEntries.get(metadata.id)?.component;
    if (cached !== undefined) return cached;

    const resolved = this.options.resolveClientReference?.(metadata);
    if (resolved !== undefined) {
      const component = function PayloadResolvedClientComponent(props: Props) {
        return createElement(resolved, props);
      };
      this.resolvedClientReferenceComponents.set(metadata.id, component);
      return component;
    }

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

    if (this.options.resolveClientReference !== undefined) {
      return clientReference({
        id: metadata.id,
        load: () => Promise.resolve({}),
      });
    }

    return function PayloadUnresolvedClientComponent(): never {
      throw new Error(
        `Cannot render client reference "${metadata.id}" because createPayloadConsumer was not configured with loadClientReference or a matching resolveClientReference.`,
      );
    };
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

  private refreshRetainedChunks(): BoundaryModelEntry[] {
    const rootModel = this.chunks.get(0)?.model;
    if (rootModel === undefined || rootModel === null) return [];

    const nextRetained = referencedChunkClosure(rootModel, this.chunks);
    const activeBoundaries = this.activeBoundaryEntries();
    for (const entry of activeBoundaries) {
      addChunkRefs(
        nextRetained,
        referencedChunkClosure(entry.model, this.chunks),
      );
    }

    const hasPendingChunks = [...this.chunks.entries()].some(
      ([id, chunk]) => id !== 0 && chunk.status === "pending",
    );
    if (!hasPendingChunks) {
      for (const id of this.chunks.keys()) {
        if (id !== 0 && !nextRetained.has(id)) this.chunks.delete(id);
      }
    }

    const activeSources = new Map(
      activeBoundaries.map((entry) => [entry.id, entry.source]),
    );
    for (const id of this.boundaries.keys()) {
      if (activeSources.get(id) !== "refresh") this.boundaries.delete(id);
    }
    for (const id of this.initialBoundaries.keys()) {
      if (activeSources.get(id) !== "initial") {
        this.initialBoundaries.delete(id);
      }
    }
    for (const id of this.decodedBoundaries.keys()) {
      if (!activeSources.has(id)) this.decodedBoundaries.delete(id);
    }
    return activeBoundaries;
  }

  private markMaxObjectIdScanDirty(row: PayloadRow): void {
    if (row.tag === "model" || row.tag === "refresh") {
      this.maxObjectIdScanDirty = true;
    }
  }

  private ensureMaxObjectIdScanned(): void {
    if (!this.maxObjectIdScanDirty) return;
    this.maxObjectIdScanDirty = false;

    for (const chunk of this.chunks.values()) {
      if (chunk.model !== null) noteMaxObjectIds(this, chunk.model);
    }
    for (const entry of this.boundaries.values()) {
      noteMaxObjectIds(this, entry.model);
    }
    for (const entry of this.initialBoundaries.values()) {
      noteMaxObjectIds(this, entry.model);
    }
  }

  private modelCanReachBoundary(model: PayloadModel, id: string): boolean {
    const models: PayloadModel[] = [model];
    const visitedBoundaries = new Set<string>();
    const visitedChunks = new Set<number>();

    for (let index = 0; index < models.length; index += 1) {
      const current = models[index];
      if (current === undefined) continue;

      const boundaryIds = new Set<string>();
      collectBoundaryIds(current, boundaryIds);
      if (boundaryIds.has(id)) return true;

      for (const boundaryId of boundaryIds) {
        if (visitedBoundaries.has(boundaryId)) continue;
        visitedBoundaries.add(boundaryId);
        const entry = this.currentBoundaryEntry(boundaryId);
        if (entry !== undefined) models.push(entry.model);
      }

      const chunkIds = new Set<number>();
      collectReferencedChunkIds(current, chunkIds);
      for (const chunkId of chunkIds) {
        if (visitedChunks.has(chunkId)) continue;
        visitedChunks.add(chunkId);
        const chunk = this.chunks.get(chunkId);
        if (chunk?.model !== null && chunk?.model !== undefined) {
          models.push(chunk.model);
        }
      }
    }

    return false;
  }

  private activeBoundaryEntries(): BoundaryModelEntry[] {
    const rootModel = this.chunks.get(0)?.model;
    if (rootModel === undefined || rootModel === null) return [];

    const active = new Set<string>();
    const visitedChunks = new Set<number>();
    const models: PayloadModel[] = [rootModel];
    const entries: BoundaryModelEntry[] = [];

    for (let index = 0; index < models.length; index += 1) {
      const chunkIds = new Set<number>();
      collectReferencedChunkIds(models[index] as PayloadModel, chunkIds);
      for (const id of chunkIds) {
        if (visitedChunks.has(id)) continue;
        visitedChunks.add(id);
        const chunk = this.chunks.get(id);
        if (chunk?.model !== null && chunk?.model !== undefined) {
          models.push(chunk.model);
        }
      }

      const ids = new Set<string>();
      collectBoundaryIds(models[index] as PayloadModel, ids);
      for (const id of ids) {
        if (active.has(id)) continue;
        active.add(id);
        const entry = this.currentBoundaryEntry(id);
        if (entry === undefined) continue;
        entries.push({ ...entry, id });
        models.push(entry.model);
      }
    }

    return entries;
  }

  private currentBoundaryEntry(id: string): BoundaryModelEntry | undefined {
    const refreshed = this.boundaries.get(id);
    const initial = this.initialBoundaries.get(id);
    if (refreshed === undefined) {
      return initial === undefined
        ? undefined
        : { ...initial, source: "initial" };
    }
    if (initial === undefined) return { ...refreshed, source: "refresh" };
    return initial.revision > refreshed.revision
      ? { ...initial, source: "initial" }
      : { ...refreshed, source: "refresh" };
  }

  private claimModelRevision(): number {
    const revision = this.nextModelRevision;
    this.nextModelRevision += 1;
    return revision;
  }

  decodeModelAtRevision(model: PayloadModel, revision: number): unknown {
    const previous = this.currentDecodeRevision;
    this.currentDecodeRevision = revision;
    try {
      return decodeModel(this, model);
    } finally {
      this.currentDecodeRevision = previous;
    }
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
  stack: StackFrame | null,
): Task {
  request.pendingTasks += 1;
  return { contextValues, id, kind, stack, value };
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
    task.stack,
    task.id,
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

    if (request.refreshBoundary !== null && task.id === 0) {
      emitRow(request, {
        boundary: request.refreshBoundary,
        tag: "refresh-error",
        value: errorRowPayload(request, error, task.stack),
      });
    } else {
      emitRow(request, {
        id: task.id,
        tag: "error",
        value: errorRowPayload(request, error, task.stack),
      });
    }
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

    const key = normalizeDataResourceKey(snapshot.key);
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

function createRenderFrame(
  request: PayloadRequest,
  contextValues: ContextValues,
  stack: StackFrame | null,
  taskId: number,
): RenderFrame {
  return { contextValues, dispatcher: null, request, stack, taskId };
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

  return serializeElement(node, frame, false);
}

function serializeNodeOrLazy(
  node: FigNode,
  frame: RenderFrame,
  preserveElementIdentity = false,
): PayloadModel {
  const graphCheckpoint = checkpointPayloadGraph(frame.request.graph);
  try {
    if (!isValidElement(node)) return serializeNode(node, frame);
    return serializeElement(node, frame, preserveElementIdentity);
  } catch (error) {
    rollbackPayloadGraph(frame.request.graph, graphCheckpoint);
    if (isThenable(error)) {
      return outlineTask(frame, "node", node, "lazy", error);
    }
    return outlineError(frame, error, "lazy");
  }
}

function serializeElement(
  element: FigElement,
  frame: RenderFrame,
  preserveIdentity: boolean,
): PayloadModel {
  const type = element.type;

  if (typeof type === "string") {
    return serializeElementModel(
      element,
      type,
      frame,
      preserveIdentity,
      childrenTreeProps,
    );
  }

  if (type === Fragment) {
    return serializeElementModel(
      element,
      { $fig: "fragment" },
      frame,
      preserveIdentity,
      childrenTreeProps,
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

  if (isPayloadBoundary(type)) {
    const id = element.props.id;
    if (typeof id !== "string" || id.length === 0) {
      throw new Error("Payload boundaries require a non-empty string id.");
    }
    if (frame.request.refreshBoundary === id) {
      throw new Error(
        `Refresh payload for boundary "${id}" must render that boundary's replacement content, not a nested PayloadBoundary with the same id.`,
      );
    }
    if (frame.request.boundaryIds !== null) {
      if (frame.request.boundaryIds.has(id)) {
        throw new Error(`Duplicate payload boundary id "${id}".`);
      }
      frame.request.boundaryIds.add(id);
    }

    return {
      $fig: "boundary",
      child: serializeTreeProp(element.props.children, frame),
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
    return serializeElementModel(
      element,
      { $fig: "suspense" },
      frame,
      preserveIdentity,
      suspenseTreeProps,
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
      childrenTreeProps,
    );
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
  preserveIdentity: boolean,
  treeProps: ReadonlySet<string> = emptyTreeProps,
): PayloadModel {
  const id = preserveIdentity
    ? definePayloadGraphElement(frame.request.graph, element)
    : undefined;
  if (typeof id === "object") return id;
  return {
    $fig: "element",
    ...(id === undefined ? null : { id }),
    key: element.key,
    props: serializeProps(element.props, frame, treeProps),
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
  const previousStack = frame.stack;
  frame.stack = { name: type.name || "Anonymous", parent: previousStack };

  try {
    const result = type(props);
    const node = isThenable(result) ? readThenable(result) : result;
    return serializeNode(node as FigNode, frame);
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
  const serialized = serializeAssetResources(frame.request, props.assets);
  if (serialized.length > 0) {
    // `for` declares the dependent row. If this subtree later suspends and
    // outlines, the assets gate the enclosing row instead of the hole — the
    // stylesheets are already loading by the time the hole's row arrives, so
    // the skew only ever over-gates, never blocks.
    emitRow(frame.request, {
      for: frame.taskId,
      tag: "assets",
      value: serialized,
    });
  }
  return serializeNode(props.children, frame);
}

function serializeProps(
  props: Props,
  frame: RenderFrame,
  treeProps: ReadonlySet<string>,
): PayloadModel {
  const value: Record<string, PayloadModel> = {};
  for (const [name, child] of Object.entries(props)) {
    value[name] = treeProps.has(name)
      ? serializeTreeProp(child as FigNode, frame)
      : serializeValue(child, frame);
  }
  return {
    $fig: "object",
    value,
  };
}

function serializeTreeProp(value: FigNode, frame: RenderFrame): PayloadModel {
  if (Array.isArray(value)) {
    return flattenChildArrays(value).map((child) =>
      serializeNodeOrLazy(child, frame),
    );
  }
  return serializeNodeOrLazy(value, frame);
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
  if (isValidElement(value)) return serializeNodeOrLazy(value, frame, true);
  if (isPortal(value)) return null;

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
      return serializePayloadArray(
        value,
        frame.request.graph,
        () => value,
        (item) => serializeValue(item, frame),
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
    stackForError(wakeable, frame.stack),
  );

  wakeable.then(
    () => pingTask(request, task),
    () => pingTask(request, task),
  );

  return { $fig: referenceKind, id };
}

function outlineError(
  frame: RenderFrame,
  error: unknown,
  referenceKind: "lazy" | "promise",
): PayloadSpecialModel {
  const request = frame.request;
  const id = request.nextRowId++;
  emitRow(request, {
    id,
    tag: "error",
    value: errorRowPayload(request, error, frame.stack),
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

function componentStack(stack: StackFrame | null): string {
  const frames: string[] = [];
  for (let frame = stack; frame !== null; frame = frame.parent) {
    frames.push(`    at ${frame.name}`);
  }
  return frames.length === 0 ? "" : `\n${frames.join("\n")}`;
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

  return unsupportedSerializedAssetResource(resource);
}

function unsupportedSerializedAssetResource(resource: FigAssetResource): never {
  throw new Error(`Unsupported asset resource kind: ${resource.kind}`);
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
    if (flushed > 0) request.queuedRows = request.queuedRows.slice(flushed);
  } finally {
    request.flushingRows = false;
  }

  // Deliberately not conditioned on flow: close() only marks the end of the
  // queue, so a full queue with no rows left to write still closes here.
  if (request.pendingTasks === 0 && request.queuedRows.length === 0) {
    request.status = "closed";
    cleanupPayloadAbortListener(request);
    request.dataStore.dispose();
    request.controller.close();
  }
}

function closeWithError(request: PayloadRequest, error: unknown): void {
  if (request.status === "closed") return;
  cleanupPayloadAbortListener(request);
  request.status = "closed";
  request.dataStore.dispose();
  request.allReady.reject(error);
  request.controller?.error(error);
}

function abortPayloadRequest(request: PayloadRequest, reason?: unknown): void {
  closeWithError(request, reason ?? new PayloadRequestCancelledError());
}

function cleanupPayloadAbortListener(request: PayloadRequest): void {
  if (request.abortListener === null) return;
  request.abortSignal?.removeEventListener("abort", request.abortListener);
  request.abortListener = null;
  request.abortSignal = null;
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
  } catch (error) {
    if (!signal?.aborted) {
      await reader.cancel(error).catch(() => undefined);
    }
    throw error;
  } finally {
    signal?.removeEventListener("abort", abort);
    reader.releaseLock();
    throwIfAborted(signal);
  }
}

function throwIfAborted(signal?: AbortSignal | null): void {
  if (signal?.aborted) throw new PayloadRequestCancelledError();
}

function resolveDecodedRow(
  consumer: PayloadConsumerImpl,
  row: Extract<PayloadRow, { id: number }>,
  revision: number,
): void {
  const chunk = consumer.getChunk(row.id);

  if (row.tag === "error") {
    const error = errorFromPayloadValue(row.value);
    chunk.model = null;
    chunk.status = "rejected";
    chunk.value = error;
    chunk.reject(error);
    void chunk.promise.catch(() => undefined);
    return;
  }

  let value: unknown;
  if (row.tag === "client") {
    consumer.recordClientReference(row.value);
    consumer.recordAssetResources(row.value.assets);
    value = consumer.decodeClientReference(clientRowMetadata(row.value));
  } else {
    value = consumer.decodeModelAtRevision(row.value, revision);
  }

  chunk.model = row.tag === "model" ? row.value : null;
  chunk.revision = revision;
  if (row.tag === "model") {
    chunk.decoded = value;
    chunk.hasDecoded = true;
  }
  chunk.status = "fulfilled";
  chunk.value = value;
  chunk.resolve(value);
}

function shiftRowIds(
  row: PayloadRow,
  rowOffset: number,
  objectOffset: number,
): void {
  if (row.tag === "client" || row.tag === "error" || row.tag === "model") {
    // The row's own chunk id. A client row's value.id is a string module id and
    // must not be shifted.
    row.id += rowOffset;
  }
  if (row.tag === "model" || row.tag === "refresh") {
    shiftModelIds(row.value, rowOffset, objectOffset);
  }
  if (row.tag === "data") {
    for (const entry of row.value) {
      shiftModelIds(entry.value, rowOffset, objectOffset);
    }
  }
}

function shiftModelIds(
  model: PayloadModel,
  rowOffset: number,
  objectOffset: number,
): void {
  if (model === null || typeof model !== "object") return;

  if (Array.isArray(model)) {
    for (const item of model) shiftModelIds(item, rowOffset, objectOffset);
    return;
  }

  if (isPayloadSpecialModel(model)) {
    const special = model;
    switch (special.$fig) {
      case "array":
        special.id += objectOffset;
        for (const value of special.value) {
          shiftModelIds(value, rowOffset, objectOffset);
        }
        return;
      case "client":
      case "lazy":
      case "promise":
        special.id += rowOffset;
        return;
      case "element":
        if (special.id !== undefined) special.id += objectOffset;
        shiftModelIds(special.type, rowOffset, objectOffset);
        shiftModelIds(special.props, rowOffset, objectOffset);
        return;
      case "object":
        if (special.id !== undefined) special.id += objectOffset;
        for (const value of Object.values(special.value)) {
          shiftModelIds(value, rowOffset, objectOffset);
        }
        return;
      case "boundary":
        // boundary.id is a string boundary name, not a numeric chunk id.
        shiftModelIds(special.child, rowOffset, objectOffset);
        return;
      case "map":
        special.id += objectOffset;
        for (const [key, value] of special.entries) {
          shiftModelIds(key, rowOffset, objectOffset);
          shiftModelIds(value, rowOffset, objectOffset);
        }
        return;
      case "ref":
        special.id += objectOffset;
        return;
      case "set":
        special.id += objectOffset;
        for (const value of special.values) {
          shiftModelIds(value, rowOffset, objectOffset);
        }
        return;
      default:
        return;
    }
  }

  for (const value of Object.values(model)) {
    shiftModelIds(value, rowOffset, objectOffset);
  }
}

function noteMaxObjectIds(
  consumer: PayloadConsumerImpl,
  model: PayloadModel,
): void {
  if (model === null || typeof model !== "object") return;

  if (Array.isArray(model)) {
    for (const item of model) noteMaxObjectIds(consumer, item);
    return;
  }

  if (isPayloadSpecialModel(model)) {
    switch (model.$fig) {
      case "array":
        consumer.noteObjectId(model.id);
        for (const value of model.value) noteMaxObjectIds(consumer, value);
        return;
      case "element":
        if (model.id !== undefined) consumer.noteObjectId(model.id);
        noteMaxObjectIds(consumer, model.type);
        noteMaxObjectIds(consumer, model.props);
        return;
      case "map":
        consumer.noteObjectId(model.id);
        for (const [key, value] of model.entries) {
          noteMaxObjectIds(consumer, key);
          noteMaxObjectIds(consumer, value);
        }
        return;
      case "object":
        if (model.id !== undefined) consumer.noteObjectId(model.id);
        for (const value of Object.values(model.value)) {
          noteMaxObjectIds(consumer, value);
        }
        return;
      case "ref":
      case "set":
        consumer.noteObjectId(model.id);
        if (model.$fig === "set") {
          for (const value of model.values) noteMaxObjectIds(consumer, value);
        }
        return;
      case "boundary":
        noteMaxObjectIds(consumer, model.child);
        return;
      default:
        return;
    }
  }

  for (const value of Object.values(model)) noteMaxObjectIds(consumer, value);
}

function collectObjectIds(model: PayloadModel, ids: Set<number>): void {
  if (model === null || typeof model !== "object") return;

  if (Array.isArray(model)) {
    for (const item of model) collectObjectIds(item, ids);
    return;
  }

  if (isPayloadSpecialModel(model)) {
    switch (model.$fig) {
      case "array":
        ids.add(model.id);
        for (const value of model.value) collectObjectIds(value, ids);
        return;
      case "element":
        if (model.id !== undefined) ids.add(model.id);
        collectObjectIds(model.type, ids);
        collectObjectIds(model.props, ids);
        return;
      case "map":
        ids.add(model.id);
        for (const [key, value] of model.entries) {
          collectObjectIds(key, ids);
          collectObjectIds(value, ids);
        }
        return;
      case "object":
        if (model.id !== undefined) ids.add(model.id);
        for (const value of Object.values(model.value)) {
          collectObjectIds(value, ids);
        }
        return;
      case "ref":
        ids.add(model.id);
        return;
      case "set":
        ids.add(model.id);
        for (const value of model.values) collectObjectIds(value, ids);
        return;
      case "boundary":
        return;
      default:
        return;
    }
  }

  for (const value of Object.values(model)) collectObjectIds(value, ids);
}

function collectBoundaryIds(model: PayloadModel, ids: Set<string>): void {
  if (model === null || typeof model !== "object") return;

  if (Array.isArray(model)) {
    for (const item of model) collectBoundaryIds(item, ids);
    return;
  }

  if (isPayloadSpecialModel(model)) {
    switch (model.$fig) {
      case "array":
        for (const value of model.value) collectBoundaryIds(value, ids);
        return;
      case "element":
        collectBoundaryIds(model.type, ids);
        collectBoundaryIds(model.props, ids);
        return;
      case "object":
        for (const value of Object.values(model.value)) {
          collectBoundaryIds(value, ids);
        }
        return;
      case "boundary":
        ids.add(model.id);
        return;
      case "map":
        for (const [key, value] of model.entries) {
          collectBoundaryIds(key, ids);
          collectBoundaryIds(value, ids);
        }
        return;
      case "set":
        for (const value of model.values) collectBoundaryIds(value, ids);
        return;
      default:
        return;
    }
  }

  for (const value of Object.values(model)) collectBoundaryIds(value, ids);
}

function referencedChunkClosure(
  model: PayloadModel,
  chunks: ReadonlyMap<number, DecodedChunk>,
): Set<number> {
  const ids = new Set<number>();
  const pending = [model];
  for (let index = 0; index < pending.length; index += 1) {
    const next = new Set<number>();
    collectReferencedChunkIds(pending[index] as PayloadModel, next);
    for (const id of next) {
      if (ids.has(id)) continue;
      ids.add(id);
      const chunk = chunks.get(id);
      if (chunk?.model !== null && chunk?.model !== undefined) {
        pending.push(chunk.model);
      }
    }
  }
  return ids;
}

function collectReferencedChunkIds(
  model: PayloadModel,
  ids: Set<number>,
): void {
  if (model === null || typeof model !== "object") return;

  if (Array.isArray(model)) {
    for (const item of model) collectReferencedChunkIds(item, ids);
    return;
  }

  if (isPayloadSpecialModel(model)) {
    switch (model.$fig) {
      case "array":
        for (const value of model.value) collectReferencedChunkIds(value, ids);
        return;
      case "client":
      case "lazy":
      case "promise":
        ids.add(model.id);
        return;
      case "element":
        collectReferencedChunkIds(model.type, ids);
        collectReferencedChunkIds(model.props, ids);
        return;
      case "object":
        for (const value of Object.values(model.value)) {
          collectReferencedChunkIds(value, ids);
        }
        return;
      case "ref":
        return;
      case "boundary":
        return;
      case "map":
        for (const [key, value] of model.entries) {
          collectReferencedChunkIds(key, ids);
          collectReferencedChunkIds(value, ids);
        }
        return;
      case "set":
        for (const value of model.values) collectReferencedChunkIds(value, ids);
        return;
      default:
        return;
    }
  }

  for (const value of Object.values(model)) {
    collectReferencedChunkIds(value, ids);
  }
}

function addChunkRefs(target: Set<number>, ids: Set<number>): void {
  for (const id of ids) target.add(id);
}

function decodeModel(
  consumer: PayloadConsumerImpl,
  model: PayloadModel,
): unknown {
  if (model === null) return null;
  if (Array.isArray(model))
    return model.map((item) => decodeModel(consumer, item));

  if (typeof model !== "object") return model;

  if (isPayloadSpecialModel(model)) {
    return decodeSpecialModel(consumer, model);
  }

  const decoded: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(model)) {
    definePayloadProperty(decoded, name, decodeModel(consumer, value));
  }
  return decoded;
}

function decodeSpecialModel(
  consumer: PayloadConsumerImpl,
  model: PayloadElementModel | PayloadSpecialModel,
): unknown {
  switch (model.$fig) {
    case "array": {
      return consumer.defineObjectRef(
        model.id,
        () => [] as unknown[],
        (value) => {
          value.push(...model.value.map((item) => decodeModel(consumer, item)));
        },
      );
    }
    case "bigint":
      return BigInt(model.value);
    case "date":
      return new Date(model.value);
    case "map": {
      return consumer.defineObjectRef(
        model.id,
        () => new Map(),
        (value) => {
          for (const [key, item] of model.entries) {
            value.set(decodeModel(consumer, key), decodeModel(consumer, item));
          }
        },
      );
    }
    case "number":
      return decodePayloadNumber(model.value);
    case "object": {
      if (model.id === undefined) {
        const value: Record<string, unknown> = {};
        for (const [name, child] of Object.entries(model.value)) {
          definePayloadProperty(value, name, decodeModel(consumer, child));
        }
        return value;
      }
      return consumer.defineObjectRef(
        model.id,
        () => ({}) as Record<string, unknown>,
        (value) => {
          for (const [name, child] of Object.entries(model.value)) {
            definePayloadProperty(value, name, decodeModel(consumer, child));
          }
        },
      );
    }
    case "ref":
      return consumer.readObjectRef(model.id);
    case "set": {
      return consumer.defineObjectRef(
        model.id,
        () => new Set(),
        (value) => {
          for (const item of model.values) {
            value.add(decodeModel(consumer, item));
          }
        },
      );
    }
    case "symbol":
      return Symbol.for(model.key);
    case "undefined":
      return undefined;
    case "boundary":
      consumer.prepareBoundaryInitial(model.id, model.child);
      return createElement(PayloadBoundarySlot, {
        id: model.id,
        initial: model.child,
        consumer,
      });
    case "element": {
      if (model.id !== undefined) {
        return consumer.defineObjectRef(
          model.id,
          () =>
            ({
              $$typeof: FigElementSymbol,
              key: model.key,
              props: {},
              type: Fragment,
            }) as FigElement,
          (element) => {
            (element as { type: ElementType<any> }).type = decodeElementType(
              consumer,
              model.type,
            );
            (element as { props: Props }).props = decodeModel(
              consumer,
              model.props,
            ) as Props;
          },
        );
      }
      const type = decodeElementType(consumer, model.type);
      const props = decodeModel(consumer, model.props) as Props & {
        key?: Key | null;
      };
      if (model.key !== null) props.key = model.key;
      return createElement(type, props);
    }
    case "client":
      return consumer.readChunk(model.id);
    case "fragment":
      return Fragment;
    case "lazy":
      return createElement(PayloadLazyNode, { id: model.id, consumer });
    case "promise":
      return consumer.getChunk(model.id).promise;
    case "suspense":
      return Suspense;
    case "view-transition":
      return ViewTransition;
  }
}

function decodeElementType(
  consumer: PayloadConsumerImpl,
  type: string | PayloadSpecialModel,
): ElementType<any> {
  if (typeof type === "string") return type;
  return decodeSpecialModel(consumer, type) as ElementType<any>;
}

function PayloadConsumerRoot(props: {
  consumer: PayloadConsumerImpl;
}): FigNode {
  return props.consumer.readChunk(0);
}

function PayloadBoundarySlot(props: {
  id: string;
  initial: PayloadModel;
  consumer: PayloadConsumerImpl;
}): FigNode {
  return props.consumer.readBoundary(props.id, props.initial);
}

function PayloadLazyNode(props: {
  id: number;
  consumer: PayloadConsumerImpl;
}): FigNode {
  return props.consumer.readChunk(props.id);
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
  if (boundary !== undefined) next.set(PAYLOAD_BOUNDARY_HEADER, boundary);
  return next;
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
    revision: 0,
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
