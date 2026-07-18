import {
  dataResource,
  type FigNode,
  invalidateData,
  readData,
} from "@bgub/fig";
import { on } from "@bgub/fig-dom";
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  ensureRouteData,
  HeadContent,
  Link,
  Outlet,
  Scripts,
  useParams,
} from "@bgub/fig-tanstack-router";
import {
  createStartDataContext,
  type StartDataContext,
  StartData,
} from "@bgub/fig-tanstack-start";

interface UserRecord {
  id: string;
  initials: string;
  name: string;
  role: string;
}

interface UserSnapshot extends UserRecord {
  loadedAt: string;
  loadedBy: "browser" | "server";
  sequence: number;
}

const users = {
  ada: {
    id: "ada",
    initials: "AL",
    name: "Ada Lovelace",
    role: "Router architect",
  },
  grace: {
    id: "grace",
    initials: "GH",
    name: "Grace Hopper",
    role: "Data systems engineer",
  },
} satisfies Record<string, UserRecord>;

let loadSequence = 0;

const userResource = dataResource<[string], UserSnapshot>({
  key: (id) => ["start-demo-user", id],
  load: async (id) => {
    await delay(180);
    const user = users[id as keyof typeof users];
    if (user === undefined) throw new Error(`Unknown user “${id}”.`);
    loadSequence += 1;
    return {
      ...user,
      loadedAt: new Date().toLocaleTimeString(),
      loadedBy: typeof document === "undefined" ? "server" : "browser",
      sequence: loadSequence,
    };
  },
});

const rootRoute = createRootRouteWithContext<StartDataContext>()({
  component: Document,
  head: () => ({
    links: [{ href: "/style.css", precedence: "app", rel: "stylesheet" }],
    meta: [
      { title: "Fig × TanStack Start" },
      {
        content: "A streamed TanStack Start runtime demo rendered by Fig.",
        name: "description",
      },
    ],
  }),
  notFoundComponent: NotFound,
  scripts: () => [{ src: "/client.js", type: "module" }],
});

const homeRoute = createRoute({
  component: Home,
  getParentRoute: () => rootRoute,
  path: "/",
});

const usersRoute = createRoute({
  component: UserDirectory,
  getParentRoute: () => rootRoute,
  path: "users",
});

const userRoute = createRoute({
  component: UserDetail,
  errorComponent: UserError,
  getParentRoute: () => rootRoute,
  head: ({ params }) => ({ meta: [{ title: `${params.userId} · Fig Start` }] }),
  loader: ({ context, params }) =>
    ensureRouteData(context, userResource, params.userId),
  path: "users/$userId",
});

const routeTree = rootRoute.addChildren([homeRoute, usersRoute, userRoute]);

export function createAppRouter(options: { isServer?: boolean } = {}) {
  return createRouter({
    ...createStartDataContext(),
    defaultPendingMs: 0,
    isServer: options.isServer,
    routeTree,
  });
}

export type AppRouter = ReturnType<typeof createAppRouter>;

declare module "@tanstack/router-core" {
  interface Register {
    router: AppRouter;
  }
}

function Document(): FigNode {
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <HeadContent />
      </head>
      <body>
        <div class="mx-auto min-h-screen max-w-5xl px-4 py-10 sm:px-6">
          <div class="frame flex min-h-[calc(100vh-5rem)] flex-col border-line">
            <span class="frame-tag text-route">streamed document</span>
            <header class="flex flex-wrap items-center gap-4 border-b border-line px-5 py-5 sm:px-7">
              <Link
                class="flex items-center gap-3 text-ink no-underline"
                to="/"
              >
                <span class="grid size-9 place-items-center rounded-md border-[1.5px] border-fig bg-fig-tint font-serif text-lg font-semibold text-fig">
                  F
                </span>
                <span class="grid leading-tight">
                  <strong class="text-sm font-semibold">Fig</strong>
                  <small class="font-mono text-[10px] tracking-wide text-muted uppercase">
                    × TanStack Start
                  </small>
                </span>
              </Link>
              <nav class="flex gap-1" aria-label="Primary navigation">
                <Link class="button button-quiet" to="/">
                  Overview
                </Link>
                <Link class="button button-quiet" to="/users">
                  Users
                </Link>
              </nav>
              <span class="ml-auto inline-flex items-center gap-2 rounded-full border border-fig bg-fig-tint px-2.5 py-1 font-mono text-[10px] tracking-wide text-fig uppercase">
                <span class="size-1.5 rounded-full bg-current" />
                SSR ready
              </span>
            </header>
            <main class="flex-1 px-5 py-8 sm:px-7 sm:py-10">
              <Outlet />
            </main>
            <footer class="border-t border-line bg-white/60 px-5 py-4 font-mono text-[11px] text-muted sm:px-7">
              Router hydration and route data cross the document independently;
              Fig owns the live cache.
            </footer>
          </div>
        </div>
        <StartData />
        <Scripts />
      </body>
    </html>
  );
}

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
        <Link class="button button-route mt-6" to="/users">
          Inspect a server-loaded route
        </Link>
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
    </div>
  );
}

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
            data-loaded-by={user.loadedBy}
          >
            Loaded by {user.loadedBy} · generation {user.sequence}
          </span>
          <h1 class="mt-2 mb-0 text-3xl font-semibold tracking-[-0.02em]">
            {user.name}
          </h1>
          <p class="mt-1 font-mono text-xs text-data">{user.role}</p>
          <p class="mt-5 text-sm leading-6 text-muted">
            Resolved at <strong class="text-ink">{user.loadedAt}</strong>. The
            initial value came from SSR without a browser refetch. Invalidate it
            to watch the adopted client store load a fresh generation.
          </p>
          <button
            class="button mt-5 border-data bg-white text-data hover:bg-data-tint"
            mix={on("click", () => invalidateData(userResource, userId))}
            type="button"
          >
            Invalidate Fig data
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

function NotFound(): FigNode {
  return (
    <section class="frame border-route bg-route-tint p-6">
      <span class="frame-tag text-route">404</span>
      <h1 class="mt-1 text-xl font-semibold">Route not found</h1>
      <Link class="button button-route mt-4" to="/">
        Return home
      </Link>
    </section>
  );
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
