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
  type PayloadClientReferenceMetadata,
  type PayloadCodec,
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

// The payload subpath's public format surface. decodePayloadStream below is
// the renderer-neutral client half; the server half (renderToPayloadStream)
// lives in @bgub/fig-server/payload. Browser code never imports fig-server.
export {
  assertPayloadCodecMatches,
  decodePayloadDataEntries,
  decodePayloadValue,
  encodePayloadDataEntries,
  encodePayloadValue,
  errorFromPayloadValue,
  jsonPayloadCodec,
  payloadCodecIdFromContentType,
  type PayloadClientReferenceMetadata,
  type PayloadCodec,
  type PayloadDataHydrationEntry,
  type PayloadElementModel,
  type PayloadErrorValue,
  type PayloadModel,
  type PayloadRow,
  type PayloadRowDecoder,
  type PayloadSpecialModel,
  type SerializedAssetResource,
} from "./payload-format.ts";

export type LoadClientReference = (
  metadata: PayloadClientReferenceMetadata,
) => PromiseLike<unknown>;

export type ResolveClientReference = (
  metadata: PayloadClientReferenceMetadata,
) => ElementType<any> | undefined;

export type PayloadDecodeCompletion =
  | { status: "aborted" }
  | { status: "complete" }
  | { status: "failed"; error: unknown };

/**
 * A live payload decode. `value` resolves when the root row decodes (and
 * rejects only when the stream fails before producing a root value);
 * decoding continues in the background, filling outlined holes as their rows
 * arrive. `completion` never rejects, so post-root transport and protocol
 * failures are observable without creating an unhandled rejection.
 *
 * Deliberately not a thenable: assimilating it into a promise chain would
 * discard `completion` and `abort`.
 */
export interface PayloadDecode {
  abort(reason?: unknown): void;
  readonly completion: Promise<PayloadDecodeCompletion>;
  readonly value: Promise<FigNode>;
}

export interface PayloadDecodeOptions {
  codec?: PayloadCodec;
  /**
   * Receives decoded `data` rows for hydration into a data store. The
   * capability itself is expected to be generation-guarded: it hydrates only
   * while its caller is authoritative and returns false after supersession.
   */
  hydrate?: (entries: FigDataHydrationEntry[]) => boolean;
  loadClientReference?: LoadClientReference;
  /**
   * Observes every client-reference row as it arrives (metadata plus its
   * declared assets), before the referencing content decodes. Frameworks use
   * it to track which modules a stream depends on (e.g. SSR module
   * bootstrapping); it does not affect resolution.
   */
  onClientReference?: (reference: {
    assets?: readonly FigAssetResource[];
    exportName?: string;
    id: string;
    ssr?: boolean;
  }) => void;
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
 * True for the internal abort reason unresolved holes reject with when a
 * decode is aborted or superseded — frameworks treat it as cancellation, not
 * a user error.
 */
export function isPayloadDecodeAborted(error: unknown): boolean {
  return (
    error instanceof PayloadDecodeAbortedError ||
    (typeof DOMException !== "undefined" &&
      error instanceof DOMException &&
      error.name === "AbortError")
  );
}

/**
 * Decode a payload row stream into a live PayloadDecode. The returned
 * `value` resolves with the decoded root FigNode; unfinished subtrees inside
 * it are outlined holes that suspend and fill (or reject) as their rows
 * arrive. Aborting `signal` or calling `abort` ignores remaining rows and
 * rejects unresolved holes with an internal abort reason
 * (isPayloadDecodeAborted).
 */
export function decodePayloadStream(
  stream: ReadableStream<Uint8Array>,
  options: PayloadDecodeOptions = {},
): PayloadDecode {
  const decode = new PayloadStreamDecode(stream, options);
  return {
    abort: (reason?: unknown) => decode.abort(reason),
    completion: decode.completion,
    value: decode.value,
  };
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
  readonly completion: Promise<PayloadDecodeCompletion>;
  readonly value: Promise<FigNode>;

  private readonly chunks = new Map<number, DecodeChunk>();
  private readonly objectRefs = new Map<number, unknown>();
  // Asset gates registered for a row id (assets rows carry `for`); consumed
  // when that row arrives.
  private readonly rowGates = new Map<number, Array<PromiseLike<void>>>();
  private readonly rowDecoder: PayloadRowDecoder;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private done = false;
  private readonly resolveCompletion: (
    completion: PayloadDecodeCompletion,
  ) => void;
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
    const completion = deferred<PayloadDecodeCompletion>();
    this.completion = completion.promise;
    this.resolveCompletion = completion.resolve;
    const gates = deferred<void>();
    this.gatesReleased = gates.promise;
    this.releaseGates = () => gates.resolve(undefined);
    this.rowDecoder = (options.codec ?? jsonPayloadCodec).createDecoder((row) =>
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

  private settle(completion: PayloadDecodeCompletion): void {
    if (this.done) return;
    this.done = true;
    this.removeAbortListener();
    this.resolveCompletion(completion);
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
        const metadata: PayloadClientReferenceMetadata = { id: row.value.id };
        if (row.value.exportName !== undefined) {
          metadata.exportName = row.value.exportName;
        }
        if (row.value.ssr === true) metadata.ssr = true;
        this.observeClientReference(metadata, row.value.assets);
        const gate = this.prepareAssets(row.value.assets);
        const component = this.clientReferenceComponent(metadata, gate);
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
        // The capability is generation-guarded by its supplier; a false
        // return means authority was lost and the entries were rejected.
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

  private observeClientReference(
    metadata: PayloadClientReferenceMetadata,
    serializedAssets: readonly SerializedAssetResource[] | undefined,
  ): void {
    const observe = this.options.onClientReference;
    if (observe === undefined) return;
    const reference: Parameters<
      NonNullable<PayloadDecodeOptions["onClientReference"]>
    >[0] = { ...metadata };
    const assets = serializedAssets?.filter(isFigAssetResource);
    if (assets !== undefined && assets.length > 0) reference.assets = assets;
    observe(reference);
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
    metadata: PayloadClientReferenceMetadata,
    gate: Promise<void> | null,
  ): ElementType<any> {
    const resolved = this.options.resolveClientReference?.(metadata);
    if (resolved !== undefined) {
      // Ungated references decode to the resolved component itself, so the
      // element type is stable across decodes and re-decoding a surrounding
      // payload (e.g. a refresh) updates the component instead of
      // remounting it — client state inside survives.
      if (gate === null) return resolved;
      return function PayloadResolvedClientComponent(props: Props): FigNode {
        readPromise(gate);
        return createElement(resolved, props);
      };
    }

    const load = this.options.loadClientReference;
    if (load !== undefined) {
      // Start the module import as soon as the reference row arrives so it
      // overlaps the rest of the stream instead of serializing behind it;
      // tracking lets a module settled before its first render read resolve
      // synchronously instead of suspending for a retry beat.
      const module = Promise.resolve(load(metadata));
      trackThenable(module);
      let type: ElementType<any> | null = null;
      return function PayloadClientComponent(props: Props): FigNode {
        if (gate !== null) readPromise(gate);
        if (type === null) {
          type = resolveClientReferenceExport(readPromise(module), metadata);
        }
        return createElement(type, props);
      };
    }

    return function PayloadUnresolvedClientComponent(): never {
      throw new Error(
        `Cannot render client reference "${metadata.id}" because decodePayloadStream was not configured with loadClientReference or a matching resolveClientReference.`,
      );
    };
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
              (element as { props: Props }).props = this.decodeModel(
                model.props,
              ) as Props;
            },
          );
        }
        const type = this.decodeElementType(model.type);
        const props = this.decodeModel(model.props) as Props & {
          key?: Key | null;
        };
        if (model.key !== null) props.key = model.key;
        return createElement(type, props);
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

export function resolveClientReferenceExport(
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
