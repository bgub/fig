import { type FigNode, Suspense } from "@bgub/fig";
import { createFileRoute } from "@tanstack/solid-router";
import { AssetLabPage, AssetNote } from "../asset-lab-payload.tsx";

export const Route = createFileRoute("/asset-lab")({
  component: AssetLabRoute,
  loader: ({ context }) => {
    context.data.preloadData(AssetLabPage, {});
    context.data.preloadData(AssetNote, {});
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
      <AssetLabPage />
      <AssetNote />
    </>
  );
}
