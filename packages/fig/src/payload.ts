/**
 * Client-side decoding and reference types for Fig's server-component payload.
 *
 * @module
 */
import type { FigDataHydrationEntry } from "./data.ts";
import {
  type AwaitedFigNode,
  createElement,
  type ElementType,
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
  createPayloadClientReferenceResolver,
  type PayloadClientReference,
  type PayloadClientReferenceResolver,
  PayloadClientReferences,
  type ResolveClientReference,
} from "./payload-client-reference.ts";
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
  type SerializedAssetResource,
} from "./payload-format.ts";
import {
  assetResourceDestination,
  assets as attachAssets,
  type FigAssetResource,
  isFigAssetResource,
} from "./resource.ts";
import { isThenable, trackThenable } from "./thenables.ts";

export {
  createPayloadClientReferenceResolver,
  type PayloadClientReference,
  type PayloadClientReferenceResolver,
  type ResolveClientReference,
};

/** Describes payload decode completion. */
export type PayloadDecodeCompletion =
  | { status: "aborted" }
  | { status: "complete" }
  | { status: "failed"; error: unknown };

/** Describes payload decode options. */
export interface PayloadDecodeOptions {
  /**
   * Receives decoded `data` rows for hydration into a data store. The
   * capability itself is expected to be generation-guarded and to ignore
   * entries after its caller loses authority.
   */
  hydrate?: (entries: readonly FigDataHydrationEntry[]) => void;
  /**
   * Observes every outlined hole rejection — an `error` row or a stream
   * failure stranding referenced rows, before or after the root fulfills.
   * Abort cancellation is excluded. Called once per rejected hole; the
   * observer is never awaited and cannot break decoding.
   */
  onHoleError?: (error: unknown) => unknown;
  /**
   * Observes the end of ingestion: called exactly once when the stream
   * settles as complete, failed, or aborted. Post-root failures reject the
   * holes they strand, but a failure with no pending slot is otherwise
   * invisible — this is the hook for reporting it. The callback is never
   * awaited, and its exceptions and rejections are swallowed, so an
   * observer cannot block or break decode teardown.
   */
  onStreamDone?: (result: PayloadDecodeCompletion) => unknown;
  /**
   * Called with delivery asset resources as soon as their rows arrive
   * (e.g. fig-dom's insertAssetResources). A returned promise gates the
   * reveal of only the content that declared a dependency on those assets;
   * gate settlement — fulfilled or rejected — releases the reveal, so a
   * failed asset never blocks content.
   */
  prepareAssets?: (
    assets: readonly FigAssetResource[],
  ) => void | PromiseLike<void>;
  /**
   * Retains delivery asset dependencies as `assets(...)` declarations on
   * their decoded owners. Document metadata is always retained because its
   * owner may mutate the document only when it commits. Server document
   * renderers enable this option to retain delivery assets too.
   */
  retainAssets?: boolean;
  /**
   * Resolves client-reference rows to components. A plain function keeps
   * identity per decode: gated and asynchronously resolved references decode
   * to per-decode wrappers and remount on re-decode. A stateful resolver
   * (created by `createPayloadClientReferenceResolver`) keeps every
   * resolvable reference's identity stable across the decodes sharing it.
   */
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
): Promise<AwaitedFigNode> {
  return new PayloadDecoder(stream, options).value;
}

type DecodeChunk = {
  // The chunk's row has been ingested (decoded or rejected); reveal may still
  // be waiting on an asset gate. Truncation and abort reject only chunks
  // whose rows never arrived.
  arrived: boolean;
  // Materialized lazily: most rows settle synchronously at arrival and are
  // only ever read through result, so eagerly allocating a promise and
  // its controls per row would be waste.
  promise: Promise<unknown> | null;
  reject: ((reason: unknown) => void) | null;
  resolve: ((value: unknown) => void) | null;
  result:
    | { status: "pending" }
    | { status: "fulfilled"; value: unknown }
    | { status: "rejected"; error: unknown };
};

type DecodingElement = {
  $$typeof: symbol;
  key: Key | null;
  props: Props;
  type: ElementType<any>;
};

const noop = (): void => undefined;

function notifyObserver<T>(
  observer: ((value: T) => unknown) | undefined,
  value: T,
): void {
  try {
    const result = observer?.(value);
    if (isThenable(result)) void Promise.resolve(result).then(noop, noop);
  } catch {
    // Observers cannot break decode teardown or create unhandled rejections.
  }
}

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

function decodeAssetResources(
  serialized: readonly SerializedAssetResource[] | undefined,
): FigAssetResource[] | null {
  if (serialized === undefined) return null;
  const assets = serialized.filter(isFigAssetResource);
  return assets.length === 0 ? null : assets;
}

class PayloadDecoder {
  readonly value: Promise<AwaitedFigNode>;

  private readonly chunks = new Map<number, DecodeChunk>();
  private readonly objectRefs = new Map<number, unknown>();
  // Asset gates registered for a row id (assets rows carry `for`); consumed
  // when that row arrives.
  private readonly rowGates = new Map<number, Array<PromiseLike<void>>>();
  private readonly rowAssets = new Map<number, FigAssetResource[]>();
  private readonly clientReferences: PayloadClientReferences;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private done = false;
  // Resolved on abort so arrived-but-gated chunks reveal instead of waiting
  // for asset gates that may never settle.
  private readonly gateRelease = deferred<void>();
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
    this.clientReferences = new PayloadClientReferences(
      options.resolveClientReference,
    );
    const rowDecoder = jsonPayloadCodec.createDecoder((row) =>
      this.handleRow(row),
    );
    this.value = this.chunkPromise(this.getChunk(0)) as Promise<AwaitedFigNode>;

    void this.ingest(stream, rowDecoder);

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
    this.gateRelease.resolve(undefined);
    void this.reader?.cancel(error).catch(noop);
    this.rejectUnresolved(error);
    this.settle({ status: "aborted" });
  }

  private async ingest(
    stream: ReadableStream<Uint8Array>,
    rowDecoder: PayloadRowDecoder,
  ): Promise<void> {
    const reader = stream.getReader();
    this.reader = reader;

    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (this.done) return;
        if (done) break;
        rowDecoder.decode(value);
      }
      rowDecoder.flush();
      this.finishIngestion();
    } catch (error) {
      if (this.done) return;
      void reader.cancel(error).catch(noop);
      this.failIngestion(error);
    }
  }

  private finishIngestion(): void {
    for (const chunk of this.chunks.values()) {
      if (!chunk.arrived) {
        // The server closes the stream only after every outlined row has
        // been written, so any unresolved reference is truncation.
        this.failIngestion(
          new Error("Payload stream ended before all referenced rows arrived."),
        );
        return;
      }
    }
    this.settle({ status: "complete" });
  }

  private failIngestion(error: unknown): void {
    if (this.done) return;
    this.rejectUnresolved(error);
    this.settle({ status: "failed", error });
  }

  private rejectUnresolved(error: unknown): void {
    for (const [id, chunk] of this.chunks) {
      if (chunk.arrived) continue;
      chunk.arrived = true;
      this.rejectChunk(id, chunk, error);
    }
  }

  private settle(result: PayloadDecodeCompletion): void {
    if (this.done) return;
    this.done = true;
    this.removeAbortListener();
    notifyObserver(this.options.onStreamDone, result);
  }

  private handleRow(row: PayloadRow): void {
    if (this.done) return;

    switch (row.tag) {
      case "model": {
        const chunk = this.getChunk(row.id);
        let decoded = this.decodeModel(row.value);
        const retainedAssets = this.rowAssets.get(row.id);
        if (retainedAssets !== undefined) {
          this.rowAssets.delete(row.id);
          decoded = attachAssets(retainedAssets, decoded as FigNode);
        }
        chunk.arrived = true;
        const gates = this.rowGates.get(row.id);
        if (gates === undefined) {
          this.fulfillChunk(chunk, decoded);
          return;
        }
        this.rowGates.delete(row.id);
        void Promise.race([Promise.all(gates), this.gateRelease.promise]).then(
          () => this.fulfillChunk(chunk, decoded),
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
        const assets = decodeAssetResources(row.value.assets);
        if (assets !== null) {
          reference.assets = assets;
        }
        const retainedAssets = this.retainedAssets(assets);
        const gate = this.prepareAssets(assets);
        const component = this.clientReferences.register(
          row.id,
          reference,
          gate,
          retainedAssets,
        );
        chunk.arrived = true;
        this.fulfillChunk(chunk, component);
        return;
      }
      case "error": {
        const chunk = this.getChunk(row.id);
        chunk.arrived = true;
        // Reveal-gating a failure is pointless; drop any gates aimed here.
        this.rowGates.delete(row.id);
        this.rowAssets.delete(row.id);
        this.rejectChunk(row.id, chunk, errorFromPayloadValue(row.value));
        return;
      }
      case "data": {
        const hydrate = this.options.hydrate;
        if (hydrate === undefined) return;
        hydrate(decodePayloadDataEntries(row.value));
        return;
      }
      case "assets": {
        const decodedAssets = decodeAssetResources(row.value);
        const retainedAssets = this.retainedAssets(decodedAssets);
        if (retainedAssets !== null && row.for !== undefined) {
          const retained = this.rowAssets.get(row.for);
          if (retained === undefined)
            this.rowAssets.set(row.for, retainedAssets);
          else retained.push(...retainedAssets);
        }
        const gate = this.prepareAssets(decodedAssets);
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
    assets: readonly FigAssetResource[] | null,
  ): Promise<void> | null {
    const prepare = this.options.prepareAssets;
    if (prepare === undefined || assets === null) return null;
    const delivery = assets.filter(
      (resource) => assetResourceDestination(resource) === "stream",
    );
    if (delivery.length === 0) return null;

    let result: void | PromiseLike<void>;
    try {
      result = prepare(delivery);
    } catch {
      return null;
    }
    if (!isThenable(result)) return null;
    const gate = Promise.resolve(result).then(noop, noop);
    trackThenable(gate);
    return gate;
  }

  private retainedAssets(
    assets: FigAssetResource[] | null,
  ): FigAssetResource[] | null {
    if (assets === null) return null;
    const retained =
      this.options.retainAssets === true
        ? assets
        : assets.filter(
            (resource) => assetResourceDestination(resource) === "head",
          );
    return retained.length === 0 ? null : retained;
  }

  private getChunk(id: number): DecodeChunk {
    const existing = this.chunks.get(id);
    if (existing !== undefined) return existing;

    const chunk: DecodeChunk = {
      arrived: false,
      promise: null,
      reject: null,
      resolve: null,
      result: { status: "pending" },
    };
    this.chunks.set(id, chunk);
    return chunk;
  }

  // Materializes (and registers with the thenable registry) on first access:
  // a settled chunk becomes an already-settled promise, a pending one gets
  // live resolvers that fulfillChunk/rejectChunk drive.
  private chunkPromise(chunk: DecodeChunk): Promise<unknown> {
    if (chunk.promise !== null) return chunk.promise;

    if (chunk.result.status === "fulfilled") {
      chunk.promise = Promise.resolve(chunk.result.value);
    } else if (chunk.result.status === "rejected") {
      chunk.promise = Promise.reject(chunk.result.error);
      // Holes nobody awaits must not become unhandled rejections; readers
      // still observe the stored error.
      void chunk.promise.catch(noop);
    } else {
      chunk.promise = new Promise((resolve, reject) => {
        chunk.resolve = resolve;
        chunk.reject = reject;
      });
    }
    trackThenable(chunk.promise);
    return chunk.promise;
  }

  private fulfillChunk(chunk: DecodeChunk, value: unknown): void {
    if (chunk.result.status !== "pending") return;
    chunk.result = { status: "fulfilled", value };
    chunk.resolve?.(value);
    chunk.resolve = null;
    chunk.reject = null;
  }

  private rejectChunk(id: number, chunk: DecodeChunk, error: unknown): void {
    if (chunk.result.status !== "pending") return;
    chunk.result = { error, status: "rejected" };
    if (chunk.reject !== null) {
      chunk.reject(error);
      void chunk.promise?.catch(noop);
    }
    chunk.resolve = null;
    chunk.reject = null;
    if (id !== 0 && !(error instanceof PayloadDecodeAbortedError)) {
      notifyObserver(this.options.onHoleError, error);
    }
  }

  readChunkForRender(id: number): unknown {
    const chunk = this.getChunk(id);
    if (chunk.result.status === "rejected") throw chunk.result.error;
    if (chunk.result.status === "pending")
      return readPromise(this.chunkPromise(chunk));
    return chunk.result.value;
  }

  private decodeModel(model: PayloadModel): unknown {
    if (model === null) return null;
    if (Array.isArray(model)) return model.map(this.decodeChild);
    if (typeof model !== "object") return model;

    if (isPayloadSpecialModel(model)) return this.decodeSpecialModel(model);

    return decodePayloadRecord(model, this.decodeChild);
  }

  private decodeSpecialModel(
    model: PayloadElementModel | PayloadSpecialModel,
  ): unknown {
    switch (model.$fig) {
      case "element": {
        if (model.id !== undefined) {
          return this.defineObjectRef(
            model.id,
            (): DecodingElement => ({
              $$typeof: FigElementSymbol,
              key: model.key,
              props: {},
              type: Fragment,
            }),
            (element) => {
              element.type = this.decodeElementType(model.type);
              const props = this.decodeModel(model.props) as Props;
              element.props = props;
              this.attachElementDelivery(model.type, props);
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
        this.attachElementDelivery(model.type, element.props);
        return element;
      }
      case "client": {
        const chunk = this.chunks.get(model.id);
        if (chunk === undefined || chunk.result.status !== "fulfilled") {
          throw new Error(
            `Payload model referenced client row ${model.id} before it arrived.`,
          );
        }
        return chunk.result.value;
      }
      case "fragment":
        return Fragment;
      case "lazy":
        // Materialize the hole's chunk now: abort and truncation reject
        // every unresolved chunk, which must include holes that decoded but
        // were never read.
        this.getChunk(model.id);
        return createElement(PayloadHole, { decode: this, id: model.id });
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
        return decodePayloadValueTag(model, this.valueRefs, this.decodeChild);
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
  private attachElementDelivery(
    typeModel: string | PayloadSpecialModel,
    props: Props,
  ): void {
    if (typeof typeModel === "string" || typeModel.$fig !== "client") return;
    this.clientReferences.attach(typeModel.id, props);
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

function PayloadHole(props: { decode: PayloadDecoder; id: number }): FigNode {
  return props.decode.readChunkForRender(props.id) as FigNode;
}
