import type { FigNode } from "@bgub/fig";
import { Isomorphic } from "@bgub/fig-tanstack-start/payload";
import "./asset-lab.css";
import payloadMarkHref from "./assets/payload-mark.svg?no-inline";
import { AssetLabIsland } from "./components/AssetLabIsland.tsx";

export function AssetLabPayload(): FigNode {
  return (
    <section class="asset-lab-root" data-asset-lab>
      <div>
        <div class="asset-lab-heading">
          <img
            alt=""
            class="asset-lab-mark"
            data-payload-image
            src={payloadMarkHref}
          />
          <h1 class="asset-lab-title">Asset lab</h1>
        </div>
        <p class="asset-lab-copy">
          This Payload-rendered component imports its own stylesheet, then
          renders server-emitted image, background, and font assets plus an
          explicitly isomorphic component with a separate CSS module and SVG
          asset.
        </p>
      </div>
      <Isomorphic component={AssetLabIsland} />
    </section>
  );
}

export function AssetNotePayload(): FigNode {
  return (
    <aside
      class="mt-4 rounded-lg border border-slate-300 bg-white p-4 text-sm text-slate-700"
      data-asset-note
    >
      A second Payload resource shares this document and is adopted without a
      second browser request.
    </aside>
  );
}
