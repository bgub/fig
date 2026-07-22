import { payloadResource } from "@bgub/fig-tanstack-start/payload";
import {
  AssetLabPayload,
  AssetNotePayload,
} from "./asset-lab.payload.server.tsx";
import { delay } from "./posts.ts";

export const assetLabPayload = payloadResource<void>({
  key: () => ["asset-lab-payload"],
  render: async () => {
    await delay(500);
    return <AssetLabPayload />;
  },
});

export const assetNotePayload = payloadResource<void>({
  key: () => ["asset-note-payload"],
  render: () => <AssetNotePayload />,
});
