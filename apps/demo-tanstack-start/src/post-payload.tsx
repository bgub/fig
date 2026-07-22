import { payloadResource } from "@bgub/fig-tanstack-start/payload";
import { PostPayload } from "./post.payload.server.tsx";

export const postPayload = payloadResource<string>({
  key: (id) => ["post-payload", id],
  render: (id) => <PostPayload id={id} />,
});
