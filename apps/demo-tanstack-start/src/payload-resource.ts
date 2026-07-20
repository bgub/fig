import { payloadResource } from "@bgub/fig-tanstack-start/payload";
import {
  getAssetLabPayload,
  getAssetNotePayload,
} from "./payload-functions.tsx";
import { resolvePayloadClientReference } from "./payload-reference.ts";

export const assetLabPayload = payloadResource<void>({
  key: () => ["asset-lab-payload"],
  request: (_input, { signal }) => getAssetLabPayload({ signal }),
  resolveClientReference: resolvePayloadClientReference,
});

export const assetNotePayload = payloadResource<void>({
  key: () => ["asset-note-payload"],
  request: (_input, { signal }) => getAssetNotePayload({ signal }),
});
