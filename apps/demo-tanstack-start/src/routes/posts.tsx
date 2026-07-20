import type { FigNode } from "@bgub/fig";
import { Outlet } from "@bgub/fig-tanstack-router";
import { createFileRoute } from "@tanstack/solid-router";

export const Route = createFileRoute("/posts")({ component: PostsLayout });

function PostsLayout(): FigNode {
  return (
    <section class="space-y-4">
      <h1 class="text-3xl font-semibold tracking-tight">Posts</h1>
      <Outlet />
    </section>
  );
}
