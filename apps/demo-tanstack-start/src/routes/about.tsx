import type { FigNode } from "@bgub/fig";
import { createFileRoute } from "@tanstack/solid-router";

export const Route = createFileRoute("/about")({
  component: About,
  head: () => ({ meta: [{ title: "About · Fig TanStack Start" }] }),
});

function About(): FigNode {
  return (
    <section class="space-y-4" data-split-route="loaded">
      <h1 class="text-3xl font-semibold tracking-tight">About</h1>
      <p class="text-slate-700">
        This demo exercises the TanStack Start adapter end to end: server
        rendering, full-document hydration, client navigation, nested layouts,
        shared data resources, and server-only trees delivered through Payload.
      </p>
    </section>
  );
}
