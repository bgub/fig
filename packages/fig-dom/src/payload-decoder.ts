import type { AwaitedFigNode, DataResourceLoadContext } from "@bgub/fig";
import {
  assertPayloadCodecMatches,
  jsonPayloadCodec,
  loadContextCapabilities,
} from "@bgub/fig/internal";
import {
  decodePayloadStream,
  type PayloadDecodeOptions,
} from "@bgub/fig/payload";
import { insertAssetResources } from "./asset-resources.ts";

declare const __FIG_DEV__: boolean | undefined;

const __DEV__ = typeof __FIG_DEV__ === "boolean" ? __FIG_DEV__ : false;
const noop = (): void => undefined;

export type PayloadDecoderOptions = Pick<
  PayloadDecodeOptions,
  "prepareAssets" | "resolveClientReference" | "retainAssets"
>;

/**
 * Decodes a validated Payload response within one data-resource generation.
 * The root becomes the entry value, streamed holes keep filling for the
 * generation's lifetime, `data` rows hydrate through its guarded capability,
 * and discovered assets enter the document with dependent reveal gates.
 */
export async function decodePayloadResponse(
  response: Response,
  context: DataResourceLoadContext,
  options: PayloadDecoderOptions = {},
): Promise<AwaitedFigNode> {
  const { signal } = context;
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

  const capabilities = loadContextCapabilities(context);
  return decodePayloadStream(body, {
    // Absent outside a data store: data rows are ignored rather than hydrated.
    hydrate: capabilities?.hydrate,
    onHoleError: capabilities?.attributeError,
    // Post-root failures surface through the rejected holes they strand;
    // observing the stream end keeps a failure that no longer has a pending
    // slot from being silently discarded in development.
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
    retainAssets: options.retainAssets,
    resolveClientReference: options.resolveClientReference,
    signal,
  });
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new Error("Payload request aborted.");
}
