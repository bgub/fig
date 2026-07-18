import type { FigNode } from "@bgub/fig";
import { createLazyFileRoute } from "@tanstack/solid-router";

export const Route = createLazyFileRoute("/about")({ component: Architecture });

function Architecture(): FigNode {
  return (
    <section class="frame border-fig bg-fig-tint p-6" data-lazy-route="loaded">
      <span class="frame-tag text-fig">lazy file route</span>
      <h1 class="mt-1 text-2xl font-semibold">One cache, two owners</h1>
      <p class="mt-3 max-w-2xl text-sm leading-6 text-muted">
        TanStack owns request and route orchestration. Fig owns rendering, data
        resources, asset resources, and hydration. This component arrived from a
        generated lazy route chunk.
      </p>
    </section>
  );
}
