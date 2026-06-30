import { type FigNode, Suspense } from "@bgub/fig";
import { createRootRoute, Link, Outlet } from "@bgub/fig-start";

export const Route = createRootRoute({
  component: RootLayout,
  notFoundComponent: NotFound,
});

function RootLayout(): FigNode {
  return (
    <div class="mx-auto max-w-3xl p-6">
      <header class="mb-6 flex items-baseline gap-4 border-b border-slate-300 pb-3">
        <strong class="text-slate-950">Fig Start</strong>
        <nav class="flex gap-3 text-sm font-medium text-teal-700">
          <Link to="/">Home</Link>
          <Link to="/about">About</Link>
          <Link to="/asset-lab">Assets</Link>
          <Link to="/dashboard">Dashboard</Link>
          <Link to="/posts">Posts</Link>
        </nav>
      </header>
      <main class="min-w-0">
        <Suspense fallback={<p class="italic text-slate-500">Loading…</p>}>
          <Outlet />
        </Suspense>
      </main>
    </div>
  );
}

function NotFound(): FigNode {
  return (
    <section class="space-y-4">
      <h1 class="text-3xl font-semibold tracking-tight">404</h1>
      <p class="text-slate-700">That page does not exist.</p>
      <p>
        <Link class="font-medium text-teal-700" to="/">
          Go home
        </Link>
      </p>
    </section>
  );
}
