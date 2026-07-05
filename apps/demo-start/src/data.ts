import { dataResource, type DataResourceKey } from "@bgub/fig-data";

export interface Post {
  body: string;
  id: string;
  title: string;
}

const POSTS: Record<string, Post> = {
  "1": {
    body: "Fig is a TypeScript re-implementation of React's modern runtime.",
    id: "1",
    title: "Hello Fig",
  },
  "2": {
    body: "fig-start adds file-based routing, loaders, and SSR on top of Fig.",
    id: "2",
    title: "File-based routing",
  },
  "3": {
    body: "Data resources stream in over Suspense and hydrate on the client.",
    id: "3",
    title: "Streaming data",
  },
};

export interface PostService {
  find(id: string): Promise<Post | undefined>;
}

export const postService: PostService = {
  async find(id) {
    await new Promise((resolve) => setTimeout(resolve, 400));
    return POSTS[id];
  },
};

export interface PostSummary {
  id: string;
  loadCount: number;
  source: "browser" | "server";
  title: string;
}

let summaryLoadCount = 0;

// Isomorphic data: this loader is safe in both the server and browser bundles.
export const postSummaryResource = dataResource<[string], PostSummary>({
  name: "PostSummary",
  key: (id: string) => ["post-summary", id],
  load: async (id: string) => {
    await new Promise((resolve) => setTimeout(resolve, 80));
    const post = POSTS[id];
    if (post === undefined) throw new Error(`No post with id "${id}".`);
    return {
      id,
      loadCount: ++summaryLoadCount,
      source: typeof document === "undefined" ? "server" : "browser",
      title: post.title,
    };
  },
});

export function postResourceKey(id: string): DataResourceKey {
  return ["server-post", id];
}
