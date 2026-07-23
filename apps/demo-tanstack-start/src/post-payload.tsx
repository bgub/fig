import { createPayloadComponent } from "@bgub/fig-dom";
import { serverPayload } from "@bgub/fig-tanstack-start/payload";
import { PostPayload } from "./post.payload.server.tsx";

export const PostPage = createPayloadComponent<{ id: string }>({
  key: ["post-payload"],
  load: serverPayload(PostPayload),
});
