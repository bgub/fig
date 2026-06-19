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
    <article class="post">
      <h2>{post.title}</h2>
      <p>{post.body}</p>
      <p class="meta">
        route param: {postId} · loader requestedId: {requestedId}
      </p>
      <p>
        <Link to="/posts">← Back to posts</Link>
      </p>
    </article>
  );
}
