import type { FigNode } from "@bgub/fig";
import { readData } from "@bgub/fig-data";
import { createFileRoute, Link } from "@bgub/fig-start";
import { postResource } from "../../data.ts";

export const Route = createFileRoute("/posts/$postId")({
  // Return-style loader: typed via Route.useLoaderData(), resolved before render.
  loader: ({ params }) => ({ requestedId: params.postId }),
  component: PostPage,
});

// Return type annotated to break the self-reference cycle (this component reads
// its own route's typed hooks).
function PostPage(): FigNode {
  const { postId } = Route.useParams();
  const { requestedId } = Route.useLoaderData();
  // Suspends until the post resolves; streams in on the server, refetches on
  // client navigation.
  const post = readData(postResource, postId);

  return (
    <article class="space-y-4 rounded-lg border border-slate-300 bg-white p-5">
      <h2 class="text-2xl font-semibold tracking-tight">{post.title}</h2>
      <p class="text-slate-700">{post.body}</p>
      <p class="text-sm text-slate-500">
        route param: {postId} · loader requestedId: {requestedId}
      </p>
      <p>
        <Link class="font-medium text-teal-700" to="/posts">
          ← Back to posts
        </Link>
      </p>
    </article>
  );
}
