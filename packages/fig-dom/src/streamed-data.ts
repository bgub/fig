import {
  decodePayloadDataEntries,
  type FigDataStore,
  type PayloadDataHydrationEntry,
  STREAMED_DATA_PROPERTY,
} from "@bgub/fig/internal";
import type { Container } from "./events.ts";

type StreamedDataRows = PayloadDataHydrationEntry[];

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
export function adoptStreamedData(
  container: Container,
  identifierPrefix: string,
  store: FigDataStore,
): (() => void) | undefined {
  const carrier = (container.ownerDocument ?? container) as StreamedDataCarrier;
  const queues = (carrier[STREAMED_DATA_PROPERTY] ??= {});
  const queued = queues[identifierPrefix];
  if (queued !== undefined && !Array.isArray(queued)) return undefined;

  const receiver: StreamedDataQueue = {
    push(...batches) {
      for (const rows of batches) {
        store.hydrateMissing(decodePayloadDataEntries(rows));
      }
    },
  };
  queues[identifierPrefix] = receiver;
  if (queued !== undefined) receiver.push(...(queued as StreamedDataRows[]));
  return () => {
    if (queues[identifierPrefix] === receiver) delete queues[identifierPrefix];
  };
}
