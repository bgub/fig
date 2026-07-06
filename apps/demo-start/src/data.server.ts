import { serverDataResource } from "@bgub/fig/server";
import { remoteDataResource } from "@bgub/fig-start/server";
import { postResourceKey, postService, type Post } from "./data.ts";

export interface RemotePostStatus {
  id: string;
  refreshCount: number;
  source: "server-remote";
  title: string;
}

const remoteRefreshCountKey = "__figDemoStartRemoteRefreshCount";

function nextRemoteRefreshCount(): number {
  const state = globalThis as Record<string, unknown>;
  const current =
    typeof state[remoteRefreshCountKey] === "number"
      ? state[remoteRefreshCountKey]
      : 0;
  const next = current + 1;
  state[remoteRefreshCountKey] = next;
  return next;
}

// Server-only data: server route payloads can read this loader, while browser
// bundles never import this route-only resource.
export const postResource = serverDataResource<[string], Post>({
  key: postResourceKey,
  load: async (id: string) => {
    const post = await postService.find(id);
    if (post === undefined) throw new Error(`No post with id "${id}".`);
    return post;
  },
});

// Server data with remote refresh: browser imports of this `.server.ts` export
// become a plain dataResource whose loader calls Fig Start's data endpoint,
// so client refreshes never bundle this loader.
export const remotePostStatusResource = remoteDataResource<
  [string],
  RemotePostStatus
>({
  key: (id: string) => ["remote-post-status", id],
  load: async (id: string) => {
    const post = await postService.find(id);
    if (post === undefined) throw new Error(`No post with id "${id}".`);
    return {
      id,
      refreshCount: nextRemoteRefreshCount(),
      source: "server-remote",
      title: post.title,
    };
  },
});
