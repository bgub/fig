import type { FigNode } from "@bgub/fig";
import { createFileRoute, Link } from "@bgub/fig-start";

export const Route = createFileRoute("/posts/")({
  component: PostsIndex,
});

function PostsIndex(): FigNode {
  return (
    <ul class="list-disc space-y-1 pl-5 leading-8 text-teal-700">
      <li>
        <Link to="/posts/1">Hello Fig</Link>
      </li>
      <li>
        <Link to="/posts/2">File-based routing</Link>
      </li>
      <li>
        <Link to="/posts/3">Streaming data</Link>
      </li>
    </ul>
  );
}
