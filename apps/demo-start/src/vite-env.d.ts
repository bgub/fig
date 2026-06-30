declare module "virtual:fig-start/client-manifest" {
  export function loadClientReference(metadata: {
    id: string;
  }): Promise<unknown>;
}

declare module "virtual:fig-start/server-manifest" {
  import type { FigResourceList } from "@bgub/fig";

  export function resolveClientReferenceAssets(metadata: {
    id: string;
  }): FigResourceList;
}
