import { type FigNode, readData } from "@bgub/fig";
import { ensureRouteData } from "@bgub/fig-tanstack-router";
import { createFileRoute } from "@tanstack/solid-router";
import { assetLabPayload, assetNotePayload } from "../payload-resource.ts";

export const Route = createFileRoute("/asset-lab")({
  component: AssetLabRoute,
  loader: async ({ context }) => {
    await Promise.all([
      ensureRouteData(context, assetLabPayload, undefined),
      ensureRouteData(context, assetNotePayload, undefined),
    ]);
  },
});

function AssetLabRoute(): FigNode {
  return (
    <>
      {readData(assetLabPayload, undefined)}
      {readData(assetNotePayload, undefined)}
    </>
  );
}
