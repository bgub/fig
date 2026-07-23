import {
  createElement,
  type ComponentProps,
  type ComponentType,
  type FigNode,
} from "@bgub/fig";
import { isClientReference } from "@bgub/fig/internal";
import type { PayloadComponentLoader } from "@bgub/fig-dom";
import { resolveIsomorphicReference } from "virtual:fig-tanstack-start/payload-manifest";
import {
  initialPayloadResponse,
  registerPayloadResponse,
} from "./payload-internal.ts";

const compiledServerPayloadMarker = Symbol.for(
  "fig.tanstack-start.compiled-server-payload",
);

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

/**
 * Compiles a server component into a TanStack server function that returns a
 * Payload stream. Pass the result to createPayloadComponent from @bgub/fig-dom.
 */
export function serverPayload<TProps extends object>(
  render: (props: TProps) => FigNode,
): PayloadComponentLoader<TProps> {
  // The compiler replaces `render` with the generated server-function proxy.
  const request = render as unknown as PayloadComponentLoader<TProps> & {
    [compiledServerPayloadMarker]?: true;
  };
  if (request[compiledServerPayloadMarker] !== true) {
    throw new Error(
      "serverPayload must be compiled by the Fig TanStack Start Vite plugin.",
    );
  }
  const load: PayloadComponentLoader<TProps> = async (props, context) => {
    const initial = initialPayloadResponse(context.key);
    if (initial !== undefined) return initial;

    const response = await request(props, context);
    if (!(response instanceof Response)) {
      throw new Error(
        "The compiled serverPayload request did not return a Response.",
      );
    }
    return registerPayloadResponse(context.key, response);
  };
  load.resolveClientReference = resolveIsomorphicReference;
  load.retainAssets = typeof document === "undefined";
  return load;
}
