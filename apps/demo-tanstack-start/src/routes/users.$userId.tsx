import { type FigNode, readData, readDataStore } from "@bgub/fig";
import { on } from "@bgub/fig-dom";
import { ensureRouteData, Link, useParams } from "@bgub/fig-tanstack-router";
import { createFileRoute } from "@tanstack/solid-router";
import { changeUserRole } from "../user-functions.ts";
import { userResource } from "../user-resource.ts";

export const Route = createFileRoute("/users/$userId")({
  component: UserDetail,
  errorComponent: UserError,
  head: ({ params }) => ({ meta: [{ title: `${params.userId} · Fig Start` }] }),
  loader: ({ context, params }) =>
    ensureRouteData(context, userResource, params.userId),
});

function UserDetail(): FigNode {
  const { userId } = useParams({ from: "/users/$userId" });
  const user = readData(userResource, userId);
  return (
    <div class="space-y-6">
      <Link class="button button-quiet" to="/users">
        ← Users
      </Link>
      <article class="frame grid gap-7 border-data bg-data-tint p-6 sm:grid-cols-[auto_1fr] sm:p-8">
        <span class="frame-tag text-data">Fig data resource</span>
        <div class="grid size-20 place-items-center rounded-lg border-[1.5px] border-data bg-white font-mono text-lg font-semibold text-data">
          {user.initials}
        </div>
        <div>
          <span
            class="font-mono text-[10px] tracking-wide text-data uppercase"
            data-function-middleware={String(user.functionMiddleware)}
            data-generation={String(user.sequence)}
            data-loaded-by={user.loadedBy}
            data-request-id={user.requestId}
          >
            Loaded by {user.loadedBy} · generation {user.sequence}
          </span>
          <h1 class="mt-2 mb-0 text-3xl font-semibold tracking-[-0.02em]">
            {user.name}
          </h1>
          <p class="mt-1 font-mono text-xs text-data" data-user-role>
            {user.role}
          </p>
          <p class="mt-5 text-sm leading-6 text-muted">
            Resolved at <strong class="text-ink">{user.loadedAt}</strong>. The
            initial value came from SSR without a browser refetch. Invalidate it
            to watch the adopted client store load a fresh generation.
          </p>
          <button
            class="button mt-5 border-data bg-white text-data hover:bg-data-tint"
            mix={on("click", async (_event, signal) => {
              const data = readDataStore();
              await changeUserRole({ data: { id: userId }, signal });
              data.invalidateData(userResource, userId);
            })}
            type="button"
          >
            Change role on server
          </button>
        </div>
      </article>
    </div>
  );
}

function UserError({ error }: { error: unknown }): FigNode {
  return (
    <section class="frame border-data bg-data-tint p-6">
      <span class="frame-tag text-data">loader error</span>
      <h1 class="mt-1 text-xl font-semibold">Profile unavailable</h1>
      <p class="text-sm text-muted">
        {error instanceof Error ? error.message : "Unknown route error."}
      </p>
      <Link class="button button-quiet mt-4" to="/users">
        Return to users
      </Link>
    </section>
  );
}
