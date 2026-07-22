import { type FigNode, readData, Suspense } from "@bgub/fig";
import { createFileRoute } from "@tanstack/solid-router";
import { assetLabPayload, assetNotePayload } from "../asset-lab-payload.tsx";

export const Route = createFileRoute("/asset-lab")({
  component: AssetLabRoute,
  loader: ({ context }) => {
    context.data.preloadData(assetLabPayload, undefined);
    context.data.preloadData(assetNotePayload, undefined);
  },
});

function AssetLabRoute(): FigNode {
  return (
    <Suspense
      fallback={
        <p class="italic text-slate-500" data-asset-lab-pending>
          Streaming asset payload…
        </p>
      }
    >
      <AssetLabContent />
    </Suspense>
  );
}

function AssetLabContent(): FigNode {
  return (
    <>
      {readData(assetLabPayload, undefined)}
      {readData(assetNotePayload, undefined)}
    </>
  );
}
