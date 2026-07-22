import { dataResource, type FigNode, readData, Suspense } from "@bgub/fig";
import { delay, requirePost, type Post } from "./posts.ts";

const postResource = dataResource<[string], Post>({
  key: (id) => ["server-post", id],
  load: async (id) => {
    await delay(400);
    return requirePost(id);
  },
});

export function PostPayload(props: { id: string }): FigNode {
  return (
    <Suspense
      fallback={
        <p class="italic text-slate-500" data-post-pending>
          Loading post…
        </p>
      }
    >
      <PostContent {...props} />
    </Suspense>
  );
}

function PostContent(props: { id: string }): FigNode {
  const post = readData(postResource, props.id);
  return (
    <article class="space-y-4 rounded-lg border border-slate-300 bg-white p-5">
      <h2 class="text-2xl font-semibold tracking-tight">{post.title}</h2>
      <p class="text-slate-700">{post.body}</p>
      <p class="text-sm text-slate-500" data-server-post="true">
        server-only Payload resource · route param: {props.id}
      </p>
      <p>
        <a class="font-medium text-teal-700" href="/posts">
          ← Back to posts
        </a>
      </p>
    </article>
  );
}
