import type { DataResource, FigDataStoreHandle } from "@bgub/fig";

export type RouteDataContext = {
  data: FigDataStoreHandle;
};

export async function ensureRouteData<TArgs extends unknown[], TValue>(
  context: RouteDataContext,
  resource: DataResource<TArgs, TValue>,
  ...args: TArgs
): Promise<void> {
  await context.data.ensureData(resource, ...args);
}

export function dataStoreFromContext(
  context: Partial<RouteDataContext> | null | undefined,
): FigDataStoreHandle | undefined {
  return context?.data;
}
