import type { FigNode } from "@bgub/fig";
import { createFileRoute, Outlet } from "@bgub/fig-start";

// A layout route: wraps every /posts/* page and renders its child via <Outlet>.
export const Route = createFileRoute("/posts")({
  component: PostsLayout,
});

function PostsLayout(): FigNode {
  return (
    <section class="posts">
      <h1>Posts</h1>
      <Outlet />
    </section>
  );
}
