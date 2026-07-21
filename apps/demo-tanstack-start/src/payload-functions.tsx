import { createElement } from "@bgub/fig";
import { createServerFn } from "@bgub/fig-tanstack-start";
import { renderPayloadResponse } from "@bgub/fig-tanstack-start/server";
import { AssetLabPayload, AssetNotePayload } from "./asset-lab.server.tsx";
import { delay } from "./posts.ts";
import { PostPayload } from "./post.server.tsx";
import { validatePostId } from "./server-functions.ts";

export const getAssetLabPayload = createServerFn({ method: "GET" }).handler(
  async () => {
    await delay(500);
    return renderPayloadResponse(createElement(AssetLabPayload));
  },
);

export const getAssetNotePayload = createServerFn({ method: "GET" }).handler(
  () => renderPayloadResponse(createElement(AssetNotePayload)),
);

export const getPostPayload = createServerFn({ method: "GET" })
  .validator(validatePostId)
  .handler(({ data }) =>
    renderPayloadResponse(createElement(PostPayload, data)),
  );
