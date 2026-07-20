import type { FigNode } from "@bgub/fig";
import { Link } from "@bgub/fig-tanstack-router";
import { createFileRoute } from "@tanstack/solid-router";

export const Route = createFileRoute("/posts/")({ component: PostsIndex });

function PostsIndex(): FigNode {
  return (
    <ul class="list-disc space-y-1 pl-5 leading-8 text-teal-700">
      <li>
        <Link params={{ postId: "1" }} to="/posts/$postId">
          Hello Fig
        </Link>
      </li>
      <li>
        <Link params={{ postId: "2" }} to="/posts/$postId">
          Adapter-first routing
        </Link>
      </li>
      <li>
        <Link params={{ postId: "3" }} to="/posts/$postId">
          Streaming data
        </Link>
      </li>
    </ul>
  );
}
