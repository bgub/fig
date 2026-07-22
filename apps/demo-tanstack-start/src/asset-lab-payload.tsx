import { createServerFn } from "@bgub/fig-tanstack-start";
import { payloadResource } from "@bgub/fig-tanstack-start/payload";
import { renderPayloadResponse } from "@bgub/fig-tanstack-start/server";
import { AssetLabPayload, AssetNotePayload } from "./asset-lab.server.tsx";
import { delay } from "./posts.ts";

const getAssetLabPayload = createServerFn().handler(async () => {
  await delay(500);
  return renderPayloadResponse(<AssetLabPayload />);
});

export const assetLabPayload = payloadResource<void>({
  key: () => ["asset-lab-payload"],
  request: (_input, { signal }) => getAssetLabPayload({ signal }),
});

const getAssetNotePayload = createServerFn().handler(() =>
  renderPayloadResponse(<AssetNotePayload />),
);

export const assetNotePayload = payloadResource<void>({
  key: () => ["asset-note-payload"],
  request: (_input, { signal }) => getAssetNotePayload({ signal }),
});
