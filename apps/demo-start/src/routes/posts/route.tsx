import type { FigNode } from "@bgub/fig";
import { createFileRoute, Outlet } from "@bgub/fig-start";

// A layout route: wraps every /posts/* page and renders its child via <Outlet>.
export const Route = createFileRoute("/posts")({
  component: PostsLayout,
});

function PostsLayout(): FigNode {
  return (
    <section class="space-y-4">
      <h1 class="text-3xl font-semibold tracking-tight">Posts</h1>
      <Outlet />
    </section>
  );
}
