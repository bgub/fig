import { dataResource } from "@bgub/fig-data";

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

// A keyed async render input. Reading it suspends; on the server the value
// streams in over Suspense and is serialized for client hydration.
export const postResource = dataResource({
  key: (id: string) => ["post", id],
  load: async (id: string, { context }) => {
    const post = await context.posts.find(id);
    if (post === undefined) throw new Error(`No post with id "${id}".`);
    return post;
  },
});
