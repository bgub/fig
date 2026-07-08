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
  ViewTransition,
} from "@bgub/fig";
import {
  assetResourceDestination,
  assetResourceKey,
  clientReferenceAssets,
  createDataStore,
  type DataStore,
  type DataStoreEntrySnapshot,
  describeInvalidChild,
  isActivity,
  isAssets,
  isClientReference,
  isContext,
  isErrorBoundary,
  FigElementSymbol,
  isFigAssetResource,
  isPortal,
  isSuspense,
  isThenable,
  isValidElement,
  isViewTransition,
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
import type { ServerErrorInfo, ServerErrorPayload } from "./types.ts";

declare const process: { env: { NODE_ENV?: string } };

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

// Stream-safe asset resources only (no head-only title/meta). Optional fields
// stay optional on the wire; omitted `undefined` values are part of the payload
// contract, not a serializer implementation detail.
export type SerializedAssetResource =
  | {
      crossOrigin?: StylesheetResource["crossOrigin"];
      href: string;
      kind: "stylesheet";
      media?: string;
      precedence?: string;
    }
  | {
      as: string;
      crossOrigin?: PreloadResource["crossOrigin"];
      fetchPriority?: PreloadResource["fetchPriority"];
      href: string;
      kind: "preload";
      type?: string;
    }
  | {
      crossOrigin?: ModulePreloadResource["crossOrigin"];
      fetchPriority?: ModulePreloadResource["fetchPriority"];
      href: string;
      kind: "modulepreload";
    }
  | {
      async?: boolean;
      crossOrigin?: ScriptResource["crossOrigin"];
      defer?: boolean;
      kind: "script";
      module?: boolean;
      src: string;
    }
  | {
      crossOrigin?: FontResource["crossOrigin"];
      fetchPriority?: FontResource["fetchPriority"];
      href: string;
      kind: "font";
      type: string;
    }
  | {
      crossOrigin?: PreconnectResource["crossOrigin"];
      href: string;
      kind: "preconnect";
    };

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
  | { boundary: string; tag: "refresh-error"; value: ServerErrorPayload }
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
  id?: number;
  key: Key | null;
  props: PayloadModel;
  type: string | PayloadSpecialModel;
};

type PayloadSpecialModel =
  | { $fig: "array"; id: number; value: PayloadModel[] }
  | { $fig: "boundary"; child: PayloadModel; id: string }
  | { $fig: "bigint"; value: string }
  | { $fig: "client"; id: number }
  | { $fig: "date"; value: string }
  | { $fig: "fragment" }
  | { $fig: "lazy"; id: number }
  | { $fig: "map"; entries: Array<[PayloadModel, PayloadModel]>; id: number }
  | { $fig: "number"; value: "Infinity" | "-Infinity" | "-0" | "NaN" }
  | { $fig: "object"; id?: number; value: Record<string, PayloadModel> }
  | { $fig: "promise"; id: number }
  | { $fig: "ref"; id: number }
  | { $fig: "set"; id: number; values: PayloadModel[] }
  | { $fig: "symbol"; key: string }
  | { $fig: "suspense" }
  | { $fig: "undefined" }
  | { $fig: "view-transition" };

type PayloadValueSpecialModel = Extract<
  PayloadSpecialModel,
  {
    $fig:
      | "array"
      | "bigint"
      | "date"
      | "map"
      | "number"
      | "object"
      | "ref"
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
  /**
   * Creates a streaming row decoder. The decoder calls `onRow` for each
   * complete semantic row. If `onRow` throws, the decoder must propagate that
   * error; when it can already see more complete sibling rows in the same
   * input chunk, it should process those siblings before rethrowing so
   * notifications already implied by earlier rows are not lost.
   */
  createDecoder(onRow: (row: PayloadRow) => void): PayloadDecoder;
  encodeRow(row: PayloadRow): Uint8Array;
}

export interface PayloadDecoder {
  decode(chunk: Uint8Array): void;
  flush(): void;
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
};

interface PayloadGraphEncodeContext {
  ids: WeakMap<object, number>;
  nextId: number;
  objects: Map<number, object>;
}

interface PayloadGraphDecodeContext {
  refs: Map<number, unknown>;
}

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

function createPayloadGraphEncodeContext(): PayloadGraphEncodeContext {
  return { ids: new WeakMap(), nextId: 1, objects: new Map() };
}

function createPayloadGraphDecodeContext(): PayloadGraphDecodeContext {
  return { refs: new Map() };
}

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
  let searchStart = 0;

  function processBufferedLines(): void {
    let lineStart = 0;
    let firstError: unknown;

    for (;;) {
      const newlineIndex = buffer.indexOf("\n", searchStart);
      if (newlineIndex === -1) {
        searchStart = buffer.length;
        break;
      }
      try {
        processPayloadLine(buffer.slice(lineStart, newlineIndex), onRow);
      } catch (error) {
        firstError ??= error;
      }
      lineStart = newlineIndex + 1;
      searchStart = lineStart;
    }

    if (firstError !== undefined) {
      buffer = "";
      searchStart = 0;
      throw firstError;
    }
    if (lineStart > 0) {
      buffer = buffer.slice(lineStart);
      searchStart -= lineStart;
    }
  }

  return {
    decode(chunk) {
      buffer += decoder.decode(chunk, { stream: true });
      processBufferedLines();
    },
    flush() {
      buffer += decoder.decode();
      if (buffer.length > 0) {
        const line = buffer;
        buffer = "";
        searchStart = 0;
        processPayloadLine(line, onRow);
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
    abort: (reason?: unknown) => abortPayloadRequest(request, reason),
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
    await result.body?.cancel().catch(() => undefined);
    throw new PayloadFetchError(result);
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
  throwIfAborted(options.signal);

  const pendingDataSnapshots = new Map<string, DataStoreEntrySnapshot>();
  const request: PayloadRequest = {
    abortListener: null,
    abortSignal: null,
    allReady: deferred<void>(),
    boundaryIds: process.env.NODE_ENV !== "production" ? new Set() : null,
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

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      request.controller = controller;
      flushRows(request);
    },
    cancel(reason) {
      abortPayloadRequest(request, reason);
    },
  });
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

class PayloadResponseImpl implements PayloadResponse {
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
  private stringDecoder: PayloadDecoder;
  private nextModelRevision = 1;
  private maxObjectIdScanDirty = false;
  readonly codec: PayloadCodec;

  constructor(private readonly options: PayloadResponseOptions) {
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

  getRoot(): FigNode {
    return createElement(PayloadResponseRoot, {
      response: this,
    });
  }

  private createDecoder(
    rowIdBase: number,
    objectIdBase: number,
  ): PayloadDecoder {
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
      throw errorFromPayload(row.value);
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
        `Cannot render client reference "${metadata.id}" because createPayloadResponse was not configured with loadClientReference or a matching resolveClientReference.`,
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
): RenderFrame {
  return { contextValues, dispatcher: null, request, stack };
}

function createPayloadDispatcher(frame: RenderFrame): RenderDispatcher {
  return createStaticDispatcher({
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
  const graphCheckpoint = checkpointGraph(frame.request.graph);
  try {
    if (!isValidElement(node)) return serializeNode(node, frame);
    return serializeElement(node, frame, preserveElementIdentity);
  } catch (error) {
    rollbackGraph(frame.request.graph, graphCheckpoint);
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
    ? defineGraphElement(frame.request.graph, element)
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
    emitRow(frame.request, { tag: "assets", value: serialized });
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
      return encodePayloadValueInternal(value, frame.request.graph);
    }
    if (value instanceof Map) {
      return serializeMap(value, frame.request.graph, ([key, item]) => [
        serializeValue(key, frame),
        serializeValue(item, frame),
      ]);
    }
    if (value instanceof Set) {
      return serializeSet(value, frame.request.graph, (item) =>
        serializeValue(item, frame),
      );
    }

    if (Array.isArray(value)) {
      return serializeArray(
        value,
        frame.request.graph,
        () => value,
        (item) => serializeValue(item, frame),
      );
    }

    return serializePlainObject(value, frame.request.graph, (child) =>
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
  return encodePayloadValueInternal(value, createPayloadGraphEncodeContext());
}

function encodePayloadValueInternal(
  value: unknown,
  graph: PayloadGraphEncodeContext,
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
    return serializeArray(
      value,
      graph,
      () => value,
      (item) => encodePayloadValueInternal(item, graph),
    );
  }
  if (value instanceof Date) {
    const json = value.toJSON();
    if (json === null) {
      throw new Error("Invalid Date values cannot be serialized.");
    }
    return { $fig: "date", value: json };
  }
  if (value instanceof Map) {
    return serializeMap(value, graph, ([key, item]) => [
      encodePayloadValueInternal(key, graph),
      encodePayloadValueInternal(item, graph),
    ]);
  }
  if (value instanceof Set) {
    return serializeSet(value, graph, (item) =>
      encodePayloadValueInternal(item, graph),
    );
  }

  if (typeof value === "object" && value !== null) {
    return serializePlainObject(value, graph, (child) =>
      encodePayloadValueInternal(child, graph),
    );
  }

  throw new Error(`Cannot serialize ${typeof value} into the payload.`);
}

function serializeMap(
  value: Map<unknown, unknown>,
  graph: PayloadGraphEncodeContext,
  encodeEntry: (entry: [unknown, unknown]) => [PayloadModel, PayloadModel],
): PayloadModel {
  const existing = graphReference(graph, value);
  if (existing !== null) return existing;
  const id = defineGraphObject(graph, value);
  return {
    $fig: "map",
    id,
    entries: [...value.entries()].map(encodeEntry),
  };
}

function serializeSet(
  value: Set<unknown>,
  graph: PayloadGraphEncodeContext,
  encodeItem: (value: unknown) => PayloadModel,
): PayloadModel {
  const existing = graphReference(graph, value);
  if (existing !== null) return existing;
  const id = defineGraphObject(graph, value);
  return {
    $fig: "set",
    id,
    values: [...value.values()].map(encodeItem),
  };
}

function graphReference(
  graph: PayloadGraphEncodeContext,
  value: object,
): PayloadSpecialModel | null {
  const id = graph.ids.get(value);
  return id === undefined ? null : { $fig: "ref", id };
}

function defineGraphObject(
  graph: PayloadGraphEncodeContext,
  value: object,
): number {
  const id = graph.nextId;
  graph.nextId += 1;
  graph.ids.set(value, id);
  graph.objects.set(id, value);
  return id;
}

function checkpointGraph(graph: PayloadGraphEncodeContext): number {
  return graph.nextId;
}

function rollbackGraph(
  graph: PayloadGraphEncodeContext,
  checkpoint: number,
): void {
  for (let id = graph.nextId - 1; id >= checkpoint; id -= 1) {
    const value = graph.objects.get(id);
    if (value !== undefined) graph.ids.delete(value);
    graph.objects.delete(id);
  }
  graph.nextId = checkpoint;
}

function defineGraphElement(
  graph: PayloadGraphEncodeContext,
  value: FigElement,
): number | PayloadSpecialModel {
  const existing = graphReference(graph, value);
  if (existing !== null) return existing;
  return defineGraphObject(graph, value);
}

function serializeArray<T>(
  value: object,
  graph: PayloadGraphEncodeContext,
  entries: () => readonly T[],
  encodeChild: (value: T) => PayloadModel,
): PayloadModel {
  const existing = graphReference(graph, value);
  if (existing !== null) return existing;
  const id = defineGraphObject(graph, value);
  return { $fig: "array", id, value: entries().map(encodeChild) };
}

function serializePlainObject(
  value: object,
  graph: PayloadGraphEncodeContext,
  encodeChild: (value: unknown) => PayloadModel,
): PayloadModel {
  const existing = graphReference(graph, value);
  if (existing !== null) return existing;
  const id = defineGraphObject(graph, value);
  return {
    $fig: "object",
    id,
    value: encodePayloadRecord(plainPayloadObject(value), encodeChild),
  };
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
): Record<string, PayloadModel> {
  const encoded: Record<string, PayloadModel> = {};
  for (const [name, child] of Object.entries(record)) {
    encoded[name] = encodeChild(child);
  }
  return encoded;
}

function encodePayloadNumber(value: number): number | PayloadSpecialModel {
  if (Number.isNaN(value)) return { $fig: "number", value: "NaN" };
  if (value === Infinity) return { $fig: "number", value: "Infinity" };
  if (value === -Infinity) return { $fig: "number", value: "-Infinity" };
  if (Object.is(value, -0)) return { $fig: "number", value: "-0" };
  return value;
}

/** Decode values produced by encodePayloadValue. */
export function decodePayloadValue(model: PayloadModel): unknown {
  return decodeModelValue(model, createPayloadGraphDecodeContext());
}

function decodeModelValue(
  model: PayloadModel,
  graph: PayloadGraphDecodeContext,
): unknown {
  if (model === null) return null;
  if (Array.isArray(model))
    return model.map((item) => decodeModelValue(item, graph));
  if (typeof model !== "object") return model;

  if (isPayloadValueSpecialModel(model)) {
    return decodePayloadSpecialValue(model, graph);
  }

  return decodePayloadRecord(model as Record<string, PayloadModel>, (child) =>
    decodeModelValue(child, graph),
  );
}

function isPayloadValueSpecialModel(
  model: object,
): model is PayloadValueSpecialModel {
  if (!("$fig" in model)) return false;
  const tag = model.$fig;
  return (
    tag === "bigint" ||
    tag === "array" ||
    tag === "date" ||
    tag === "map" ||
    tag === "number" ||
    tag === "object" ||
    tag === "ref" ||
    tag === "set" ||
    tag === "symbol" ||
    tag === "undefined"
  );
}

function decodePayloadSpecialValue(
  model: PayloadValueSpecialModel,
  graph: PayloadGraphDecodeContext,
): unknown {
  switch (model.$fig) {
    case "array": {
      const value: unknown[] = [];
      graph.refs.set(model.id, value);
      value.push(...model.value.map((item) => decodeModelValue(item, graph)));
      return value;
    }
    case "bigint":
      return BigInt(model.value);
    case "date":
      return new Date(model.value);
    case "map": {
      const value = new Map();
      graph.refs.set(model.id, value);
      for (const [key, item] of model.entries) {
        value.set(decodeModelValue(key, graph), decodeModelValue(item, graph));
      }
      return value;
    }
    case "number":
      return decodePayloadNumber(model.value);
    case "object":
      return decodePayloadPlainObject(model, graph);
    case "ref":
      return readGraphRef(graph, model.id);
    case "set": {
      const value = new Set();
      graph.refs.set(model.id, value);
      for (const item of model.values) {
        value.add(decodeModelValue(item, graph));
      }
      return value;
    }
    case "symbol":
      return Symbol.for(model.key);
    case "undefined":
      return undefined;
  }
}

function decodePayloadPlainObject(
  model: Extract<PayloadValueSpecialModel, { $fig: "object" }>,
  graph: PayloadGraphDecodeContext,
): Record<string, unknown> {
  const decoded: Record<string, unknown> = {};
  if (model.id !== undefined) graph.refs.set(model.id, decoded);
  for (const [name, value] of Object.entries(model.value)) {
    definePayloadProperty(decoded, name, decodeModelValue(value, graph));
  }
  return decoded;
}

function decodePayloadRecord(
  value: Record<string, PayloadModel>,
  decodeChild: (model: PayloadModel) => unknown,
): Record<string, unknown> {
  const decoded: Record<string, unknown> = {};
  for (const [name, child] of Object.entries(value)) {
    definePayloadProperty(decoded, name, decodeChild(child));
  }
  return decoded;
}

function definePayloadProperty(
  target: Record<string, unknown>,
  name: string,
  value: unknown,
): void {
  Object.defineProperty(target, name, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
}

function readGraphRef(graph: PayloadGraphDecodeContext, id: number): unknown {
  if (!graph.refs.has(id)) {
    throw new Error(`Payload referenced unknown object id ${id}.`);
  }
  return graph.refs.get(id);
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
  const graph = createPayloadGraphEncodeContext();
  return entries.map((entry) => encodePayloadDataEntryWithGraph(entry, graph));
}

export function decodePayloadDataEntries(
  entries: readonly PayloadDataHydrationEntry[],
): FigDataHydrationEntry[] {
  const graph = createPayloadGraphDecodeContext();
  return entries.map((entry) => decodePayloadDataEntryWithGraph(entry, graph));
}

/** Encode one Fig data hydration entry for transport in payload/data streams. */
export function encodePayloadDataEntry(
  entry: FigDataHydrationEntry,
): PayloadDataHydrationEntry {
  return encodePayloadDataEntryWithGraph(
    entry,
    createPayloadGraphEncodeContext(),
  );
}

function encodePayloadDataEntryWithGraph(
  entry: FigDataHydrationEntry,
  graph: PayloadGraphEncodeContext,
): PayloadDataHydrationEntry {
  return {
    ...entry,
    value: encodePayloadValueInternal(entry.value, graph),
  };
}

/** Decode one payload data hydration entry back into a Fig data entry. */
export function decodePayloadDataEntry(
  entry: PayloadDataHydrationEntry,
): FigDataHydrationEntry {
  return decodePayloadDataEntryWithGraph(
    entry,
    createPayloadGraphDecodeContext(),
  );
}

function decodePayloadDataEntryWithGraph(
  entry: PayloadDataHydrationEntry,
  graph: PayloadGraphDecodeContext,
): FigDataHydrationEntry {
  return {
    ...entry,
    value: decodeModelValue(entry.value, graph),
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
    return process.env.NODE_ENV !== "production"
      ? { message: errorMessage(error) }
      : {};
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

  if (request.queuedRows.length > 0) {
    for (const row of request.queuedRows) request.controller.enqueue(row);
    request.queuedRows = [];
  }

  if (request.pendingTasks === 0) {
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
  response: PayloadResponseImpl,
  row: Extract<PayloadRow, { id: number }>,
  revision: number,
): void {
  const chunk = response.getChunk(row.id);

  if (row.tag === "error") {
    const error = errorFromPayload(row.value);
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
    value = response.decodeModelAtRevision(row.value, revision);
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

function errorFromPayload(value: ServerErrorPayload): Error & {
  digest?: string;
} {
  const error = new Error(
    value.message ?? "The server render failed.",
  ) as Error & { digest?: string };
  if (value.digest !== undefined) error.digest = value.digest;
  return error;
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
  response: PayloadResponseImpl,
  model: PayloadModel,
): void {
  if (model === null || typeof model !== "object") return;

  if (Array.isArray(model)) {
    for (const item of model) noteMaxObjectIds(response, item);
    return;
  }

  if (isPayloadSpecialModel(model)) {
    switch (model.$fig) {
      case "array":
        response.noteObjectId(model.id);
        for (const value of model.value) noteMaxObjectIds(response, value);
        return;
      case "element":
        if (model.id !== undefined) response.noteObjectId(model.id);
        noteMaxObjectIds(response, model.type);
        noteMaxObjectIds(response, model.props);
        return;
      case "map":
        response.noteObjectId(model.id);
        for (const [key, value] of model.entries) {
          noteMaxObjectIds(response, key);
          noteMaxObjectIds(response, value);
        }
        return;
      case "object":
        if (model.id !== undefined) response.noteObjectId(model.id);
        for (const value of Object.values(model.value)) {
          noteMaxObjectIds(response, value);
        }
        return;
      case "ref":
      case "set":
        response.noteObjectId(model.id);
        if (model.$fig === "set") {
          for (const value of model.values) noteMaxObjectIds(response, value);
        }
        return;
      case "boundary":
        noteMaxObjectIds(response, model.child);
        return;
      default:
        return;
    }
  }

  for (const value of Object.values(model)) noteMaxObjectIds(response, value);
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

function isPayloadSpecialModel(
  model: object,
): model is PayloadElementModel | PayloadSpecialModel {
  if (!("$fig" in model)) return false;

  switch ((model as { $fig: unknown }).$fig) {
    case "array":
    case "bigint":
    case "boundary":
    case "client":
    case "date":
    case "element":
    case "fragment":
    case "lazy":
    case "map":
    case "number":
    case "object":
    case "promise":
    case "ref":
    case "set":
    case "suspense":
    case "symbol":
    case "undefined":
    case "view-transition":
      return true;
    default:
      return false;
  }
}

function decodeModel(
  response: PayloadResponseImpl,
  model: PayloadModel,
): unknown {
  if (model === null) return null;
  if (Array.isArray(model))
    return model.map((item) => decodeModel(response, item));

  if (typeof model !== "object") return model;

  if (isPayloadSpecialModel(model)) {
    return decodeSpecialModel(response, model);
  }

  const decoded: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(model)) {
    definePayloadProperty(decoded, name, decodeModel(response, value));
  }
  return decoded;
}

function decodeSpecialModel(
  response: PayloadResponseImpl,
  model: PayloadElementModel | PayloadSpecialModel,
): unknown {
  switch (model.$fig) {
    case "array": {
      return response.defineObjectRef(
        model.id,
        () => [] as unknown[],
        (value) => {
          value.push(...model.value.map((item) => decodeModel(response, item)));
        },
      );
    }
    case "bigint":
      return BigInt(model.value);
    case "date":
      return new Date(model.value);
    case "map": {
      return response.defineObjectRef(
        model.id,
        () => new Map(),
        (value) => {
          for (const [key, item] of model.entries) {
            value.set(decodeModel(response, key), decodeModel(response, item));
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
          definePayloadProperty(value, name, decodeModel(response, child));
        }
        return value;
      }
      return response.defineObjectRef(
        model.id,
        () => ({}) as Record<string, unknown>,
        (value) => {
          for (const [name, child] of Object.entries(model.value)) {
            definePayloadProperty(value, name, decodeModel(response, child));
          }
        },
      );
    }
    case "ref":
      return response.readObjectRef(model.id);
    case "set": {
      return response.defineObjectRef(
        model.id,
        () => new Set(),
        (value) => {
          for (const item of model.values) {
            value.add(decodeModel(response, item));
          }
        },
      );
    }
    case "symbol":
      return Symbol.for(model.key);
    case "undefined":
      return undefined;
    case "boundary":
      response.prepareBoundaryInitial(model.id, model.child);
      return createElement(PayloadBoundarySlot, {
        id: model.id,
        initial: model.child,
        response,
      });
    case "element": {
      if (model.id !== undefined) {
        return response.defineObjectRef(
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
              response,
              model.type,
            );
            (element as { props: Props }).props = decodeModel(
              response,
              model.props,
            ) as Props;
          },
        );
      }
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
    case "view-transition":
      return ViewTransition;
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
  if (boundary !== undefined) next.set(PAYLOAD_BOUNDARY_HEADER, boundary);
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
