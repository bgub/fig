export interface Post {
  body: string;
  id: string;
  title: string;
}

export const posts: Record<string, Post> = {
  "1": {
    body: "Fig is a TypeScript re-implementation of React's modern runtime.",
    id: "1",
    title: "Hello Fig",
  },
  "2": {
    body: "Fig TanStack Start combines TanStack orchestration with Fig rendering.",
    id: "2",
    title: "Adapter-first routing",
  },
  "3": {
    body: "Data resources and Payload trees stream over Suspense and hydrate on the client.",
    id: "3",
    title: "Streaming data",
  },
};

export function requirePost(id: string): Post {
  const post = posts[id];
  if (post === undefined) throw new Error(`No post with id "${id}".`);
  return post;
}

export function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
