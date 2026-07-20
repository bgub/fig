import { createDataStore, type FigDataStoreController } from "@bgub/fig";
import {
  decodePayloadDataEntries,
  encodePayloadDataEntries,
  type PayloadDataHydrationEntry,
} from "@bgub/fig/internal";
import { serializableStartData } from "./payload-internal.ts";
import { requireStartDataStore } from "./store.ts";

export const startDataScriptId = "__fig_tanstack_start_data__";

const hydratedStores = new WeakSet<FigDataStoreController>();

export function createStartDataStore(): FigDataStoreController {
  const dataStore = createDataStore();
  if (typeof document !== "undefined") {
    hydrateDataStore(dataStore, document);
  }
  return dataStore;
}

export function hydrateStartDataStore(
  context: unknown,
  source: ParentNode,
): FigDataStoreController {
  const dataStore = requireStartDataStore(context);
  hydrateDataStore(dataStore, source);
  return dataStore;
}

export function serializeStartDataStore(
  dataStore: FigDataStoreController,
): string {
  return escapeJson(
    encodePayloadDataEntries(serializableStartData(dataStore.snapshot())),
  );
}

function hydrateDataStore(
  dataStore: FigDataStoreController,
  source: ParentNode,
): void {
  if (hydratedStores.has(dataStore)) return;
  const element = source.querySelector(`#${startDataScriptId}`);
  if (element === null) return;
  const serialized = JSON.parse(
    element.textContent ?? "[]",
  ) as PayloadDataHydrationEntry[];
  dataStore.hydrate(decodePayloadDataEntries(serialized));
  hydratedStores.add(dataStore);
}

function escapeJson(value: unknown): string {
  return JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}
