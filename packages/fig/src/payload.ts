import type { FigDataHydrationEntry } from "./data.ts";
import {
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
  assets as attachAssets,
  type FigAssetResource,
  isFigAssetResource,
} from "./resource.ts";
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
 * A caller-owned stateful resolver: a `ResolveClientReference` that also
 * owns component identity. Decodes given one (as `resolveClientReference`)
 * resolve every client reference to a single resolver-owned wrapper per
 * reference id, so re-decoding a payload updates islands in place instead
 * of remounting them. The caller owns the lifetime: drop entries when their
 * modules change (HMR) or the manifest swaps.
 */
export interface PayloadClientReferenceResolver {
  (
    reference: PayloadClientReference,
  ): ElementType<any> | PromiseLike<ElementType<any>> | undefined;
  clear(): void;
  delete(id: string): boolean;
}

const resolverEntries = new WeakMap<
  ResolveClientReference,
  Map<string, ElementType<any>>
>();

export function createPayloadClientReferenceResolver(
  resolve: ResolveClientReference,
): PayloadClientReferenceResolver {
  const entries = new Map<string, ElementType<any>>();
  const resolver = Object.assign(
    (reference: PayloadClientReference) => resolve(reference),
    {
      clear: (): void => entries.clear(),
      delete: (id: string): boolean => entries.delete(id),
    },
  );
  resolverEntries.set(resolver, entries);
  return resolver;
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
const elementAssets = new WeakMap<Props, readonly FigAssetResource[]>();

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
   * Called with stream-safe asset resources as soon as their rows arrive
   * (e.g. fig-dom's insertAssetResources). A returned promise gates the
   * reveal of only the content that declared a dependency on those assets;
   * gate settlement — fulfilled or rejected — releases the reveal, so a
   * failed asset never blocks content.
   */
  prepareAssets?: (
    assets: readonly FigAssetResource[],
  ) => void | PromiseLike<void>;
  /**
   * Retains streamed asset dependencies as `assets(...)` declarations on
   * their decoded owners. Server document renderers use this to deliver each
   * asset before the segment that needs it; browser decoders normally leave
   * this off and prepare assets imperatively instead.
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
): Promise<FigNode> {
  return new PayloadStreamDecode(stream, options).value;
}

type DecodeChunk = {
  // The chunk's row has been ingested (decoded or rejected); reveal may still
  // be waiting on an asset gate. Truncation and abort reject only chunks
  // whose rows never arrived.
  arrived: boolean;
  // Materialized lazily: most rows settle synchronously at arrival and are
  // only ever read through result, so eagerly allocating a promise and
  // its controls per row would be waste.
  deferred: Deferred<unknown> | null;
  id: number;
  promise: Promise<unknown> | null;
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

class PayloadStreamDecode {
  readonly value: Promise<FigNode>;

  private readonly chunks = new Map<number, DecodeChunk>();
  private readonly objectRefs = new Map<number, unknown>();
  // Asset gates registered for a row id (assets rows carry `for`); consumed
  // when that row arrives.
  private readonly rowGates = new Map<number, Array<PromiseLike<void>>>();
  private readonly rowAssets: Map<number, readonly FigAssetResource[]> | null;
  // Unsettled reveal gates for arrived client rows, attached per element as
  // models referencing the row materialize (see elementGates).
  private readonly clientRowGates = new Map<number, Promise<void>>();
  private readonly clientRowAssets: Map<
    number,
    readonly FigAssetResource[]
  > | null;
  private readonly rowDecoder: PayloadRowDecoder;
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
    this.rowAssets = options.retainAssets === true ? new Map() : null;
    this.clientRowAssets = options.retainAssets === true ? new Map() : null;
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
    this.gateRelease.resolve(undefined);
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
      const observed = this.options.onStreamDone?.(result);
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
        let decoded = this.decodeModel(row.value);
        const retainedAssets = this.rowAssets?.get(row.id);
        if (retainedAssets !== undefined) {
          this.rowAssets?.delete(row.id);
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
          this.clientRowAssets?.set(row.id, assets);
        }
        const gate = this.prepareAssets(assets);
        if (gate !== null) {
          // Elements referencing this row inherit the gate as they
          // materialize; once it settles there is nothing left to gate.
          // Track it now so a gate that settles before its first render
          // read (e.g. awaited by a router's pre-commit prepare) resolves
          // synchronously instead of suspending for a retry beat.
          trackThenable(gate);
          this.clientRowGates.set(row.id, gate);
          void gate.then(() => {
            this.clientRowGates.delete(row.id);
          });
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
        const decodedAssets = decodeAssetResources(row.value);
        if (
          decodedAssets !== null &&
          row.for !== undefined &&
          this.rowAssets !== null
        ) {
          const retained = this.rowAssets.get(row.for);
          this.rowAssets.set(
            row.for,
            retained === undefined
              ? decodedAssets
              : [...retained, ...decodedAssets],
          );
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
    const resolve = this.options.resolveClientReference;
    const entries =
      resolve === undefined ? undefined : resolverEntries.get(resolve);
    const existing = entries?.get(reference.id);
    if (existing !== undefined) return existing;

    let resolved: ReturnType<ResolveClientReference>;
    try {
      resolved = resolve?.(reference);
    } catch (error) {
      resolved = Promise.reject(error);
    }

    if (resolved === undefined) {
      // Never cached: a stateful resolver that cannot resolve this
      // reference must not latch the error component for later decodes
      // that can.
      return function PayloadUnresolvedClientComponent(): never {
        throw new Error(
          `Cannot render client reference "${reference.id}" because decodePayloadStream was not configured with a matching resolveClientReference.`,
        );
      };
    }

    // Without a stateful resolver, an ungated synchronously resolved
    // reference decodes to the component itself, so its element type is
    // stable across decodes whenever the resolver's answer is — re-decoding
    // updates the client component in place and its state survives.
    if (
      entries === undefined &&
      gate === null &&
      !isThenable(resolved) &&
      (this.clientRowAssets === null || reference.assets === undefined)
    ) {
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
      deferred: null,
      id,
      promise: null,
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
      chunk.deferred = deferred<unknown>();
      chunk.promise = chunk.deferred.promise;
    }
    trackThenable(chunk.promise);
    return chunk.promise;
  }

  private fulfillChunk(chunk: DecodeChunk, value: unknown): void {
    if (chunk.result.status !== "pending") return;
    chunk.result = { status: "fulfilled", value };
    chunk.deferred?.resolve(value);
  }

  private rejectChunk(chunk: DecodeChunk, error: unknown): void {
    if (chunk.result.status !== "pending") return;
    chunk.result = { error, status: "rejected" };
    if (chunk.deferred !== null) {
      chunk.deferred.reject(error);
      void chunk.promise?.catch(noop);
    }
    if (chunk.id !== 0 && !(error instanceof PayloadDecodeAbortedError)) {
      this.observeHoleError(error);
    }
  }

  private observeHoleError(error: unknown): void {
    try {
      const observed = this.options.onHoleError?.(error);
      if (isThenable(observed)) void Promise.resolve(observed).then(noop, noop);
    } catch {
      // Error attribution/reporting is observational and cannot break decode.
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
    const gate = this.clientRowGates.get(typeModel.id);
    if (gate !== undefined) elementGates.set(props, gate);
    const assets = this.clientRowAssets?.get(typeModel.id);
    if (assets !== undefined) elementAssets.set(props, assets);
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
// (elementGates), resolves the component, renders it. Owned by a stateful
// resolver it is reused across decodes, so island identity survives
// re-decodes whether a given decode arrives gated or not; otherwise it
// lives for a single decode. Asynchronous resolution starts at
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
      return attachElementAssets(props, createElement(resolved, props));
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
    return attachElementAssets(props, createElement(type, props));
  };
}

function attachElementAssets(props: Props, node: FigNode): FigNode {
  const resources = elementAssets.get(props);
  return resources === undefined ? node : attachAssets(resources, node);
}

function clientReferenceType(value: unknown, id: string): ElementType<any> {
  if (typeof value === "function") return value as ElementType<any>;
  throw new Error(`Client reference "${id}" did not resolve to a component.`);
}
