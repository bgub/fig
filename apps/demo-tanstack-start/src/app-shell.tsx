import type { FigNode } from "@bgub/fig";
import {
  getRouteApi,
  HeadContent,
  Link,
  MatchRoute,
  Outlet,
  Scripts,
  useMatches,
} from "@bgub/fig-tanstack-router";
import { StartData } from "@bgub/fig-tanstack-start";

const usersRouteApi = getRouteApi("/users/");

export function Document(): FigNode {
  const matchCount = useMatches({ select: (matches) => matches.length });
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
                <usersRouteApi.Link class="button button-quiet" to="/users">
                  Users
                </usersRouteApi.Link>
                <Link class="button button-quiet" to="/about">
                  Architecture
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
            <footer
              class="border-t border-line bg-white/60 px-5 py-4 font-mono text-[11px] text-muted sm:px-7"
              data-match-count={String(matchCount)}
            >
              Router hydration and route data cross the document independently;
              Fig owns the live cache.
              <MatchRoute fuzzy to="/users">
                <span class="ml-2 text-route" data-users-route-active>
                  Users branch active.
                </span>
              </MatchRoute>
            </footer>
          </div>
        </div>
        <StartData />
        <Scripts />
      </body>
    </html>
  );
}

export function NotFound(): FigNode {
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
