import { createDataStore, type FigDataStoreController } from "@bgub/fig";
import {
  decodePayloadDataEntries,
  encodePayloadDataEntries,
  HYDRATION_SKIP_ATTRIBUTE,
  type PayloadDataHydrationEntry,
} from "@bgub/fig/internal";
import { escapeScriptJson } from "@bgub/fig-server/html";
import {
  type PayloadKeyLookup,
  serializableStartData,
} from "./payload-internal.ts";
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

export function startDataDocumentScript(
  dataStore: FigDataStoreController,
  payloadKeys: PayloadKeyLookup,
): string {
  const data = escapeScriptJson(
    encodePayloadDataEntries(
      serializableStartData(dataStore.snapshot(), payloadKeys),
    ),
  );
  return `<script ${HYDRATION_SKIP_ATTRIBUTE} id="${startDataScriptId}" type="application/json">${data}</script>`;
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
