import type { FigNode } from "@bgub/fig";
import { createFileRoute, Link } from "@bgub/fig-start";

export const Route = createFileRoute("/posts/")({
  component: PostsIndex,
});

function PostsIndex(): FigNode {
  return (
    <ul class="post-list">
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
