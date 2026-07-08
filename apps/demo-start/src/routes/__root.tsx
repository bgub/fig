import { type FigNode, Suspense, useState } from "@bgub/fig";
import { on } from "@bgub/fig-dom";
import { createRootRoute, Link, Outlet } from "@bgub/fig-start";
import {
  browserThemePreference,
  type ThemePreference,
  setBrowserThemePreference,
} from "../theme.ts";

export const Route = createRootRoute({
  component: RootLayout,
  loader: ({ context }) => ({
    initialTheme: context.serverTheme ?? browserThemePreference(),
  }),
  notFoundComponent: NotFound,
});

function RootLayout(): FigNode {
  const { initialTheme } = Route.useLoaderData();
  const [theme, setTheme] = useState<ThemePreference>(initialTheme);

  return (
    <div class="fig-start-shell min-h-screen" data-theme={theme}>
      <div class="mx-auto max-w-3xl p-6">
        <header class="mb-6 flex flex-wrap items-baseline gap-4 border-b border-slate-300 pb-3">
          <strong class="text-slate-950">Fig Start</strong>
          <nav class="flex flex-wrap gap-3 text-sm font-medium text-teal-700">
            <Link to="/">Home</Link>
            <Link to="/about">About</Link>
            <Link to="/asset-lab">Assets</Link>
            <Link to="/data">Data</Link>
            <Link to="/dashboard">Dashboard</Link>
            <Link to="/view-transitions">Transitions</Link>
            <Link to="/posts">Posts</Link>
          </nav>
          <div
            aria-label="Theme"
            class="ml-auto inline-flex overflow-hidden rounded border border-slate-300"
            role="group"
          >
            <ThemeButton current={theme} setTheme={setTheme} value="system" />
            <ThemeButton current={theme} setTheme={setTheme} value="light" />
            <ThemeButton current={theme} setTheme={setTheme} value="dark" />
          </div>
        </header>
        <main class="min-w-0">
          <Suspense fallback={<p class="italic text-slate-500">Loading...</p>}>
            <Outlet />
          </Suspense>
        </main>
      </div>
    </div>
  );
}

function ThemeButton(props: {
  current: ThemePreference;
  setTheme: (theme: ThemePreference) => void;
  value: ThemePreference;
}): FigNode {
  const selected = props.current === props.value;
  return (
    <button
      aria-pressed={selected ? "true" : "false"}
      class="px-2.5 py-1.5 text-sm font-medium text-slate-800 hover:bg-slate-100"
      data-theme-choice={props.value}
      data-theme-selected={selected ? "" : undefined}
      events={[
        on("click", () => {
          setBrowserThemePreference(props.value);
          props.setTheme(props.value);
        }),
      ]}
      type="button"
    >
      {themeLabel(props.value)}
    </button>
  );
}

function themeLabel(theme: ThemePreference): string {
  return theme[0]?.toUpperCase() + theme.slice(1);
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
