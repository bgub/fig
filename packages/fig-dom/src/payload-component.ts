import {
  type AwaitedFigNode,
  dataResource,
  type DataResource,
  type DataResourceKey,
  type DataResourceKeyInput,
  type FigNode,
  readData,
} from "@bgub/fig";
import { loadContextCapabilities } from "@bgub/fig/internal";
import {
  decodePayloadResponse,
  type PayloadDecoderOptions,
} from "./payload-decoder.ts";
import { encodePayloadKey } from "./payload-key.ts";

export type PayloadSource =
  | Response
  | {
      contentType: string;
      stream: ReadableStream<Uint8Array>;
    };

export interface PayloadComponentLoadContext {
  key: DataResourceKey;
  signal: AbortSignal;
}

export interface PayloadComponentLoader<
  TProps extends object,
> extends PayloadDecoderOptions {
  (
    props: TProps,
    context: PayloadComponentLoadContext,
  ): PayloadSource | PromiseLike<PayloadSource>;
}

export interface PayloadComponentOptions<
  TProps extends object,
> extends PayloadDecoderOptions {
  cacheKey?: (props: TProps) => DataResourceKeyInput;
  key: DataResourceKey;
  load: PayloadComponentLoader<TProps>;
}

export interface PayloadComponent<TProps extends object> extends DataResource<
  [TProps],
  AwaitedFigNode
> {
  (props: TProps & { children?: FigNode }): FigNode;
}

/**
 * Creates a renderable Payload tree backed by Fig's ordinary data store.
 */
export function createPayloadComponent<TProps extends object>(
  options: PayloadComponentOptions<TProps>,
): PayloadComponent<TProps> {
  const key = (props: TProps): DataResourceKey => {
    const serialized = serializedProps(props);
    return [
      ...options.key,
      options.cacheKey === undefined ? serialized : options.cacheKey(props),
    ];
  };
  const resource = dataResource<[TProps], AwaitedFigNode>({
    debugArgs: options.cacheKey === undefined ? undefined : serializedProps,
    key,
    load: async (props, context) => {
      const source = await options.load(props, {
        key: loadContextCapabilities(context)?.key ?? key(props),
        signal: context.signal,
      });
      const response =
        source instanceof Response
          ? source
          : new Response(source.stream, {
              headers: { "content-type": source.contentType },
            });
      return decodePayloadResponse(response, context, {
        prepareAssets: options.prepareAssets ?? options.load.prepareAssets,
        resolveClientReference:
          options.resolveClientReference ?? options.load.resolveClientReference,
        retainAssets: options.retainAssets ?? options.load.retainAssets,
      });
    },
  });

  const component: PayloadComponent<TProps> = Object.assign(
    function PayloadComponent(props: TProps & { children?: FigNode }): FigNode {
      rejectChildren(props);
      return readData(component, props);
    },
    resource,
  );
  Object.defineProperty(component, "displayName", {
    configurable: true,
    value: `Payload(${options.key[0]})`,
  });

  return component;
}

function serializedProps<TProps extends object>(
  props: TProps,
): DataResourceKeyInput {
  rejectChildren(props);
  return encodePayloadKey(props);
}

function rejectChildren(props: object): void {
  if (Object.hasOwn(props, "children")) {
    throw new Error("Payload components do not accept children.");
  }
}
