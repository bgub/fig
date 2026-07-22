import type { FigAssetResourceList } from "@bgub/fig";
import { createPayloadClientReferenceResolver } from "@bgub/fig/payload";

export const resolveIsomorphicReference = createPayloadClientReferenceResolver(
  () => undefined,
);

export function compiledIsomorphicReferenceAssets(): FigAssetResourceList {
  return [];
}
