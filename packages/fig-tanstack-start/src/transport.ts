import {
  createDataStore,
  type FigDataHydrationEntry,
  type FigDataStoreController,
} from "@bgub/fig";
import {
  decodePayloadDataEntries,
  encodePayloadDataEntries,
  HYDRATION_SKIP_ATTRIBUTE,
  isDataStoreController,
  type PayloadDataHydrationEntry,
} from "@bgub/fig/internal";
import { escapeScriptJson } from "@bgub/fig-server/html";

export const startDataScriptId = "__fig_tanstack_start_data__";

const hydratedStores = new WeakSet<FigDataStoreController>();

export function createStartDataStore(): FigDataStoreController {
  const dataStore = createDataStore();
  if (typeof document !== "undefined") {
    hydrateDataStore(dataStore, document);
  }
  return dataStore;
}

export function requireStartDataStore(
  context: unknown,
): FigDataStoreController {
  if (
    (typeof context === "object" || typeof context === "function") &&
    context !== null
  ) {
    const data = Reflect.get(context, "data");
    if (isDataStoreController(data)) return data;
  }
  throw new Error(
    "TanStack Start routers must spread createStartDataContext() into createRouter().",
  );
}

export function hydrateStartDataStore(
  context: unknown,
  source: ParentNode,
): FigDataStoreController {
  const dataStore = requireStartDataStore(context);
  hydrateDataStore(dataStore, source);
  return dataStore;
}

/**
 * The snapshot placed before the router bootstrap: what the shell read and
 * anything else settled that the renderer has not streamed. Later rows
 * stream ahead of their own boundaries' reveals.
 */
export function startDataDocumentScript(
  entries: readonly FigDataHydrationEntry[],
): string {
  const data = escapeScriptJson(encodePayloadDataEntries(entries));
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
