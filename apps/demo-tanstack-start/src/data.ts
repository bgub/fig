import { dataResource, type DataResourceKey } from "@bgub/fig";
import { delay, posts } from "./posts.ts";
import { getInitialTheme, getRemotePostStatus } from "./server-functions.ts";
import type { ThemePreference } from "./theme.ts";

export interface PostSummary {
  id: string;
  loadCount: number;
  source: "browser" | "server";
  title: string;
}

export interface RemotePostStatus {
  id: string;
  refreshCount: number;
  source: "server-remote";
  title: string;
}

let summaryLoadCount = 0;

export function postSummaryResourceKey(id: string): DataResourceKey {
  return ["post-summary", id];
}

export const postSummaryResource = dataResource<[string], PostSummary>({
  key: postSummaryResourceKey,
  load: async (id) => {
    await delay(80);
    const post = posts[id];
    if (post === undefined) throw new Error(`No post with id "${id}".`);
    return {
      id,
      loadCount: ++summaryLoadCount,
      source: typeof document === "undefined" ? "server" : "browser",
      title: post.title,
    };
  },
});

export const remotePostStatusResource = dataResource<
  [string],
  RemotePostStatus
>({
  key: (id) => ["remote-post-status", id],
  load: (id, { signal }) => getRemotePostStatus({ data: { id }, signal }),
});

export const initialThemeResource = dataResource<[], ThemePreference>({
  key: () => ["initial-theme"],
  load: ({ signal }) => getInitialTheme({ signal }),
});
