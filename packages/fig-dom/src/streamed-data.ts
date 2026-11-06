import {
  decodePayloadDataEntries,
  type FigDataStore,
  type PayloadDataHydrationEntry,
  STREAMED_DATA_PROPERTY,
  type StreamedDataMarker,
} from "@bgub/fig/internal";
import type { Container } from "./events.ts";

type StreamedDataRows = Array<PayloadDataHydrationEntry | StreamedDataMarker>;

// Rows queued before a root claims the prefix, or that root's receiver.
interface StreamedDataQueue {
  push(...batches: StreamedDataRows[]): unknown;
}

type StreamedDataCarrier = {
  [STREAMED_DATA_PROPERTY]?: Record<string, StreamedDataQueue>;
};

// The server's `d` operation pushes rows per identifierPrefix. The first
// hydrating root with that prefix drains the queued rows and replaces the
// queue with a receiver that applies later rows directly, owning the prefix
// until it unmounts. Rows fill only entries the client has no value for, so a
// late row never overwrites client state.
//
// A marker row promises its key's form after a reveal; the store holds that
// key's load for it. The document finishing parsing means the stream ended,
// so any form still missing never comes and those loads run without one.
export function adoptStreamedData(
  container: Container,
  identifierPrefix: string,
  store: FigDataStore,
): (() => void) | undefined {
  const doc = (container.ownerDocument ?? container) as Document;
  const carrier = doc as StreamedDataCarrier;
  const queues = (carrier[STREAMED_DATA_PROPERTY] ??= {});
  const queued = queues[identifierPrefix];
  if (queued !== undefined && !Array.isArray(queued)) return undefined;

  let streaming = doc.readyState === "loading";
  const receiver: StreamedDataQueue = {
    push(...batches) {
      for (const rows of batches) {
        const markers: StreamedDataMarker["key"][] = [];
        const values: PayloadDataHydrationEntry[] = [];
        for (const row of rows) {
          if ("pending" in row) markers.push(row.key);
          else values.push(row);
        }
        if (streaming && markers.length > 0) store.awaitTransferForms(markers);
        if (values.length > 0) {
          store.hydrateMissing(decodePayloadDataEntries(values));
        }
      }
    },
  };
  const release = () => {
    streaming = false;
    store.releaseTransferForms();
  };
  queues[identifierPrefix] = receiver;
  if (queued !== undefined) receiver.push(...(queued as StreamedDataRows[]));
  if (streaming)
    doc.addEventListener("DOMContentLoaded", release, { once: true });
  return () => {
    // Still streaming means the listener is still registered.
    if (streaming) doc.removeEventListener("DOMContentLoaded", release);
    if (queues[identifierPrefix] === receiver) delete queues[identifierPrefix];
  };
}
