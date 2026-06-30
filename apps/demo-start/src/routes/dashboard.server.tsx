import type { FigNode } from "@bgub/fig";
import { createFileRoute } from "@bgub/fig-start";
import { Island } from "./Island.tsx";

export const Route = createFileRoute("/dashboard")({
  component: Dashboard,
});

function Dashboard(): FigNode {
  return (
    <section class="dashboard">
      <h1>Dashboard</h1>
      <p>
        This route is a `.server.tsx` leaf. Its markup is delivered through the
        Fig RSC stream, and the button below is a client reference.
      </p>
      <Island />
    </section>
  );
}
