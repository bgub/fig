import { dataResource } from "./data-store.ts";
import type {
  DataResource,
  DataResourceKey,
  DataResourceKeyInput,
  DataResourceLoadContext,
} from "./data-store.ts";

export interface ServerDataResourceOptions<TArgs extends unknown[], TValue> {
  key: (...args: TArgs) => DataResourceKey;
  load: (
    ...argsAndContext: [...TArgs, DataResourceLoadContext]
  ) => TValue | PromiseLike<TValue>;
  debugArgs?: (...args: TArgs) => DataResourceKeyInput;
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
