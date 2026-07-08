import type {
  DataResource,
  DataResourceKey,
  DataResourceKeyInput,
  DataResourceLoadContext,
} from "./data.ts";
import type { DataResourceOptions } from "./data-store.ts";

interface ServerDataResourceOptions<
  TArgs extends unknown[],
  TValue,
> extends DataResourceOptions<TArgs, TValue> {
  load: (
    ...argsAndContext: [...TArgs, DataResourceLoadContext]
  ) => TValue | PromiseLike<TValue>;
}

export function serverDataResource<TArgs extends unknown[], TValue>(
  _options: ServerDataResourceOptions<TArgs, TValue>,
): DataResource<TArgs, TValue> {
  throw new Error(
    "serverDataResource may only be imported from server-only code. Configure the Fig data transform or use a server-only module.",
  );
}

export type {
  DataResource,
  DataResourceKey,
  DataResourceKeyInput,
  DataResourceLoadContext,
};
