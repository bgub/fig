import type { DataResourceKey, FigDataHydrationEntry } from "@bgub/fig";
import { jsonPayloadCodec, normalizeDataResourceKey } from "@bgub/fig/internal";
import { payloadTransportMarker } from "./document-markers.ts";
import {
  type StartStreamRecord,
  startStreamScript,
  takeStreamedPayload,
} from "./document-stream.ts";
import { getStartContext } from "./start-context.ts";

const textEncoder = new TextEncoder();
const emptyBytes = new Uint8Array();
const payloadTransportMarkerBytes = textEncoder.encode(payloadTransportMarker);

// Reads the document copy of a teed Payload response from registration on.
// Tee delivers each chunk to both branches together, so the copy holds every
// byte the server decoder has seen by the time any boundary rendered from
// them flushes.
interface PayloadCollector {
  failure: { error: unknown } | null;
  finished: Promise<void>;
  reader: ReadableStreamDefaultReader<Uint8Array>;
  // Document records not yet written, starting with the open record.
  records: StartStreamRecord[];
}

interface RequestPayloads {
  collectors: Map<string, PayloadCollector>;
  // Called whenever a collector queues a record or fails, so the document
  // transport can write it without waiting for the next HTML chunk.
  wake: () => void;
}

const requestPayloads = new WeakMap<object, RequestPayloads>();

export function initialPayloadResponse(
  key: DataResourceKey,
): Response | undefined {
  if (typeof document === "undefined") return undefined;
  return takeStreamedPayload(normalizeDataResourceKey(key));
}

export function registerPayloadResponse(
  key: DataResourceKey,
  response: Response,
): Response {
  if (!response.ok || response.body === null) return response;
  const payloads = currentRequestPayloads();
  if (payloads === undefined) return response;

  const canonicalKey = normalizeDataResourceKey(key);
  if (payloads.collectors.has(canonicalKey)) return response;

  const [decodeStream, documentStream] = response.body.tee();
  payloads.collectors.set(
    canonicalKey,
    collectPayload(
      canonicalKey,
      response.headers.get("content-type") ?? jsonPayloadCodec.contentType,
      documentStream,
      () => payloads.wake(),
    ),
  );
  payloads.wake();

  return new Response(decodeStream, {
    headers: response.headers,
    status: response.status,
    statusText: response.statusText,
  });
}

/**
 * Excludes Payload-backed entries from Fig's data rows: their element-valued
 * roots travel as Payload responses instead.
 */
export function payloadDataFilter(): (entry: FigDataHydrationEntry) => boolean {
  const payloads = currentRequestPayloads();
  return (entry) =>
    payloads?.collectors.has(normalizeDataResourceKey(entry.key)) !== true;
}

/**
 * Places the Fig data snapshot and initial Payload responses at the
 * `StartScripts` marker, then keeps the document flowing: Payload records
 * are written as they arrive, between HTML chunks and after the HTML ends,
 * and any still queued precede the next HTML chunk. Fig's renderer streams
 * each boundary's data rows itself, ahead of the boundary's reveal.
 */
export function injectPayloadDocument(
  html: ReadableStream<Uint8Array>,
  nonce: string | undefined,
  snapshotScript?: () => string,
): ReadableStream<Uint8Array> {
  const requestPayloads = currentRequestPayloads();
  if (requestPayloads === undefined && snapshotScript === undefined) {
    return html;
  }
  const payloads: RequestPayloads = requestPayloads ?? {
    collectors: new Map(),
    wake: () => undefined,
  };
  const collectors = payloads.collectors;
  const htmlReader = html.getReader();
  // A read that lost a race to queued Payload records stays pending here.
  let htmlRead: Promise<ReadableStreamReadResult<Uint8Array>> | null = null;
  let htmlEnded = false;
  let buffer: Uint8Array = emptyBytes;
  let injected = false;

  // Resolves the next time a collector queues a record.
  function recordsQueued(): Promise<void> {
    return new Promise((resolve) => {
      payloads.wake = () => {
        payloads.wake = () => undefined;
        resolve();
      };
    });
  }

  // Payload records since the previous call, as one script (or "").
  function payloadRecords(): string {
    const records: StartStreamRecord[] = [];
    for (const collector of collectors.values()) {
      if (collector.failure !== null) throw collector.failure.error;
      records.push(...collector.records.splice(0));
    }
    return startStreamScript(records, nonce);
  }

  // Buffers until the marker is found, then emits the snapshot and the
  // Payload records already available in its place. Returns the bytes that
  // are safe to send now.
  function scanForMarker(): Uint8Array {
    const marker = indexOfPayloadTransportMarker(buffer);
    if (marker === -1) {
      const length = Math.max(
        0,
        buffer.byteLength - payloadTransportMarkerBytes.byteLength + 1,
      );
      const ready = buffer.subarray(0, length);
      buffer = buffer.subarray(length);
      return ready;
    }

    injected = true;
    const ready = concatenateBytes(
      concatenateBytes(
        buffer.subarray(0, marker),
        textEncoder.encode((snapshotScript?.() ?? "") + payloadRecords()),
      ),
      buffer.subarray(marker),
    );
    buffer = emptyBytes;
    return ready;
  }

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      for (;;) {
        // Past the marker, every chunk boundary is a safe point for a script.
        if (injected) {
          const records = payloadRecords();
          if (records !== "") {
            controller.enqueue(textEncoder.encode(records));
            return;
          }
        }

        if (htmlEnded) {
          // Payload bytes can outlive the HTML that consumed them; the client
          // response stays open until each one ends.
          const queued = recordsQueued();
          const settled = Promise.allSettled(
            Array.from(collectors.values(), (collector) => collector.finished),
          );
          if (await Promise.race([settled.then(() => true), queued])) {
            const records = payloadRecords();
            if (records !== "") controller.enqueue(textEncoder.encode(records));
            controller.close();
            return;
          }
          continue;
        }

        htmlRead ??= htmlReader.read();
        const result = injected
          ? await Promise.race([htmlRead, recordsQueued()])
          : await htmlRead;
        if (result === undefined) continue;
        htmlRead = null;

        if (result.done) {
          if (injected) {
            htmlEnded = true;
            continue;
          }
          if (collectors.size > 0) {
            throw new Error(
              "Initial TanStack Start Payload responses require <StartScripts /> in the root document.",
            );
          }
          if (buffer.byteLength > 0) controller.enqueue(buffer);
          controller.close();
          return;
        }

        // Records queued while the read was pending may be bytes this chunk
        // was rendered from, so they go first.
        let ready: Uint8Array;
        if (injected) {
          ready = concatenateBytes(
            textEncoder.encode(payloadRecords()),
            result.value,
          );
        } else {
          buffer = concatenateBytes(buffer, result.value);
          ready = scanForMarker();
        }
        if (ready.byteLength > 0) {
          controller.enqueue(ready);
          return;
        }
      }
    },
    async cancel(reason) {
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
  if (right.byteLength === 0) return left;
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
  contentType: string,
  stream: ReadableStream<Uint8Array>,
  wake: () => void,
): PayloadCollector {
  const reader = stream.getReader();
  const collector: PayloadCollector = {
    failure: null,
    finished: Promise.resolve(),
    reader,
    records: [["o", key, contentType]],
  };
  collector.finished = (async () => {
    const decoder = new TextDecoder();
    try {
      for (;;) {
        const next = await reader.read();
        const text = decoder.decode(next.value, { stream: !next.done });
        if (text !== "") appendText(collector.records, key, text);
        if (next.done) collector.records.push(["e", key]);
        if (text !== "" || next.done) wake();
        if (next.done) return;
      }
    } catch (error) {
      collector.failure = { error };
      wake();
      throw error;
    }
  })();
  void collector.finished.catch(() => undefined);
  return collector;
}

// Text that arrives between two document writes shares one record.
function appendText(
  records: StartStreamRecord[],
  key: string,
  text: string,
): void {
  const last = records.at(-1);
  if (last?.[0] === "p")
    records[records.length - 1] = ["p", key, last[2] + text];
  else records.push(["p", key, text]);
}

function currentRequestPayloads(): RequestPayloads | undefined {
  const context = getStartContext({ throwIfNotFound: false });
  if (
    (typeof context !== "object" && typeof context !== "function") ||
    context === null
  ) {
    return undefined;
  }

  let payloads = requestPayloads.get(context);
  if (payloads === undefined) {
    payloads = { collectors: new Map(), wake: () => undefined };
    requestPayloads.set(context, payloads);
  }
  return payloads;
}
