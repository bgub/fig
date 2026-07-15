import type { FigDataHydrationEntry } from "./data.ts";
import type { Key } from "./element.ts";
import type {
  FontResource,
  ModulePreloadResource,
  PreconnectResource,
  PreloadResource,
  ScriptResource,
  StylesheetResource,
} from "./resource.ts";

// Asset descriptors discovered by payload rendering. Optional fields stay
// optional on the wire; omitted `undefined` values are part of the payload
// contract, not a serializer implementation detail.
export type SerializedAssetResource =
  | {
      crossorigin?: StylesheetResource["crossorigin"];
      href: string;
      kind: "stylesheet";
      media?: string;
      precedence?: string;
    }
  | {
      as: string;
      crossorigin?: PreloadResource["crossorigin"];
      fetchpriority?: PreloadResource["fetchpriority"];
      href: string;
      kind: "preload";
      type?: string;
    }
  | {
      crossorigin?: ModulePreloadResource["crossorigin"];
      fetchpriority?: ModulePreloadResource["fetchpriority"];
      href: string;
      kind: "modulepreload";
    }
  | {
      async?: boolean;
      crossorigin?: ScriptResource["crossorigin"];
      defer?: boolean;
      kind: "script";
      module?: boolean;
      src: string;
    }
  | {
      crossorigin?: FontResource["crossorigin"];
      fetchpriority?: FontResource["fetchpriority"];
      href: string;
      kind: "font";
      type: string;
    }
  | {
      crossorigin?: PreconnectResource["crossorigin"];
      href: string;
      kind: "preconnect";
    }
  | {
      kind: "title";
      value: string;
    }
  | {
      charset?: string;
      content?: string;
      "http-equiv"?: string;
      key?: string;
      kind: "meta";
      name?: string;
      property?: string;
    };

/** The `error` row value under the server's `onError` contract. */
export interface PayloadErrorValue {
  digest?: string;
  message?: string;
}

/**
 * Semantic payload row before the internal codec turns it into bytes.
 */
export type PayloadRow =
  | { for?: number; tag: "assets"; value: SerializedAssetResource[] }
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
  | { id: number; tag: "error"; value: PayloadErrorValue }
  | { id: number; tag: "model"; value: PayloadModel };

/**
 * Transport-safe model value used inside internal payload rows. This is an
 * implementation format, not an application data format.
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

export type PayloadElementModel = {
  $fig: "element";
  id?: number;
  key: Key | null;
  props: PayloadModel;
  type: string | PayloadSpecialModel;
};

export type PayloadSpecialModel =
  | { $fig: "array"; id: number; value: PayloadModel[] }
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

export type PayloadValueSpecialModel = Extract<
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
  createDecoder(onRow: (row: PayloadRow) => void): PayloadRowDecoder;
  encodeRow(row: PayloadRow): Uint8Array;
}

export interface PayloadRowDecoder {
  decode(chunk: Uint8Array): void;
  flush(): void;
}

const textEncoder = new TextEncoder();

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
): PayloadRowDecoder {
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

/**
 * Extract the codec id from a payload content-type header, or null when the
 * header carries no codec parameter.
 */
export function payloadCodecIdFromContentType(
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

/**
 * Throw when a response content-type declares a codec other than the one this
 * client decodes with. A missing header or codec parameter passes: transports
 * that strip content types stay usable, and mismatches still fail fast when
 * declared.
 */
export function assertPayloadCodecMatches(
  codec: PayloadCodec,
  contentTypeHeader: string | null,
): void {
  if (contentTypeHeader === null) return;
  const received = payloadCodecIdFromContentType(contentTypeHeader);
  if (received === null || received === codec.id) return;
  throw new Error(
    `Payload codec mismatch: producer used "${received}" but this client expects "${codec.id}".`,
  );
}

/** Decode an `error` row value into a digest-carrying Error. */
export function errorFromPayloadValue(value: PayloadErrorValue): Error & {
  digest?: string;
} {
  const error = new Error(
    value.message ?? "The server render failed.",
  ) as Error & { digest?: string };
  if (value.digest !== undefined) error.digest = value.digest;
  return error;
}

export interface PayloadGraphEncodeContext {
  // Ids are dense and monotonic: id = position in `defined` + 1, so rollback
  // is popping the stack. A reverse id→object map would be redundant state.
  defined: object[];
  ids: WeakMap<object, number>;
}

interface PayloadGraphDecodeContext {
  decodeChild: (model: PayloadModel) => unknown;
  refs: PayloadDecodeRefs;
}

function createPayloadGraphDecodeContext(): PayloadGraphDecodeContext {
  const refs = new Map<number, unknown>();
  const context: PayloadGraphDecodeContext = {
    decodeChild: (model) => decodeModelValue(model, context),
    refs: {
      define(id, create, fill) {
        const value = create();
        refs.set(id, value);
        fill(value);
        return value;
      },
      read(id) {
        if (!refs.has(id)) {
          throw new Error(`Payload referenced unknown object id ${id}.`);
        }
        return refs.get(id);
      },
    },
  };
  return context;
}

export function createPayloadGraphEncodeContext(): PayloadGraphEncodeContext {
  return { defined: [], ids: new WeakMap() };
}

export function isPlainPayloadValue(value: unknown): boolean {
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
  return encodePayloadValueWithGraph(value, createPayloadGraphEncodeContext());
}

export function encodePayloadValueWithGraph(
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
    return serializePayloadArray(
      value,
      graph,
      () => value,
      (item) => encodePayloadValueWithGraph(item, graph),
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
    return serializePayloadMap(value, graph, ([key, item]) => [
      encodePayloadValueWithGraph(key, graph),
      encodePayloadValueWithGraph(item, graph),
    ]);
  }
  if (value instanceof Set) {
    return serializePayloadSet(value, graph, (item) =>
      encodePayloadValueWithGraph(item, graph),
    );
  }

  if (typeof value === "object" && value !== null) {
    return serializePayloadPlainObject(value, graph, (child) =>
      encodePayloadValueWithGraph(child, graph),
    );
  }

  throw new Error(`Cannot serialize ${typeof value} into the payload.`);
}

export function serializePayloadMap(
  value: Map<unknown, unknown>,
  graph: PayloadGraphEncodeContext,
  encodeEntry: (entry: [unknown, unknown]) => [PayloadModel, PayloadModel],
): PayloadModel {
  const existing = payloadGraphReference(graph, value);
  if (existing !== null) return existing;
  const id = definePayloadGraphObject(graph, value);
  const entries: Array<[PayloadModel, PayloadModel]> = [];
  for (const entry of value) entries.push(encodeEntry(entry));
  return { $fig: "map", id, entries };
}

export function serializePayloadSet(
  value: Set<unknown>,
  graph: PayloadGraphEncodeContext,
  encodeItem: (value: unknown) => PayloadModel,
): PayloadModel {
  const existing = payloadGraphReference(graph, value);
  if (existing !== null) return existing;
  const id = definePayloadGraphObject(graph, value);
  const values: PayloadModel[] = [];
  for (const item of value) values.push(encodeItem(item));
  return { $fig: "set", id, values };
}

function payloadGraphReference(
  graph: PayloadGraphEncodeContext,
  value: object,
): PayloadSpecialModel | null {
  const id = graph.ids.get(value);
  return id === undefined ? null : { $fig: "ref", id };
}

function definePayloadGraphObject(
  graph: PayloadGraphEncodeContext,
  value: object,
): number {
  graph.defined.push(value);
  const id = graph.defined.length;
  graph.ids.set(value, id);
  return id;
}

export function checkpointPayloadGraph(
  graph: PayloadGraphEncodeContext,
): number {
  return graph.defined.length;
}

export function rollbackPayloadGraph(
  graph: PayloadGraphEncodeContext,
  checkpoint: number,
): void {
  while (graph.defined.length > checkpoint) {
    graph.ids.delete(graph.defined.pop() as object);
  }
}

export function definePayloadGraphElement(
  graph: PayloadGraphEncodeContext,
  value: object,
): number | PayloadSpecialModel {
  const existing = payloadGraphReference(graph, value);
  if (existing !== null) return existing;
  return definePayloadGraphObject(graph, value);
}

export function serializePayloadArray<T>(
  value: object,
  graph: PayloadGraphEncodeContext,
  entries: () => readonly T[],
  encodeChild: (value: T) => PayloadModel,
): PayloadModel {
  const existing = payloadGraphReference(graph, value);
  if (existing !== null) return existing;
  const id = definePayloadGraphObject(graph, value);
  return { $fig: "array", id, value: entries().map(encodeChild) };
}

export function serializePayloadPlainObject(
  value: object,
  graph: PayloadGraphEncodeContext,
  encodeChild: (value: unknown) => PayloadModel,
): PayloadModel {
  const existing = payloadGraphReference(graph, value);
  if (existing !== null) return existing;
  const id = definePayloadGraphObject(graph, value);
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
    return decodePayloadValueTag(model, graph.refs, graph.decodeChild);
  }

  return decodePayloadRecord(
    model as Record<string, PayloadModel>,
    graph.decodeChild,
  );
}

export function isPayloadValueSpecialModel(
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

// The ref-store seam shared by the two decode entry points: the value codec
// registers into a per-call refs map, while the stream decoder registers into
// its request-wide chunk-adjacent store (with rollback on failed fills).
export interface PayloadDecodeRefs {
  define<T>(id: number, create: () => T, fill: (value: T) => void): T;
  read(id: number): unknown;
}

export function decodePayloadValueTag(
  model: PayloadValueSpecialModel,
  refs: PayloadDecodeRefs,
  decodeChild: (model: PayloadModel) => unknown,
): unknown {
  switch (model.$fig) {
    case "array":
      return refs.define(
        model.id,
        () => [] as unknown[],
        (value) => {
          for (const item of model.value) value.push(decodeChild(item));
        },
      );
    case "bigint":
      return BigInt(model.value);
    case "date":
      return new Date(model.value);
    case "map":
      return refs.define(
        model.id,
        () => new Map(),
        (value) => {
          for (const [key, item] of model.entries) {
            value.set(decodeChild(key), decodeChild(item));
          }
        },
      );
    case "number":
      return decodePayloadNumber(model.value);
    case "object": {
      if (model.id === undefined) {
        return decodePayloadRecord(model.value, decodeChild);
      }
      return refs.define(
        model.id,
        () => ({}) as Record<string, unknown>,
        (value) => {
          for (const name of Object.keys(model.value)) {
            definePayloadProperty(
              value,
              name,
              decodeChild(model.value[name] as PayloadModel),
            );
          }
        },
      );
    }
    case "ref":
      return refs.read(model.id);
    case "set":
      return refs.define(
        model.id,
        () => new Set(),
        (value) => {
          for (const item of model.values) value.add(decodeChild(item));
        },
      );
    case "symbol":
      return Symbol.for(model.key);
    case "undefined":
      return undefined;
  }
}

export function decodePayloadRecord(
  value: Record<string, PayloadModel>,
  decodeChild: (model: PayloadModel) => unknown,
): Record<string, unknown> {
  const decoded: Record<string, unknown> = {};
  for (const name of Object.keys(value)) {
    definePayloadProperty(
      decoded,
      name,
      decodeChild(value[name] as PayloadModel),
    );
  }
  return decoded;
}

// "__proto__" must go through defineProperty so a hostile payload key defines
// an own property instead of mutating the prototype chain via the setter
// path; every other key gets the identical own data property from plain
// assignment at a fraction of the cost (this is the decode inner loop).
export function definePayloadProperty(
  target: Record<string, unknown>,
  name: string,
  value: unknown,
): void {
  if (name === "__proto__") {
    Object.defineProperty(target, name, {
      configurable: true,
      enumerable: true,
      value,
      writable: true,
    });
    return;
  }
  target[name] = value;
}

export function decodePayloadNumber(
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
  return entries.map((entry) => ({
    ...entry,
    value: encodePayloadValueWithGraph(entry.value, graph),
  }));
}

export function decodePayloadDataEntries(
  entries: readonly PayloadDataHydrationEntry[],
): FigDataHydrationEntry[] {
  const graph = createPayloadGraphDecodeContext();
  return entries.map((entry) => ({
    ...entry,
    value: decodeModelValue(entry.value, graph),
  }));
}

export function isPayloadSpecialModel(
  model: object,
): model is PayloadElementModel | PayloadSpecialModel {
  if (!("$fig" in model)) return false;

  switch ((model as { $fig: unknown }).$fig) {
    case "array":
    case "bigint":
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
