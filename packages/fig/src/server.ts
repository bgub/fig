import type {
  DataResource,
  DataResourceKey,
  DataResourceKeyInput,
  DataResourceLoadContext,
  DataResourceLoader,
} from "./data.ts";
import { type DataResourceOptions, dataResource } from "./data-store.ts";

// Same options as dataResource, but the server-only loader is required —
// a load-less declaration belongs in a shared module as a key-only resource.
export interface ServerDataResourceOptions<
  TArgs extends unknown[],
  TValue,
> extends DataResourceOptions<TArgs, TValue> {
  load: DataResourceLoader<TArgs, TValue>;
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
  DataResourceLoader,
};
