import type {
  DataResourceLoadContext,
  DataResourceLoader,
  FigNode,
} from "@bgub/fig";
import type { FigAssetResource } from "@bgub/fig";
import {
  assertPayloadCodecMatches,
  jsonPayloadCodec,
  loadContextHydrate,
} from "@bgub/fig/internal";
import {
  decodePayloadStream,
  type ResolveClientReference,
} from "@bgub/fig/payload";
import { insertAssetResources } from "./asset-resources.ts";

declare const __FIG_DEV__: boolean | undefined;

const __DEV__ = typeof __FIG_DEV__ === "boolean" ? __FIG_DEV__ : false;
const noop = (): void => undefined;

export interface PayloadDataLoaderOptions<TArgs extends unknown[]> {
  /**
   * Overrides the asset-preparation step (default: insertAssetResources).
   * Frameworks wrap the default to observe stylesheet gates — e.g. holding a
   * navigation commit until the incoming route's assets settle.
   */
  prepareAssets?: (
    assets: readonly FigAssetResource[],
  ) => void | PromiseLike<void>;
  /**
   * Produces the payload response — typically a fetch of the framework's
   * serialized-component endpoint. Receives the resource arguments and the
   * load's generation-lifetime signal: it stays live after the root value
   * publishes and aborts when the entry is superseded, hydrated over,
   * evicted, or the store is disposed, cancelling background decoding.
   */
  request: DataResourceLoader<TArgs, Response>;
  /**
   * Resolves client-reference rows to components. Pass a stateful resolver
   * (created by `createPayloadClientReferenceResolver`, shared across
   * loaders that resolve the same references) to keep island identity
   * stable across the loader's decodes — refreshes, navigations.
   */
  resolveClientReference?: ResolveClientReference;
}

/**
 * Adapt a payload-stream endpoint into an ordinary data-resource loader: the
 * decoded root value becomes the entry value (renderable elements returned by
 * `readData`), streamed holes keep filling in the background for the life of
 * the load's generation, `data` rows hydrate the calling store through its
 * generation-guarded capability, and stream-discovered assets insert into the
 * document head with stylesheet gates delaying only dependent reveal.
 */
export function payloadDataLoader<TArgs extends unknown[]>(
  options: PayloadDataLoaderOptions<TArgs>,
): DataResourceLoader<TArgs, FigNode> {
  return async (...argsAndContext) => {
    const context = argsAndContext[
      argsAndContext.length - 1
    ] as DataResourceLoadContext;
    const args = argsAndContext.slice(0, -1) as TArgs;
    const signal = context.signal;

    const response = await options.request(...args, { signal });
    if (signal.aborted) {
      await response.body?.cancel().catch(noop);
      throw abortReason(signal);
    }
    if (!response.ok) {
      await response.body?.cancel().catch(noop);
      throw new Error(`Payload request failed with status ${response.status}.`);
    }
    const body = response.body;
    if (body === null) {
      throw new Error("Payload response did not include a body.");
    }
    try {
      assertPayloadCodecMatches(
        jsonPayloadCodec,
        response.headers.get("content-type"),
      );
    } catch (error) {
      await body.cancel().catch(noop);
      throw error;
    }

    return decodePayloadStream(body, {
      // Absent outside a data store (the loader called directly): data rows
      // are then ignored rather than hydrated.
      hydrate: loadContextHydrate(context),
      // Post-root failures surface through the rejected holes they strand;
      // observing the stream end keeps a failure that no longer has a
      // pending slot from being silently discarded in development.
      onStreamDone: (result) => {
        if (__DEV__ && result.status === "failed") {
          console.error(
            "Payload decode failed after its root value published:",
            result.error,
          );
        }
      },
      prepareAssets:
        options.prepareAssets ?? ((assets) => insertAssetResources(assets)),
      resolveClientReference: options.resolveClientReference,
      signal,
    });
  };
}

function abortReason(signal: AbortSignal): unknown {
  return (
    (signal as { reason?: unknown }).reason ??
    new Error("Payload request aborted.")
  );
}
