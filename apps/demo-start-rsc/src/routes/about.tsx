import type { FigNode } from "@bgub/fig";
import { createFileRoute } from "@bgub/fig-start";

export const Route = createFileRoute("/about")({
  component: About,
});

function About(): FigNode {
  return (
    <section>
      <h1>About</h1>
      <p>An isomorphic route, server-rendered and hydrated.</p>
    </section>
  );
}
