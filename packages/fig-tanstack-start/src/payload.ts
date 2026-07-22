import {
  createElement,
  dataResource,
  type ComponentProps,
  type ComponentType,
  type DataResource,
  type DataResourceKey,
  type DataResourceKeyInput,
  type DataResourceLoadContext,
  type FigNode,
} from "@bgub/fig";
import { isClientReference } from "@bgub/fig/internal";
import { payloadDataLoader } from "@bgub/fig-dom";
import { resolveIsomorphicReference } from "virtual:fig-tanstack-start/payload-manifest";
import {
  initialPayloadResponse,
  registerPayloadResponse,
} from "./payload-internal.ts";

export type IsomorphicProps<TComponent extends ComponentType<any>> = Omit<
  ComponentProps<TComponent>,
  "component"
> & {
  component: TComponent;
};

/**
 * Marks one component use as an SSR-capable browser hydration boundary.
 * The TanStack Start compiler replaces `component` with a generated client
 * reference; application code keeps an ordinary static component import.
 */
export function Isomorphic<TComponent extends ComponentType<any>>(
  props: IsomorphicProps<TComponent>,
): FigNode {
  const { component, ...componentProps } = props;
  if (!isClientReference(component)) {
    throw new Error(
      "Isomorphic must receive a statically imported component through the Fig TanStack Start compiler.",
    );
  }
  return createElement(component, componentProps);
}

export interface PayloadResourceOptions<TInput> {
  debugArgs?: (input: TInput) => DataResourceKeyInput;
  key: (input: TInput) => DataResourceKey;
  render: (input: TInput) => FigNode;
}

/**
 * Declares a TanStack Start Payload route. The adapter compiles `render` into
 * a private server function and uses the result as a keyed Payload cache.
 */
export function payloadResource<TInput>(
  options: PayloadResourceOptions<TInput>,
): DataResource<[TInput], FigNode> {
  // The compiler replaces `render` with a generated `request` server function.
  const { request } = options as unknown as {
    request?: (
      input: TInput,
      context: DataResourceLoadContext,
    ) => Response | PromiseLike<Response>;
  };
  if (typeof request !== "function") {
    throw new Error(
      "payloadResource must be compiled by the Fig TanStack Start Vite plugin.",
    );
  }
  return dataResource({
    debugArgs: options.debugArgs,
    key: options.key,
    load: payloadDataLoader<[TInput]>({
      request: async (input, context) => {
        const key = options.key(input);
        const initial = initialPayloadResponse(key);
        if (initial !== undefined) return initial;
        const response = await request(input, context);
        return registerPayloadResponse(key, response);
      },
      resolveClientReference: resolveIsomorphicReference,
      retainAssets: typeof document === "undefined",
    }),
  });
}
