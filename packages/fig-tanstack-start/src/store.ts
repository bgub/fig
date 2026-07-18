import type { FigDataStoreController } from "@bgub/fig";

export function requireStartDataStore(
  context: unknown,
): FigDataStoreController {
  if (typeof context === "object" && context !== null) {
    const data = (context as { data?: unknown }).data;
    if (typeof data === "object" && data !== null) {
      const candidate = data as Partial<FigDataStoreController>;
      if (
        typeof candidate.ensureData === "function" &&
        typeof candidate.hydrate === "function" &&
        typeof candidate.snapshot === "function"
      ) {
        return candidate as FigDataStoreController;
      }
    }
  }
  throw new Error(
    "TanStack Start routers must spread createStartDataContext() into createRouter().",
  );
}
