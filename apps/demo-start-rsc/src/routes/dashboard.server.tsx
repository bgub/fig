import type { FigNode } from "@bgub/fig";
import { createFileRoute } from "@bgub/fig-start";
import { Island } from "./Island.tsx";

// A server (RSC) route: rendered through Fig's RSC stream, never shipped to the
// client. The Island import below is rewritten to a client reference by the
// @bgub/fig-start/vite plugin.
export const Route = createFileRoute("/dashboard")({
  component: Dashboard,
  server: true,
});

function Dashboard(): FigNode {
  return (
    <section>
      <h1>Dashboard</h1>
      <p>This markup was rendered on the server as an RSC payload.</p>
      <Island />
    </section>
  );
}
