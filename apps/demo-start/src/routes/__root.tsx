import { type FigNode, Suspense } from "@bgub/fig";
import { createRootRoute, Link, Outlet } from "@bgub/fig-start";

export const Route = createRootRoute({
  component: RootLayout,
  notFoundComponent: NotFound,
});

function RootLayout(): FigNode {
  return (
    <div class="app">
      <header class="nav">
        <strong>Fig Start</strong>
        <nav>
          <Link to="/">Home</Link>
          <Link to="/about">About</Link>
          <Link to="/posts">Posts</Link>
        </nav>
      </header>
      <main>
        <Suspense fallback={<p class="loading">Loading…</p>}>
          <Outlet />
        </Suspense>
      </main>
    </div>
  );
}

function NotFound(): FigNode {
  return (
    <section>
      <h1>404</h1>
      <p>That page does not exist.</p>
      <p>
        <Link to="/">Go home</Link>
      </p>
    </section>
  );
}
