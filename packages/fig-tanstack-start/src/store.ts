import type { FigDataStoreController } from "@bgub/fig";
import { isDataStoreController } from "@bgub/fig/internal";

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
