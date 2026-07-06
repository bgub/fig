import { dataResource } from "./store.ts";
import type {
  DataResource,
  DataResourceKey,
  DataResourceKeyInput,
  DataResourceLoadContext,
} from "./store.ts";

export interface ServerDataResourceOptions<TArgs extends unknown[], TValue> {
  key: (...args: TArgs) => DataResourceKey;
  load: (
    ...argsAndContext: [...TArgs, DataResourceLoadContext]
  ) => TValue | PromiseLike<TValue>;
  debugArgs?: (...args: TArgs) => DataResourceKeyInput;
  remote?: true;
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
