import type { FigDataHydrationEntry } from "./data.ts";
import {
  createElement,
  type ElementType,
  type FigElement,
  FigElementSymbol,
  type FigNode,
  Fragment,
  type Key,
  type Props,
  Suspense,
  ViewTransition,
} from "./element.ts";
import { readPromise } from "./hooks.ts";
import {
  decodePayloadDataEntries,
  decodePayloadRecord,
  decodePayloadValueTag,
  errorFromPayloadValue,
  isPayloadSpecialModel,
  jsonPayloadCodec,
  type PayloadDecodeRefs,
  type PayloadElementModel,
  type PayloadModel,
  type PayloadRow,
  type PayloadRowDecoder,
  type PayloadSpecialModel,
  type PayloadValueSpecialModel,
  type SerializedAssetResource,
} from "./payload-format.ts";
import { type FigAssetResource, isFigAssetResource } from "./resource.ts";
import { isThenable, trackThenable } from "./thenables.ts";

export interface PayloadClientReference {
  assets?: readonly FigAssetResource[];
  exportName?: string;
  id: string;
  ssr?: boolean;
}

export type ResolveClientReference = (
  reference: PayloadClientReference,
) => ElementType<any> | PromiseLike<ElementType<any>> | undefined;

/**
 * A caller-owned client-reference component cache. Passing one to
 * `decodePayloadStream` makes every client reference decode to a single
 * cache-owned wrapper per reference id, so re-decoding a payload updates
 * islands in place instead of remounting them. The caller owns the lifetime:
 * drop entries when their modules change (HMR) or the manifest swaps.
 */
export interface PayloadClientReferenceCache {
  clear(): void;
  delete(id: string): boolean;
}

const clientReferenceCacheEntries = new WeakMap<
  PayloadClientReferenceCache,
  Map<string, ElementType<any>>
>();

export function createPayloadClientReferenceCache(): PayloadClientReferenceCache {
  const entries = new Map<string, ElementType<any>>();
  const cache: PayloadClientReferenceCache = {
    clear: () => entries.clear(),
    delete: (id: string) => entries.delete(id),
  };
  clientReferenceCacheEntries.set(cache, entries);
  return cache;
}

// Reveal gates ride the decoded element instances, not the reference
// wrapper: each decode attaches its own gate to the elements it
// materializes. Identity lives on the component type; the asset dependency
// lives on the element — so a mounted island (a previous decode's elements)
// can never be re-suspended by a newer decode's pending assets, while the
// newer decode's elements gate on exactly the assets they declared.
// Elements minted outside a decode from a cached component carry no gate
// and render ungated: they declared no dependency.
const elementGates = new WeakMap<Props, Promise<void>>();

function readElementGate(props: Props): void {
  const gate = elementGates.get(props);
  // Suspends while pending; gates never reject (prepareAssets results
  // settle through noop handlers).
  if (gate !== undefined) readPromise(gate);
}

export type PayloadDecodeCompletion =
  | { status: "aborted" }
  | { status: "complete" }
  | { status: "failed"; error: unknown };

export interface PayloadDecodeOptions {
  /**
   * Stabilizes client-reference identity across decodes that share the
   * cache (created by `createPayloadClientReferenceCache`). Without one,
   * gated and asynchronously resolved references decode to per-decode
   * wrappers and remount on re-decode. Use one cache per resolver.
   */
  clientReferenceCache?: PayloadClientReferenceCache;
  /**
   * Receives decoded `data` rows for hydration into a data store. The
   * capability itself is expected to be generation-guarded and to ignore
   * entries after its caller loses authority.
   */
  hydrate?: (entries: readonly FigDataHydrationEntry[]) => void;
  /**
   * Observes the end of ingestion: called exactly once when the stream
   * settles as complete, failed, or aborted. Post-root failures reject the
   * holes they strand, but a failure with no pending slot is otherwise
   * invisible — this is the hook for reporting it. The callback is never
   * awaited, and its exceptions and rejections are swallowed, so an
   * observer cannot block or break decode teardown.
   */
  onStreamDone?: (result: PayloadDecodeCompletion) => void;
  /**
   * Called with stream-safe asset resources as soon as their rows arrive
   * (e.g. fig-dom's insertAssetResources). A returned promise gates the
   * reveal of only the content that declared a dependency on those assets;
   * gate settlement — fulfilled or rejected — releases the reveal, so a
   * failed asset never blocks content.
   */
  prepareAssets?: (
    assets: readonly FigAssetResource[],
  ) => void | PromiseLike<void>;
  resolveClientReference?: ResolveClientReference;
  signal?: AbortSignal;
}

class PayloadDecodeAbortedError extends Error {
  constructor(reason?: unknown) {
    super(
      "Payload decode aborted.",
      reason === undefined ? undefined : { cause: reason },
    );
    this.name = "PayloadDecodeAbortedError";
  }
}

/**
 * Decode a payload row stream. The returned promise resolves with the
 * decoded root FigNode as soon as the root row decodes (and rejects only
 * when the stream fails before producing a root value, or with the root
 * row's own error); decoding continues in the background, filling outlined
 * holes as their rows arrive. Post-root failures reject the holes they
 * strand and report through `onStreamDone`. Aborting `options.signal`
 * ignores remaining rows and rejects unresolved holes with an internal
 * cancellation reason.
 */
export function decodePayloadStream(
  stream: ReadableStream<Uint8Array>,
  options: PayloadDecodeOptions = {},
): Promise<FigNode> {
  if (
    options.clientReferenceCache !== undefined &&
    !clientReferenceCacheEntries.has(options.clientReferenceCache)
  ) {
    throw new TypeError(
      "options.clientReferenceCache must be created by " +
        "createPayloadClientReferenceCache().",
    );
  }
  return new PayloadStreamDecode(stream, options).value;
}

type DecodeChunk = {
  // The chunk's row has been ingested (decoded or rejected); reveal may still
  // be waiting on an asset gate. Truncation and abort reject only chunks
  // whose rows never arrived.
  arrived: boolean;
  // Materialized lazily: most rows settle synchronously at arrival and are
  // only ever read through status/value, so eagerly allocating a promise,
  // its resolvers, and a thenable-registry entry per row would be waste.
  promise: Promise<unknown> | null;
  reject: ((reason: unknown) => void) | null;
  resolve: ((value: unknown) => void) | null;
  status: "pending" | "fulfilled" | "rejected";
  value: unknown;
};

const noop = (): void => undefined;

interface Deferred<T> {
  promise: Promise<T>;
  reject: (reason: unknown) => void;
  resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve: Deferred<T>["resolve"] = noop;
  let reject: Deferred<T>["reject"] = noop;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return { promise, reject, resolve };
}

class PayloadStreamDecode {
  readonly value: Promise<FigNode>;

  private readonly chunks = new Map<number, DecodeChunk>();
  private readonly objectRefs = new Map<number, unknown>();
  // Asset gates registered for a row id (assets rows carry `for`); consumed
  // when that row arrives.
  private readonly rowGates = new Map<number, Array<PromiseLike<void>>>();
  // Unsettled reveal gates for arrived client rows, attached per element as
  // models referencing the row materialize (see elementGates).
  private readonly clientRowGates = new Map<number, Promise<void>>();
  private readonly rowDecoder: PayloadRowDecoder;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private done = false;
  // Resolved on abort so arrived-but-gated chunks reveal instead of waiting
  // for asset gates that may never settle.
  private readonly releaseGates: () => void;
  private readonly gatesReleased: Promise<void>;
  private removeAbortListener: () => void = noop;
  // One closure and one refs adapter reused across every decoded model, so
  // the per-node decode loop allocates only the decoded values themselves.
  private readonly decodeChild = (model: PayloadModel): unknown =>
    this.decodeModel(model);
  private readonly valueRefs: PayloadDecodeRefs = {
    define: (id, create, fill) => this.defineObjectRef(id, create, fill),
    read: (id) => {
      if (!this.objectRefs.has(id)) {
        throw new Error(`Payload referenced unknown object id ${id}.`);
      }
      return this.objectRefs.get(id);
    },
  };

  constructor(
    stream: ReadableStream<Uint8Array>,
    private readonly options: PayloadDecodeOptions,
  ) {
    const gates = deferred<void>();
    this.gatesReleased = gates.promise;
    this.releaseGates = () => gates.resolve(undefined);
    this.rowDecoder = jsonPayloadCodec.createDecoder((row) =>
      this.handleRow(row),
    );
    this.value = this.chunkPromise(this.getChunk(0)) as Promise<FigNode>;

    void this.ingest(stream);

    const signal = options.signal;
    if (signal !== undefined) {
      if (signal.aborted) {
        this.abort(signal.reason);
      } else {
        const onAbort = () => this.abort(signal.reason);
        signal.addEventListener("abort", onAbort, { once: true });
        this.removeAbortListener = () =>
          signal.removeEventListener("abort", onAbort);
      }
    }
  }

  abort(reason?: unknown): void {
    if (this.done) return;
    const error = new PayloadDecodeAbortedError(reason);
    this.releaseGates();
    void this.reader?.cancel(error).catch(noop);
    this.rejectUnresolved(error);
    this.settle({ status: "aborted" });
  }

  private async ingest(stream: ReadableStream<Uint8Array>): Promise<void> {
    const reader = stream.getReader();
    this.reader = reader;

    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (this.done) return;
        if (done) break;
        this.rowDecoder.decode(value);
      }
      this.rowDecoder.flush();
      this.finishIngestion();
    } catch (error) {
      if (this.done) return;
      void reader.cancel(error).catch(noop);
      this.failIngestion(error);
    }
  }

  private finishIngestion(): void {
    let truncated = false;
    for (const chunk of this.chunks.values()) {
      if (!chunk.arrived) {
        truncated = true;
        break;
      }
    }
    if (truncated) {
      // The server closes the stream only after every outlined row has been
      // written, so an unresolved reference at end-of-stream is truncation.
      this.failIngestion(
        new Error("Payload stream ended before all referenced rows arrived."),
      );
      return;
    }
    this.settle({ status: "complete" });
  }

  private failIngestion(error: unknown): void {
    if (this.done) return;
    this.rejectUnresolved(error);
    this.settle({ status: "failed", error });
  }

  private rejectUnresolved(error: unknown): void {
    for (const chunk of this.chunks.values()) {
      if (chunk.arrived) continue;
      chunk.arrived = true;
      this.rejectChunk(chunk, error);
    }
  }

  private settle(result: PayloadDecodeCompletion): void {
    if (this.done) return;
    this.done = true;
    this.removeAbortListener();
    try {
      const observed = this.options.onStreamDone?.(result) as unknown;
      // An async observer's rejection must not surface as an unhandled
      // rejection any more than a sync throw may break teardown.
      if (isThenable(observed)) void Promise.resolve(observed).then(noop, noop);
    } catch {
      // An observer must not be able to break ingestion teardown.
    }
  }

  private handleRow(row: PayloadRow): void {
    if (this.done) return;

    switch (row.tag) {
      case "model": {
        const chunk = this.getChunk(row.id);
        const decoded = this.decodeModel(row.value);
        chunk.arrived = true;
        const gates = this.rowGates.get(row.id);
        if (gates === undefined) {
          this.fulfillChunk(chunk, decoded);
          return;
        }
        this.rowGates.delete(row.id);
        void Promise.race([Promise.all(gates), this.gatesReleased]).then(() =>
          this.fulfillChunk(chunk, decoded),
        );
        return;
      }
      case "client": {
        const chunk = this.getChunk(row.id);
        const reference: PayloadClientReference = { id: row.value.id };
        if (row.value.exportName !== undefined) {
          reference.exportName = row.value.exportName;
        }
        if (row.value.ssr === true) reference.ssr = true;
        const assets = row.value.assets?.filter(isFigAssetResource);
        if (assets !== undefined && assets.length > 0) {
          reference.assets = assets;
        }
        const gate = this.prepareAssets(row.value.assets);
        if (gate !== null) {
          // Elements referencing this row inherit the gate as they
          // materialize; once it settles there is nothing left to gate.
          this.clientRowGates.set(row.id, gate);
          const settled = (): void => {
            this.clientRowGates.delete(row.id);
          };
          void gate.then(settled, settled);
        }
        const component = this.clientReferenceComponent(reference, gate);
        chunk.arrived = true;
        this.fulfillChunk(chunk, component);
        return;
      }
      case "error": {
        const chunk = this.getChunk(row.id);
        chunk.arrived = true;
        // Reveal-gating a failure is pointless; drop any gates aimed here.
        this.rowGates.delete(row.id);
        this.rejectChunk(chunk, errorFromPayloadValue(row.value));
        return;
      }
      case "data": {
        const hydrate = this.options.hydrate;
        if (hydrate === undefined) return;
        hydrate(decodePayloadDataEntries(row.value));
        return;
      }
      case "assets": {
        const gate = this.prepareAssets(row.value);
        if (gate === null || row.for === undefined) return;
        const gates = this.rowGates.get(row.for);
        if (gates === undefined) this.rowGates.set(row.for, [gate]);
        else gates.push(gate);
        return;
      }
    }
  }

  // Never rejects and never blocks content on a failed asset: a rejected
  // prepareAssets result (or synchronous throw) settles the gate.
  private prepareAssets(
    serialized: readonly SerializedAssetResource[] | undefined,
  ): Promise<void> | null {
    const prepare = this.options.prepareAssets;
    if (prepare === undefined || serialized === undefined) return null;
    const assets = serialized.filter(isFigAssetResource);
    if (assets.length === 0) return null;

    let result: void | PromiseLike<void>;
    try {
      result = prepare(assets);
    } catch {
      return null;
    }
    if (!isThenable(result)) return null;
    const gate = Promise.resolve(result).then(noop, noop);
    trackThenable(gate);
    return gate;
  }

  private clientReferenceComponent(
    reference: PayloadClientReference,
    gate: Promise<void> | null,
  ): ElementType<any> {
    const cache = this.options.clientReferenceCache;
    const entries =
      cache === undefined ? undefined : clientReferenceCacheEntries.get(cache);
    const existing = entries?.get(reference.id);
    if (existing !== undefined) return existing;

    let resolved: ReturnType<ResolveClientReference>;
    try {
      resolved = this.options.resolveClientReference?.(reference);
    } catch (error) {
      resolved = Promise.reject(error);
    }

    if (resolved === undefined) {
      // Never cached: a decode configured without a resolver must not
      // poison a shared cache for later, properly configured decodes.
      return function PayloadUnresolvedClientComponent(): never {
        throw new Error(
          `Cannot render client reference "${reference.id}" because decodePayloadStream was not configured with a matching resolveClientReference.`,
        );
      };
    }

    // Without a cache, an ungated synchronously resolved reference decodes
    // to the component itself, so its element type is stable across decodes
    // whenever the resolver's answer is — re-decoding updates the client
    // component in place and its state survives.
    if (entries === undefined && gate === null && !isThenable(resolved)) {
      return resolved;
    }

    const component = clientReferenceWrapper(resolved, reference.id);
    entries?.set(reference.id, component);
    return component;
  }

  private getChunk(id: number): DecodeChunk {
    const existing = this.chunks.get(id);
    if (existing !== undefined) return existing;

    const chunk: DecodeChunk = {
      arrived: false,
      promise: null,
      reject: null,
      resolve: null,
      status: "pending",
      value: undefined,
    };
    this.chunks.set(id, chunk);
    return chunk;
  }

  // Materializes (and registers with the thenable registry) on first access:
  // a settled chunk becomes an already-settled promise, a pending one gets
  // live resolvers that fulfillChunk/rejectChunk drive.
  private chunkPromise(chunk: DecodeChunk): Promise<unknown> {
    if (chunk.promise !== null) return chunk.promise;

    if (chunk.status === "fulfilled") {
      chunk.promise = Promise.resolve(chunk.value);
    } else if (chunk.status === "rejected") {
      chunk.promise = Promise.reject(chunk.value);
      // Holes nobody awaits must not become unhandled rejections; readers
      // still observe the stored error.
      void chunk.promise.catch(noop);
    } else {
      const settled = deferred<unknown>();
      chunk.promise = settled.promise;
      chunk.resolve = settled.resolve;
      chunk.reject = settled.reject;
    }
    trackThenable(chunk.promise);
    return chunk.promise;
  }

  private fulfillChunk(chunk: DecodeChunk, value: unknown): void {
    if (chunk.status !== "pending") return;
    chunk.status = "fulfilled";
    chunk.value = value;
    chunk.resolve?.(value);
  }

  private rejectChunk(chunk: DecodeChunk, error: unknown): void {
    if (chunk.status !== "pending") return;
    chunk.status = "rejected";
    chunk.value = error;
    if (chunk.reject !== null) {
      chunk.reject(error);
      void chunk.promise?.catch(noop);
    }
  }

  readChunkForRender(id: number): unknown {
    const chunk = this.getChunk(id);
    if (chunk.status === "rejected") throw chunk.value;
    if (chunk.status === "pending")
      return readPromise(this.chunkPromise(chunk));
    return chunk.value;
  }

  private decodeModel(model: PayloadModel): unknown {
    if (model === null) return null;
    if (Array.isArray(model)) return model.map(this.decodeChild);
    if (typeof model !== "object") return model;

    if (isPayloadSpecialModel(model)) return this.decodeSpecialModel(model);

    return decodePayloadRecord(
      model as Record<string, PayloadModel>,
      this.decodeChild,
    );
  }

  private decodeSpecialModel(
    model: PayloadElementModel | PayloadSpecialModel,
  ): unknown {
    switch (model.$fig) {
      case "element": {
        if (model.id !== undefined) {
          return this.defineObjectRef(
            model.id,
            () =>
              ({
                $$typeof: FigElementSymbol,
                key: model.key,
                props: {},
                type: Fragment,
              }) as FigElement,
            (element) => {
              (element as { type: ElementType<any> }).type =
                this.decodeElementType(model.type);
              const props = this.decodeModel(model.props) as Props;
              (element as { props: Props }).props = props;
              this.attachElementGate(model.type, props);
            },
          );
        }
        const type = this.decodeElementType(model.type);
        const props = this.decodeModel(model.props) as Props & {
          key?: Key | null;
        };
        if (model.key !== null) props.key = model.key;
        const element = createElement(type, props);
        // createElement copies props, so the gate keys the element's own
        // props object — the one the component will receive.
        this.attachElementGate(model.type, element.props);
        return element;
      }
      case "client": {
        const chunk = this.chunks.get(model.id);
        if (chunk === undefined || chunk.status !== "fulfilled") {
          throw new Error(
            `Payload model referenced client row ${model.id} before it arrived.`,
          );
        }
        return chunk.value;
      }
      case "fragment":
        return Fragment;
      case "lazy":
        // Materialize the hole's chunk now: abort and truncation reject
        // every unresolved chunk, which must include holes that decoded but
        // were never read.
        this.getChunk(model.id);
        return createElement(PayloadStreamHole, { decode: this, id: model.id });
      case "promise":
        // Promise props are handed straight to consumers, so the promise
        // (and its thenable-registry tracking) materializes here.
        return this.chunkPromise(this.getChunk(model.id));
      case "suspense":
        return Suspense;
      case "view-transition":
        return ViewTransition;
      default:
        // Every remaining tag is an ordinary value tag; the shared codec
        // decoder handles it against this decode's request-wide ref store.
        return decodePayloadValueTag(
          model as PayloadValueSpecialModel,
          this.valueRefs,
          this.decodeChild,
        );
    }
  }

  private decodeElementType(
    type: string | PayloadSpecialModel,
  ): ElementType<any> {
    if (typeof type === "string") return type;
    return this.decodeSpecialModel(type) as ElementType<any>;
  }

  // A client-referencing element inherits its decode's unsettled row gate;
  // the reference wrapper reads it per element instance at render.
  private attachElementGate(
    typeModel: string | PayloadSpecialModel,
    props: Props,
  ): void {
    if (typeof typeModel === "string" || typeModel.$fig !== "client") return;
    const gate = this.clientRowGates.get(typeModel.id);
    if (gate !== undefined) elementGates.set(props, gate);
  }

  private defineObjectRef<T>(
    id: number,
    create: () => T,
    fill: (value: T) => void,
  ): T {
    if (this.objectRefs.has(id)) return this.objectRefs.get(id) as T;

    const value = create();
    this.objectRefs.set(id, value);
    try {
      fill(value);
      return value;
    } catch (error) {
      this.objectRefs.delete(id);
      throw error;
    }
  }
}

function PayloadStreamHole(props: {
  decode: PayloadStreamDecode;
  id: number;
}): FigNode {
  return props.decode.readChunkForRender(props.id) as FigNode;
}

// The one client-reference wrapper: reads the per-element reveal gate
// (elementGates), resolves the component, renders it. Cached in a
// clientReferenceCache it is reused across decodes, so island identity
// survives re-decodes whether a given decode arrives gated or not; without
// a cache it lives for a single decode. Asynchronous resolution starts at
// row arrival — overlapping the rest of the stream instead of serializing
// behind it — and latches its type; thenable tracking lets a resolution
// settled before its first render read synchronously instead of suspending
// for a retry beat.
function clientReferenceWrapper(
  resolved: ElementType<any> | PromiseLike<ElementType<any>>,
  referenceId: string,
): ElementType<any> {
  if (!isThenable(resolved)) {
    return function PayloadClientComponent(props: Props): FigNode {
      readElementGate(props);
      return createElement(resolved, props);
    };
  }

  const pending = Promise.resolve(resolved);
  trackThenable(pending);
  let type: ElementType<any> | null = null;
  return function PayloadClientComponent(props: Props): FigNode {
    readElementGate(props);
    if (type === null) {
      type = clientReferenceType(readPromise(pending), referenceId);
    }
    return createElement(type, props);
  };
}

function clientReferenceType(value: unknown, id: string): ElementType<any> {
  if (typeof value === "function") return value as ElementType<any>;
  throw new Error(`Client reference "${id}" did not resolve to a component.`);
}
