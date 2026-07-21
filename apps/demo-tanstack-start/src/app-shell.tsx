import { type FigNode, Suspense, useState } from "@bgub/fig";
import { on } from "@bgub/fig-dom";
import { HeadContent, Link, Outlet, Scripts } from "@bgub/fig-tanstack-router";
import { StartData } from "@bgub/fig-tanstack-start";
import { setBrowserThemePreference, type ThemePreference } from "./theme.ts";

export function Document(props: { initialTheme: ThemePreference }): FigNode {
  const [theme, setTheme] = useState<ThemePreference>(props.initialTheme);

  return (
    <html class={theme} lang="en" suppressHydrationWarning>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <HeadContent />
      </head>
      <body>
        <div
          bind={(element) => {
            element.setAttribute("data-fig-tanstack-start-hydrated", "");
            return undefined;
          }}
          class="fig-tanstack-shell min-h-screen"
          data-theme={theme}
        >
          <div class="mx-auto max-w-3xl p-6">
            <header class="mb-6 flex flex-wrap items-baseline gap-4 border-b border-slate-300 pb-3">
              <strong class="text-slate-950">Fig TanStack Start</strong>
              <nav class="flex flex-wrap gap-3 text-sm font-medium text-teal-700">
                <Link to="/">Home</Link>
                <Link to="/about">About</Link>
                <Link to="/asset-lab">Assets</Link>
                <Link to="/data">Data</Link>
                <Link to="/view-transitions">Transitions</Link>
                <Link to="/posts">Posts</Link>
              </nav>
              <div
                aria-label="Theme"
                class="ml-auto inline-flex overflow-hidden rounded border border-slate-300"
                role="group"
              >
                <ThemeButton
                  current={theme}
                  setTheme={setTheme}
                  value="system"
                />
                <ThemeButton
                  current={theme}
                  setTheme={setTheme}
                  value="light"
                />
                <ThemeButton current={theme} setTheme={setTheme} value="dark" />
              </div>
            </header>
            <main class="min-w-0">
              <Suspense
                fallback={<p class="italic text-slate-500">Loading...</p>}
              >
                <Outlet />
              </Suspense>
            </main>
          </div>
        </div>
        <StartData />
        <Scripts />
      </body>
    </html>
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
      mix={on("click", () => {
        setBrowserThemePreference(props.value);
        props.setTheme(props.value);
      })}
      type="button"
    >
      {themeLabel(props.value)}
    </button>
  );
}

function themeLabel(theme: ThemePreference): string {
  return theme[0]?.toUpperCase() + theme.slice(1);
}

export function NotFound(): FigNode {
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
