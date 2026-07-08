import { type FigNode, ViewTransition } from "@bgub/fig";
import { createFileRoute, Link } from "@bgub/fig-start";

export const Route = createFileRoute("/")({
  component: Home,
});

function Home(): FigNode {
  return (
    <section class="space-y-4">
      <h1 class="text-3xl font-semibold tracking-tight">
        Welcome to Fig Start
      </h1>
      <p class="text-slate-700">
        A file-based, SSR-first framework built on Fig: typed routes, nested
        layouts, route loaders, and data that streams in over Suspense.
      </p>
      <p>
        <Link class="font-medium text-teal-700" to="/data">
          Explore data resources →
        </Link>
      </p>
      <p>
        <ViewTransition
          default="fig-start-route-title"
          enter="none"
          name="start-vt-page-title"
          share="fig-start-route-title"
        >
          <Link
            class="inline-block font-medium text-teal-700"
            to="/view-transitions"
          >
            View transitions
          </Link>
        </ViewTransition>
      </p>
    </section>
  );
}
