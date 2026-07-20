import { assets, type FigNode, stylesheet } from "@bgub/fig";
import styleUrl from "./asset-lab.css?url";
import { AssetLabIslandReference } from "./payload-reference.ts";

export function AssetLabPayload(): FigNode {
  return assets(
    stylesheet(styleUrl, { precedence: "payload" }),
    <section class="asset-lab-root" data-asset-lab>
      <div>
        <h1 class="asset-lab-title">Asset lab</h1>
        <p class="asset-lab-copy">
          This server-only Payload component imports its own stylesheet, then
          renders a client island with a separate CSS module and SVG asset.
        </p>
      </div>
      <AssetLabIslandReference />
    </section>,
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
