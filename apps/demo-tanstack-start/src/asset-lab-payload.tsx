import { createPayloadComponent } from "@bgub/fig-dom";
import { serverPayload } from "@bgub/fig-tanstack-start/payload";
import {
  AssetLabPayload,
  AssetNotePayload,
} from "./asset-lab.payload.server.tsx";
import { delay } from "./posts.ts";

export const AssetLabPage = createPayloadComponent<Record<string, never>>({
  key: ["asset-lab-payload"],
  load: serverPayload(async () => {
    await delay(500);
    return <AssetLabPayload />;
  }),
});

export const AssetNote = createPayloadComponent<Record<string, never>>({
  key: ["asset-note-payload"],
  load: serverPayload(AssetNotePayload),
});
