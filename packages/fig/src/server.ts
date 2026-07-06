import type {
  DataResource,
  DataResourceKey,
  DataResourceKeyInput,
  DataResourceLoadContext,
} from "./data.ts";
import { dataResource, type DataResourceOptions } from "./data-store.ts";

// Same options as dataResource, but the server-only loader is required —
// a load-less declaration belongs in a shared module as a key-only resource.
export interface ServerDataResourceOptions<
  TArgs extends unknown[],
  TValue,
> extends DataResourceOptions<TArgs, TValue> {
  load: (
    ...argsAndContext: [...TArgs, DataResourceLoadContext]
  ) => TValue | PromiseLike<TValue>;
}

export function serverDataResource<TArgs extends unknown[], TValue>(
  options: ServerDataResourceOptions<TArgs, TValue>,
): DataResource<TArgs, TValue> {
  return dataResource(options);
}

export type {
  DataResource,
  DataResourceKey,
  DataResourceKeyInput,
  DataResourceLoadContext,
};
