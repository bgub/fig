import type { FigNode } from "@bgub/fig";
import { createFileRoute } from "@bgub/fig-start";

export const Route = createFileRoute("/about")({
  component: About,
});

function About(): FigNode {
  return (
    <section>
      <h1>About</h1>
      <p>
        This demo exercises the fig-start runtime end to end: server rendering,
        client hydration, client-side navigation, nested layouts, and a route
        whose data streams in.
      </p>
    </section>
  );
}
