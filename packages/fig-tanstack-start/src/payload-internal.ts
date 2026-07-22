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
  cancel(reason: unknown): void;
  result: Promise<PayloadDocumentEntry>;
}

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
  const script = Array.from(
    document.querySelectorAll(`script[${payloadKeyAttribute}]`),
  ).find(
    (candidate) => candidate.getAttribute(payloadKeyAttribute) === canonicalKey,
  );
  if (script === undefined || consumedPayloads.has(script)) return undefined;
  consumedPayloads.add(script);

  return new Response(script.textContent ?? "", {
    headers: {
      "content-type":
        script.getAttribute("type") ?? jsonPayloadCodec.contentType,
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
): readonly FigDataHydrationEntry[] {
  const payloads = currentRequestPayloads(false);
  if (payloads === undefined || payloads.size === 0) return entries;
  return entries.filter(
    (entry) => !payloads.has(normalizeDataResourceKey(entry.key)),
  );
}

export function injectPayloadDocument(
  html: ReadableStream<Uint8Array>,
  nonce: string | undefined,
  ready: PromiseLike<void> = Promise.resolve(),
): ReadableStream<Uint8Array> {
  const requestPayloads = currentRequestPayloads(true);
  if (requestPayloads === undefined) return html;
  const registeredPayloads = requestPayloads;
  const collectors = new Map<string, PayloadCollector>();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";
  let injected = false;
  let htmlReader: ReadableStreamDefaultReader<Uint8Array> | null = null;

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
      [...collectors.values()].map((collector) => collector.result),
    );
  }

  collectRegisteredPayloads();

  function enqueue(
    controller: ReadableStreamDefaultController<Uint8Array>,
    value: string,
  ): boolean {
    if (value.length === 0) return false;
    controller.enqueue(encoder.encode(value));
    return true;
  }

  async function flush(
    controller: ReadableStreamDefaultController<Uint8Array>,
    final: boolean,
  ): Promise<boolean> {
    if (injected) {
      const emitted = enqueue(controller, buffer);
      buffer = "";
      return emitted;
    }

    const marker = buffer.indexOf(payloadTransportMarker);
    if (marker !== -1) {
      let emitted = enqueue(controller, buffer.slice(0, marker));
      buffer = buffer.slice(marker);
      emitted =
        enqueue(controller, payloadDocumentScripts(await payloads(), nonce)) ||
        emitted;
      injected = true;
      emitted = enqueue(controller, buffer) || emitted;
      buffer = "";
      return emitted;
    }

    if (final) {
      const entries = await payloads();
      if (entries.length > 0) {
        throw new Error(
          "Initial TanStack Start Payload responses require <StartScripts /> in the root document.",
        );
      }
      const emitted = enqueue(controller, buffer);
      buffer = "";
      injected = true;
      return emitted;
    }

    const length = Math.max(0, buffer.length - payloadTransportMarker.length);
    const emitted = enqueue(controller, buffer.slice(0, length));
    buffer = buffer.slice(length);
    return emitted;
  }

  return new ReadableStream<Uint8Array>({
    start() {
      htmlReader = html.getReader();
    },
    async pull(controller) {
      if (htmlReader === null) return;
      for (;;) {
        const result = await htmlReader.read();
        if (result.done) {
          buffer += decoder.decode();
          await flush(controller, true);
          controller.close();
          return;
        }
        buffer += decoder.decode(result.value, { stream: true });
        if (await flush(controller, false)) return;
      }
    },
    cancel(reason) {
      void htmlReader?.cancel(reason).catch(() => undefined);
      collectRegisteredPayloads();
      for (const collector of collectors.values()) collector.cancel(reason);
    },
  });
}

function collectPayload(
  key: string,
  entry: RegisteredPayloadStream,
): PayloadCollector {
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  const result = (async (): Promise<PayloadDocumentEntry> => {
    reader = entry.stream.getReader();
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
    cancel(reason) {
      void reader?.cancel(reason).catch(() => undefined);
    },
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
  const nonceAttribute = scriptNonceAttribute(nonce);
  return entries
    .map(
      (entry) =>
        `<script type="${escapeAttribute(entry.contentType)}" ${payloadKeyAttribute}="${escapeAttribute(entry.key)}" ${HYDRATION_SKIP_ATTRIBUTE}=""${nonceAttribute}>${escapeScriptText(entry.payload)}</script>`,
    )
    .join("");
}

function scriptNonceAttribute(nonce: string | undefined): string {
  if (nonce === undefined) return "";
  return ` nonce="${escapeAttribute(nonce)}"`;
}
