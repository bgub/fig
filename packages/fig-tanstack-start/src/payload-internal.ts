import { type DataResourceKey, type FigDataHydrationEntry } from "@bgub/fig";
import {
  HYDRATION_SKIP_ATTRIBUTE,
  jsonPayloadCodec,
  normalizeDataResourceKey,
} from "@bgub/fig/internal";
import { escapeAttribute, escapeScriptText } from "@bgub/fig-server/html";
import { payloadTransportMarker } from "./document-markers.ts";
import { getStartContext } from "./start-context.ts";

const payloadKeyAttribute = "data-fig-tanstack-payload-key";
const textEncoder = new TextEncoder();
const emptyBytes = new Uint8Array();
const payloadTransportMarkerBytes = textEncoder.encode(payloadTransportMarker);

interface PayloadDocumentEntry {
  contentType: string;
  key: string;
  payload: string;
}

interface RegisteredPayloadStream {
  contentType: string;
  stream: ReadableStream<Uint8Array>;
}

interface PayloadCollector {
  reader: ReadableStreamDefaultReader<Uint8Array>;
  result: Promise<PayloadDocumentEntry>;
}

export type PayloadKeyLookup = Pick<ReadonlySet<string>, "has" | "size">;

const requestPayloads = new WeakMap<
  object,
  Map<string, RegisteredPayloadStream>
>();
const consumedPayloads = new WeakSet<Element>();

export function initialPayloadResponse(
  key: DataResourceKey,
): Response | undefined {
  if (typeof document === "undefined") return undefined;
  const canonicalKey = normalizeDataResourceKey(key);
  let payload: Element | undefined;
  for (const candidate of document.querySelectorAll(
    `script[${payloadKeyAttribute}]`,
  )) {
    if (candidate.getAttribute(payloadKeyAttribute) === canonicalKey) {
      payload = candidate;
      break;
    }
  }
  if (payload === undefined || consumedPayloads.has(payload)) return undefined;
  consumedPayloads.add(payload);

  return new Response(payload.textContent ?? "", {
    headers: {
      "content-type":
        payload.getAttribute("type") ?? jsonPayloadCodec.contentType,
    },
  });
}

export function registerPayloadResponse(
  key: DataResourceKey,
  response: Response,
): Response {
  if (!response.ok || response.body === null) return response;
  const payloads = currentRequestPayloads(true);
  if (payloads === undefined) return response;

  const canonicalKey = normalizeDataResourceKey(key);
  if (payloads.has(canonicalKey)) return response;

  const [decodeStream, documentStream] = response.body.tee();
  payloads.set(canonicalKey, {
    contentType:
      response.headers.get("content-type") ?? jsonPayloadCodec.contentType,
    stream: documentStream,
  });

  return new Response(decodeStream, {
    headers: response.headers,
    status: response.status,
    statusText: response.statusText,
  });
}

export function serializableStartData(
  entries: readonly FigDataHydrationEntry[],
  payloadKeys: PayloadKeyLookup | undefined = currentRequestPayloads(false),
): readonly FigDataHydrationEntry[] {
  if (payloadKeys === undefined || payloadKeys.size === 0) return entries;
  return entries.filter(
    (entry) => !payloadKeys.has(normalizeDataResourceKey(entry.key)),
  );
}

export function injectPayloadDocument(
  html: ReadableStream<Uint8Array>,
  nonce: string | undefined,
  ready: PromiseLike<void> = Promise.resolve(),
  beforePayloads?: (payloadKeys: PayloadKeyLookup) => string,
): ReadableStream<Uint8Array> {
  const requestPayloads = currentRequestPayloads(true);
  if (requestPayloads === undefined && beforePayloads === undefined)
    return html;
  const registeredPayloads =
    requestPayloads ?? new Map<string, RegisteredPayloadStream>();
  const collectors = new Map<string, PayloadCollector>();
  const htmlReader = html.getReader();
  let buffer: Uint8Array = emptyBytes;
  let injected = false;

  function collectRegisteredPayloads(): void {
    for (const [key, entry] of registeredPayloads) {
      if (collectors.has(key)) continue;
      const collector = collectPayload(key, entry);
      collectors.set(key, collector);
      void collector.result.catch(() => undefined);
    }
  }

  async function payloads(): Promise<PayloadDocumentEntry[]> {
    await ready;
    collectRegisteredPayloads();
    return Promise.all(
      Array.from(collectors.values(), (collector) => collector.result),
    );
  }

  collectRegisteredPayloads();

  function enqueue(
    controller: ReadableStreamDefaultController<Uint8Array>,
    value: Uint8Array,
  ): boolean {
    if (value.byteLength === 0) return false;
    controller.enqueue(value);
    return true;
  }

  async function flushBuffer(
    controller: ReadableStreamDefaultController<Uint8Array>,
  ): Promise<boolean> {
    const marker = indexOfPayloadTransportMarker(buffer);
    if (marker !== -1) {
      let emitted = enqueue(controller, buffer.subarray(0, marker));
      buffer = buffer.subarray(marker);
      // `payloads()` waits for `ready`, so the document prefix observes the
      // final store and the complete set of Payload-backed keys.
      const entries = await payloads();
      emitted =
        enqueue(
          controller,
          textEncoder.encode(
            (beforePayloads?.(registeredPayloads) ?? "") +
              payloadDocumentScripts(entries, nonce),
          ),
        ) || emitted;
      injected = true;
      emitted = enqueue(controller, buffer) || emitted;
      buffer = emptyBytes;
      return emitted;
    }

    const length = Math.max(
      0,
      buffer.byteLength - payloadTransportMarkerBytes.byteLength + 1,
    );
    const emitted = enqueue(controller, buffer.subarray(0, length));
    buffer = buffer.subarray(length);
    return emitted;
  }

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      for (;;) {
        const result = await htmlReader.read();
        if (result.done) {
          if (!injected) {
            const entries = await payloads();
            if (entries.length > 0) {
              throw new Error(
                "Initial TanStack Start Payload responses require <StartScripts /> in the root document.",
              );
            }
            enqueue(controller, buffer);
          }
          controller.close();
          return;
        }
        if (injected) {
          if (enqueue(controller, result.value)) return;
          continue;
        }
        buffer = concatenateBytes(buffer, result.value);
        if (await flushBuffer(controller)) return;
      }
    },
    async cancel(reason) {
      collectRegisteredPayloads();
      await Promise.allSettled([
        htmlReader.cancel(reason),
        ...Array.from(collectors.values(), (collector) =>
          collector.reader.cancel(reason),
        ),
      ]);
    },
  });
}

function concatenateBytes(left: Uint8Array, right: Uint8Array): Uint8Array {
  if (left.byteLength === 0) return right;
  const result = new Uint8Array(left.byteLength + right.byteLength);
  result.set(left);
  result.set(right, left.byteLength);
  return result;
}

function indexOfPayloadTransportMarker(value: Uint8Array): number {
  const lastStart = value.byteLength - payloadTransportMarkerBytes.byteLength;
  for (let start = 0; start <= lastStart; start += 1) {
    let index = 0;
    while (
      index < payloadTransportMarkerBytes.byteLength &&
      value[start + index] === payloadTransportMarkerBytes[index]
    ) {
      index += 1;
    }
    if (index === payloadTransportMarkerBytes.byteLength) return start;
  }
  return -1;
}

function collectPayload(
  key: string,
  entry: RegisteredPayloadStream,
): PayloadCollector {
  const reader = entry.stream.getReader();
  const result = (async (): Promise<PayloadDocumentEntry> => {
    const decoder = new TextDecoder();
    const chunks: string[] = [];
    for (;;) {
      const next = await reader.read();
      chunks.push(decoder.decode(next.value, { stream: !next.done }));
      if (next.done) {
        return {
          contentType: entry.contentType,
          key,
          payload: chunks.join(""),
        };
      }
    }
  })();

  return {
    reader,
    result,
  };
}

function currentRequestPayloads(
  create: boolean,
): Map<string, RegisteredPayloadStream> | undefined {
  const context = getStartContext({ throwIfNotFound: false });
  if (
    (typeof context !== "object" && typeof context !== "function") ||
    context === null
  ) {
    return undefined;
  }

  let payloads = requestPayloads.get(context);
  if (payloads === undefined && create) {
    payloads = new Map();
    requestPayloads.set(context, payloads);
  }
  return payloads;
}

function payloadDocumentScripts(
  entries: readonly PayloadDocumentEntry[],
  nonce: string | undefined,
): string {
  const nonceAttribute =
    nonce === undefined ? "" : ` nonce="${escapeAttribute(nonce)}"`;
  let scripts = "";
  for (const entry of entries) {
    scripts += `<script type="${escapeAttribute(entry.contentType)}" ${payloadKeyAttribute}="${escapeAttribute(entry.key)}" ${HYDRATION_SKIP_ATTRIBUTE}=""${nonceAttribute}>${escapeScriptText(entry.payload)}</script>`;
  }
  return scripts;
}
