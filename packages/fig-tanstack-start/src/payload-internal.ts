import { type DataResourceKey, type FigDataHydrationEntry } from "@bgub/fig";
import {
  HYDRATION_SKIP_ATTRIBUTE,
  jsonPayloadCodec,
  normalizeDataResourceKey,
} from "@bgub/fig/internal";
import { escapeAttribute, escapeScriptText } from "@bgub/fig-server/html";
import { getStartContext } from "./start-context.ts";

const hydrationBarrierMarker = '<script id="$tsr-stream-barrier"';
const payloadKeyAttribute = "data-fig-tanstack-payload-key";

interface PayloadDocumentEntry {
  contentType: string;
  key: string;
  payload: string;
}

interface RegisteredPayloadStream {
  contentType: string;
  key: string;
  stream: ReadableStream<Uint8Array>;
}

interface RequestPayloadState {
  entries: Map<string, RegisteredPayloadStream>;
}

interface PayloadCollector {
  cancel(reason: unknown): void;
  result: Promise<PayloadDocumentEntry>;
}

const requestPayloads = new WeakMap<object, RequestPayloadState>();
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
  const state = currentRequestPayloadState(true);
  if (state === undefined) return response;

  const canonicalKey = normalizeDataResourceKey(key);
  if (state.entries.has(canonicalKey)) return response;

  const [decodeStream, documentStream] = response.body.tee();
  state.entries.set(canonicalKey, {
    contentType:
      response.headers.get("content-type") ?? jsonPayloadCodec.contentType,
    key: canonicalKey,
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
  const payloads = currentRequestPayloadState(false)?.entries;
  if (payloads === undefined || payloads.size === 0) return entries;
  return entries.filter(
    (entry) => !payloads.has(normalizeDataResourceKey(entry.key)),
  );
}

export function injectPayloadDocument(
  html: ReadableStream<Uint8Array>,
  nonce: string | undefined,
): ReadableStream<Uint8Array> {
  const entries = currentRequestPayloadState(false)?.entries.values();
  if (entries === undefined) return html;
  const registered = [...entries];
  if (registered.length === 0) return html;

  const collectors = registered.map(collectPayload);
  const payloads = Promise.all(collectors.map((collector) => collector.result));
  void payloads.catch(() => undefined);
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";
  let injected = false;
  let htmlReader: ReadableStreamDefaultReader<Uint8Array> | null = null;

  function enqueue(
    controller: ReadableStreamDefaultController<Uint8Array>,
    value: string,
  ): void {
    if (value.length > 0) controller.enqueue(encoder.encode(value));
  }

  async function flush(
    controller: ReadableStreamDefaultController<Uint8Array>,
    final: boolean,
  ): Promise<void> {
    if (injected) {
      enqueue(controller, buffer);
      buffer = "";
      return;
    }

    const barrier = buffer.indexOf(hydrationBarrierMarker);
    if (barrier !== -1) {
      enqueue(controller, buffer.slice(0, barrier));
      buffer = buffer.slice(barrier);
      enqueue(controller, payloadDocumentScripts(await payloads, nonce));
      injected = true;
      enqueue(controller, buffer);
      buffer = "";
      return;
    }

    if (final) {
      const bodyClose = buffer.toLowerCase().indexOf("</body>");
      const offset = bodyClose === -1 ? buffer.length : bodyClose;
      enqueue(controller, buffer.slice(0, offset));
      enqueue(controller, payloadDocumentScripts(await payloads, nonce));
      enqueue(controller, buffer.slice(offset));
      buffer = "";
      injected = true;
      return;
    }

    const length = Math.max(0, buffer.length - hydrationBarrierMarker.length);
    enqueue(controller, buffer.slice(0, length));
    buffer = buffer.slice(length);
  }

  return new ReadableStream<Uint8Array>({
    start() {
      htmlReader = html.getReader();
    },
    async pull(controller) {
      if (htmlReader === null) return;
      const result = await htmlReader.read();
      if (result.done) {
        buffer += decoder.decode();
        await flush(controller, true);
        controller.close();
        return;
      }
      buffer += decoder.decode(result.value, { stream: true });
      await flush(controller, false);
    },
    cancel(reason) {
      void htmlReader?.cancel(reason).catch(() => undefined);
      for (const collector of collectors) collector.cancel(reason);
    },
  });
}

function collectPayload(entry: RegisteredPayloadStream): PayloadCollector {
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
          key: entry.key,
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

function currentRequestPayloadState(
  create: boolean,
): RequestPayloadState | undefined {
  const context = getStartContext({ throwIfNotFound: false });
  if (
    (typeof context !== "object" && typeof context !== "function") ||
    context === null
  ) {
    return undefined;
  }

  let state = requestPayloads.get(context);
  if (state === undefined && create) {
    state = { entries: new Map() };
    requestPayloads.set(context, state);
  }
  return state;
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
