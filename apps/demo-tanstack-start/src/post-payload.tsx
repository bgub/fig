import { createServerFn } from "@bgub/fig-tanstack-start";
import { payloadResource } from "@bgub/fig-tanstack-start/payload";
import { renderPayloadResponse } from "@bgub/fig-tanstack-start/server";
import { PostPayload } from "./post.server.tsx";
import { validatePostId } from "./server-functions.ts";

const getPostPayload = createServerFn()
  .validator(validatePostId)
  .handler(({ data }) => renderPayloadResponse(<PostPayload id={data.id} />));

export const postPayload = payloadResource<string>({
  key: (id) => ["post-payload", id],
  request: (id, { signal }) => getPostPayload({ data: { id }, signal }),
});
