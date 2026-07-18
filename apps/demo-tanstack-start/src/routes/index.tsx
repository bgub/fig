import type { FigNode } from "@bgub/fig";
import { Link } from "@bgub/fig-tanstack-router";
import { createFileRoute } from "@tanstack/solid-router";

export const Route = createFileRoute("/")({ component: Home });

function Home(): FigNode {
  return (
    <div class="space-y-10">
      <section class="max-w-3xl">
        <div class="mb-3 font-mono text-[11px] font-semibold tracking-[0.12em] text-fig uppercase">
          SSR runtime adapter
        </div>
        <h1 class="m-0 text-3xl leading-tight font-semibold tracking-[-0.025em] sm:text-4xl">
          TanStack loads the route.
          <span class="block text-fig">Fig owns the rendered data.</span>
        </h1>
        <p class="mt-5 max-w-2xl text-[15px] leading-7 text-muted">
          This document was streamed by Fig, dehydrated by TanStack Router, and
          hydrated through the TanStack Start client core. The data snapshot is
          serialized separately by Fig.
        </p>
        <div class="mt-6 flex flex-wrap gap-3">
          <Link class="button button-route" to="/users">
            Inspect a server-loaded route
          </Link>
          <Link class="button button-quiet" to="/legacy-users">
            Exercise a redirect
          </Link>
        </div>
      </section>
      <section class="grid gap-5 md:grid-cols-3">
        <Capability
          label="01 · server"
          text="A TanStack loader fills a root-neutral Fig data store before rendering."
          tone="text-route"
        />
        <Capability
          label="02 · document"
          text="Fig streams the route and embeds its own encoded data snapshot."
          tone="text-data"
        />
        <Capability
          label="03 · client"
          text="Full-document hydration adopts the decoded store without refetching."
          tone="text-fig"
        />
      </section>
    </div>
  );
}

function Capability(props: {
  label: string;
  text: string;
  tone: string;
}): FigNode {
  return (
    <article class="frame min-h-44 border-line p-5">
      <span class={`frame-tag ${props.tone}`}>{props.label}</span>
      <p class="mt-2 text-sm leading-6 text-muted">{props.text}</p>
    </article>
  );
}
