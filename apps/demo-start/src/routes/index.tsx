import type { FigNode } from "@bgub/fig";
import { createFileRoute, Link } from "@bgub/fig-start";

export const Route = createFileRoute("/")({
  component: Home,
});

function Home(): FigNode {
  return (
    <section>
      <h1>Welcome to Fig Start</h1>
      <p>
        A file-based, SSR-first framework built on Fig: typed routes, nested
        layouts, route loaders, and data that streams in over Suspense.
      </p>
      <p>
        <Link to="/posts">Browse the posts →</Link>
      </p>
    </section>
  );
}
