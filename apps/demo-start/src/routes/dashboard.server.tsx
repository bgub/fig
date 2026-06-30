import type { FigNode } from "@bgub/fig";
import { createFileRoute } from "@bgub/fig-start";
import { Island } from "../components/Island.tsx";

export const Route = createFileRoute("/dashboard")({
  component: Dashboard,
});

function Dashboard(): FigNode {
  return (
    <section class="space-y-4 rounded-lg border border-slate-300 bg-white p-5">
      <h1 class="text-3xl font-semibold tracking-tight">Dashboard</h1>
      <p class="text-slate-700">
        This route is a `.server.tsx` leaf. Its markup is delivered through the
        Fig RSC stream, and the button below is a client reference.
      </p>
      <Island />
    </section>
  );
}
