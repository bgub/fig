import { HYDRATION_SKIP_ATTRIBUTE } from "@bgub/fig/internal";
import { escapeAttribute, escapeScriptJson } from "@bgub/fig-server/html";

// Initial Payload responses stream through one FIFO queue: a page-global
// array that streamed scripts push into before the client entry loads, then
// replaced by a live receiver. Records precede the Suspense reveal scripts of
// the boundaries that render them. Fig data rows use the renderer's own `d`
// operation instead.
export const startStreamGlobal = "__figTanstackStart";

export type StartStreamRecord =
  // An initial Payload response opened for a canonical data key.
  | readonly ["o", string, string]
  // Decoded text of the next bytes of an open Payload response.
  | readonly ["p", string, string]
  // The Payload response finished.
  | readonly ["e", string];

interface StartStreamQueue {
  push(...records: StartStreamRecord[]): unknown;
}

// Each announced response's body buffers its own bytes until a read claims it.
interface StreamedPayload {
  controller: ReadableStreamDefaultController<Uint8Array>;
  response: Response | null;
}

const textEncoder = new TextEncoder();
const streamedPayloads = new Map<string, StreamedPayload>();
let receiverInstalled = false;

export function startStreamScript(
  records: readonly StartStreamRecord[],
  nonce: string | undefined,
): string {
  if (records.length === 0) return "";
  const nonceAttribute =
    nonce === undefined ? "" : ` nonce="${escapeAttribute(nonce)}"`;
  const target = `(globalThis[${JSON.stringify(startStreamGlobal)}]??=[])`;
  const args = records.map((record) => escapeScriptJson(record)).join(",");
  return `<script ${HYDRATION_SKIP_ATTRIBUTE}=""${nonceAttribute}>${target}.push(${args})</script>`;
}

/**
 * Claims the streamed initial response for a Payload key. The returned body
 * replays bytes that already arrived and stays open for the rest, so a
 * boundary can hydrate while later Payload holes are still streaming.
 */
export function takeStreamedPayload(
  canonicalKey: string,
): Response | undefined {
  installReceiver();
  const payload = streamedPayloads.get(canonicalKey);
  if (payload === undefined) return undefined;
  const { response } = payload;
  payload.response = null;
  return response ?? undefined;
}

function installReceiver(): void {
  if (receiverInstalled || typeof document === "undefined") return;
  receiverInstalled = true;
  const queued: unknown = Reflect.get(globalThis, startStreamGlobal);
  const receiver: StartStreamQueue = {
    push(...records) {
      for (const record of records) receiveRecord(record);
    },
  };
  Reflect.set(globalThis, startStreamGlobal, receiver);
  if (Array.isArray(queued)) {
    for (const record of queued as StartStreamRecord[]) receiveRecord(record);
  }
}

function receiveRecord(record: StartStreamRecord): void {
  const key = record[1];
  if (record[0] === "o") {
    if (!streamedPayloads.has(key)) openPayload(key, record[2]);
    return;
  }
  const controller = streamedPayloads.get(key)?.controller;
  if (controller === undefined) return;
  if (record[0] === "p") controller.enqueue(textEncoder.encode(record[2]));
  else controller.close();
}

function openPayload(key: string, contentType: string): void {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({
    start(streamController) {
      controller = streamController;
    },
    cancel() {
      streamedPayloads.delete(key);
    },
  });
  streamedPayloads.set(key, {
    controller,
    response: new Response(body, {
      headers: { "content-type": contentType },
    }),
  });
}
