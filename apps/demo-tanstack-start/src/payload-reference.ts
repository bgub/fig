import { clientReference } from "@bgub/fig";
import { createPayloadClientReferenceResolver } from "@bgub/fig/payload";

const assetIslandReferenceId =
  "src/components/AssetLabIsland.tsx#AssetLabIsland";

export const AssetLabIslandReference = clientReference({
  id: assetIslandReferenceId,
});

export const resolvePayloadClientReference =
  createPayloadClientReferenceResolver((reference) => {
    if (reference.id !== assetIslandReferenceId) return undefined;
    return import("./components/AssetLabIsland.tsx").then(
      (module) => module.AssetLabIsland,
    );
  });
