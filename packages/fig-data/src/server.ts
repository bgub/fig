import { dataResource } from "./store.ts";
import type {
  DataResource,
  DataResourceKey,
  DataResourceKeyInput,
  DataResourceLoadContext,
  RegisteredContext,
} from "./store.ts";

export interface ServerDataResourceOptions<
  TArgs extends unknown[],
  TValue,
  TStoreContext = RegisteredContext,
> {
  key: (...args: TArgs) => DataResourceKey;
  load: (
    ...argsAndContext: [...TArgs, DataResourceLoadContext<TStoreContext>]
  ) => TValue | PromiseLike<TValue>;
  debugArgs?: (...args: TArgs) => DataResourceKeyInput;
  name?: string;
  remote?: true;
}

export function serverDataResource<
  TArgs extends unknown[],
  TValue,
  TStoreContext = RegisteredContext,
>(
  options: ServerDataResourceOptions<TArgs, TValue, TStoreContext>,
): DataResource<TArgs, TValue, TStoreContext> {
  return dataResource(options);
}

export type {
  DataResource,
  DataResourceKey,
  DataResourceKeyInput,
  DataResourceLoadContext,
  RegisteredContext,
};
