import { type FigNode, ViewTransition } from "@bgub/fig";
import { Link } from "@bgub/fig-tanstack-router";
import { createFileRoute } from "@tanstack/solid-router";

export const Route = createFileRoute("/")({ component: Home });

function Home(): FigNode {
  return (
    <section class="space-y-4">
      <h1 class="text-3xl font-semibold tracking-tight">
        Welcome to Fig TanStack Start
      </h1>
      <p class="text-slate-700">
        Fig on TanStack orchestration: typed routes, nested layouts, route
        loaders, Payload server trees, and data that streams in over Suspense.
      </p>
      <p>
        <Link class="font-medium text-teal-700" to="/data">
          Explore data resources →
        </Link>
      </p>
      <p>
        <Link
          class="inline-block font-medium text-teal-700"
          to="/view-transitions"
          viewTransition
        >
          <ViewTransition
            default="fig-tanstack-route-title"
            enter="none"
            exit="none"
            name="start-vt-page-title"
            share="fig-tanstack-route-title"
          >
            <span class="inline-block" data-view-transition-surface="home-link">
              View transitions
            </span>
          </ViewTransition>
        </Link>
      </p>
    </section>
  );
}
