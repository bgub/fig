import type { FigNode } from "@bgub/fig";
import { ensureRouteData } from "@bgub/fig-tanstack-router";
import { createFileRoute } from "@tanstack/solid-router";
import { PostPage } from "../post-payload.tsx";

export const Route = createFileRoute("/posts/$postId")({
  component: PostRoute,
  loader: ({ context, params }) =>
    ensureRouteData(context, PostPage, { id: params.postId }),
});

function PostRoute(): FigNode {
  const { postId } = Route.useParams();
  return <PostPage id={postId} />;
}
