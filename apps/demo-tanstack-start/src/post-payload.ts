import { payloadResource } from "@bgub/fig-tanstack-start/payload";
import { getPostPayload } from "./payload-functions.tsx";

export const postPayload = payloadResource<string>({
  key: (id) => ["post-payload", id],
  request: (id, { signal }) => getPostPayload({ data: { id }, signal }),
});
