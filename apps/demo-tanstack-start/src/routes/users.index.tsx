import type { FigNode } from "@bgub/fig";
import { Link } from "@bgub/fig-tanstack-router";
import { createFileRoute } from "@tanstack/solid-router";
import { users } from "../users.ts";

export const Route = createFileRoute("/users/")({ component: UserDirectory });

function UserDirectory(): FigNode {
  return (
    <div class="space-y-7">
      <header>
        <div class="mb-2 font-mono text-[11px] font-semibold tracking-[0.12em] text-route uppercase">
          Route loaders
        </div>
        <h1 class="m-0 text-3xl font-semibold tracking-[-0.02em]">Users</h1>
        <p class="mt-3 max-w-2xl text-sm leading-6 text-muted">
          Open either profile directly or through client navigation. The same
          loader and data resource serve both paths.
        </p>
      </header>
      <section class="grid gap-5 sm:grid-cols-2">
        {Object.values(users).map((user) => (
          <Link
            class="frame group grid min-h-48 content-between border-route bg-route-tint p-5 text-ink no-underline transition-transform hover:-translate-y-0.5 hover:bg-white"
            key={user.id}
            params={{ userId: user.id }}
            preload="intent"
            to="/users/$userId"
          >
            <span class="frame-tag text-route">/users/{user.id}</span>
            <span class="grid size-11 place-items-center rounded-md border-[1.5px] border-route bg-white font-mono text-xs font-semibold text-route">
              {user.initials}
            </span>
            <span class="mt-8 grid gap-1">
              <strong>{user.name}</strong>
              <small class="font-mono text-[10px] tracking-wide text-route uppercase">
                {user.role}
              </small>
            </span>
          </Link>
        ))}
      </section>
      <Link
        class="button button-quiet"
        params={{ userId: "missing" }}
        to="/users/$userId"
      >
        Exercise a loader error
      </Link>
    </div>
  );
}
