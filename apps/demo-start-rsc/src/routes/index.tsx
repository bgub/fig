import type { FigNode } from "@bgub/fig";
import { createFileRoute } from "@bgub/fig-start";

export const Route = createFileRoute("/")({
  component: Home,
});

function Home(): FigNode {
  return (
    <section>
      <h1>Fig Start RSC</h1>
      <p>Phase A: M1 SSR parity on a Vite-based build harness.</p>
    </section>
  );
}
