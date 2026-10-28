import type {
  DataResource,
  DataResourceKey,
  FigDataStoreHandle,
} from "@bgub/fig";

export type RouteDataContext = {
  data: FigDataStoreHandle;
};

export const routeDataOwners = new WeakMap<
  object,
  (key: DataResourceKey) => void
>();

export async function ensureRouteData<TArgs extends unknown[], TValue>(
  context: RouteDataContext,
  resource: DataResource<TArgs, TValue>,
  ...args: TArgs
): Promise<void> {
  routeDataOwners.get(context)?.(resource.key(...args));
  await context.data.ensureData(resource, ...args);
}

export function dataStoreFromContext(
  context: Partial<RouteDataContext> | null | undefined,
): FigDataStoreHandle | undefined {
  return context?.data;
}
