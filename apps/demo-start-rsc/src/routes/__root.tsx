import { type FigNode, Suspense } from "@bgub/fig";
import { createRootRoute, Link, Outlet } from "@bgub/fig-start";

export const Route = createRootRoute({
  component: RootLayout,
  notFoundComponent: () => <p>Not found.</p>,
});

function RootLayout(): FigNode {
  return (
    <div class="app">
      <header>
        <strong>Fig Start RSC</strong>
        <nav>
          <Link to="/">Home</Link>
          <Link to="/about">About</Link>
          <Link to="/dashboard">Dashboard</Link>
        </nav>
      </header>
      <main>
        <Suspense fallback={<p>Loading…</p>}>
          <Outlet />
        </Suspense>
      </main>
    </div>
  );
}
