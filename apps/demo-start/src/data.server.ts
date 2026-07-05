import { serverDataResource } from "@bgub/fig-data/server";
import { postResourceKey, type Post, type PostService } from "./data.ts";

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
export const postResource = serverDataResource<
  [string],
  Post,
  {
    posts: PostService;
  }
>({
  name: "ServerPost",
  key: postResourceKey,
  load: async (id: string, { context }) => {
    const post = await context.posts.find(id);
    if (post === undefined) throw new Error(`No post with id "${id}".`);
    return post;
  },
});

// Server data with remote refresh: browser imports of this `.server.ts` export
// become a dataResource.remote(...) stub, so client refreshes call Fig Start's
// data endpoint instead of bundling this loader.
export const remotePostStatusResource = serverDataResource<
  [string],
  RemotePostStatus,
  { posts: PostService }
>({
  name: "RemotePostStatus",
  remote: true,
  key: (id: string) => ["remote-post-status", id],
  load: async (id: string, { context }) => {
    const post = await context.posts.find(id);
    if (post === undefined) throw new Error(`No post with id "${id}".`);
    return {
      id,
      refreshCount: nextRemoteRefreshCount(),
      source: "server-remote",
      title: post.title,
    };
  },
});
