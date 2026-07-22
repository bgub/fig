declare module "virtual:fig-tanstack-start/payload-manifest" {
  import type { FigAssetResourceList } from "@bgub/fig";
  import type {
    PayloadClientReference,
    PayloadClientReferenceResolver,
  } from "@bgub/fig/payload";

  export const resolveIsomorphicReference: PayloadClientReferenceResolver;
  export function compiledIsomorphicReferenceAssets(
    reference: Pick<PayloadClientReference, "id">,
  ): FigAssetResourceList;
}
