import type {
  DataResource,
  DataResourceKey,
  DataResourceKeyInput,
  DataResourceLoadContext,
} from "./data.ts";
import type { ServerDataResourceOptions } from "./server.ts";

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
