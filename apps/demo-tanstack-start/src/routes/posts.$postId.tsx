import { type FigNode, readData } from "@bgub/fig";
import { ensureRouteData } from "@bgub/fig-tanstack-router";
import { createFileRoute } from "@tanstack/solid-router";
import { postPayload } from "../post-payload.tsx";

export const Route = createFileRoute("/posts/$postId")({
  component: PostRoute,
  loader: ({ context, params }) =>
    ensureRouteData(context, postPayload, params.postId),
});

function PostRoute(): FigNode {
  const { postId } = Route.useParams();
  return readData(postPayload, postId);
}
