import {
  dataResource,
  type DataResource,
  type DataResourceKey,
  type DataResourceKeyInput,
  type DataResourceLoadContext,
  type FigNode,
} from "@bgub/fig";
import { payloadDataLoader } from "@bgub/fig-dom";
import type { ResolveClientReference } from "@bgub/fig/payload";
import {
  initialPayloadResponse,
  registerPayloadResponse,
} from "./payload-internal.ts";

export interface PayloadResourceOptions<TInput> {
  debugArgs?: (input: TInput) => DataResourceKeyInput;
  key: (input: TInput) => DataResourceKey;
  request: (
    input: TInput,
    context: DataResourceLoadContext,
  ) => Response | PromiseLike<Response>;
  resolveClientReference?: ResolveClientReference;
}

/**
 * A TanStack Start server-component route cache. The initial payload stream is
 * adopted from the SSR document; navigation and refresh call `request`.
 */
export function payloadResource<TInput>(
  options: PayloadResourceOptions<TInput>,
): DataResource<[TInput], FigNode> {
  return dataResource({
    debugArgs: options.debugArgs,
    key: options.key,
    load: payloadDataLoader<[TInput]>({
      request: async (input, context) => {
        const key = options.key(input);
        const initial = initialPayloadResponse(key);
        if (initial !== undefined) return initial;
        const response = await options.request(input, context);
        return registerPayloadResponse(key, response);
      },
      resolveClientReference: options.resolveClientReference,
      retainAssets: typeof document === "undefined",
    }),
  });
}
