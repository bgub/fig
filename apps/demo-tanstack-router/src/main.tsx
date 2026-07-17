import {
  dataResource,
  type FigDataStoreHandle,
  type FigNode,
  invalidateData,
  invalidateDataError,
  readData,
  useState,
} from "@bgub/fig";
import { createRoot, on } from "@bgub/fig-dom";
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Link,
  Outlet,
  type RouteErrorComponentProps,
  RouterProvider,
  useLocation,
  useNavigate,
  useParams,
  useRouterState,
  useSearch,
} from "@bgub/fig-tanstack-router";
import "../style.css";

type Accent = "fig" | "loader" | "route";

interface Person {
  accent: Accent;
  id: string;
  name: string;
  role: string;
  focus: string;
  initials: string;
}

const settingsPanels = ["events", "loading", "types"] as const;
type SettingsPanel = (typeof settingsPanels)[number];

const accentClasses: Record<Accent, string> = {
  fig: "border-fig bg-fig-tint text-fig",
  loader: "border-loader bg-loader-tint text-loader",
  route: "border-route bg-route-tint text-route",
};

const navLinkClass =
  "rounded-md border border-transparent px-3 py-2 font-mono text-xs text-muted no-underline transition-colors hover:border-line hover:bg-white hover:text-ink data-[status=active]:border-route data-[status=active]:bg-route-tint data-[status=active]:text-route";

const people: readonly Person[] = [
  {
    accent: "route",
    focus: "Route matching and type inference",
    id: "ada",
    initials: "AL",
    name: "Ada Lovelace",
    role: "Router architect",
  },
  {
    accent: "loader",
    focus: "Async loaders and navigation state",
    id: "grace",
    initials: "GH",
    name: "Grace Hopper",
    role: "Loader engineer",
  },
  {
    accent: "fig",
    focus: "Native events and accessibility",
    id: "alan",
    initials: "AT",
    name: "Alan Turing",
    role: "Platform specialist",
  },
];

// The route data cache is Fig's data store, not the router: loaders delegate
// to ensureData, components read (and subscribe) with readData, and freshness
// is driven by invalidateData — TanStack's "external cache" pattern.
const personResource = dataResource({
  key: (personId: string) => ["person", personId],
  load: async (personId: string) => {
    await delay(650);
    const person = people.find((candidate) => candidate.id === personId);
    if (person === undefined) {
      throw new Error(`No profile exists for “${personId}”.`);
    }
    return {
      ...person,
      loadedAt: new Date().toLocaleTimeString(),
    };
  },
});

const rootRoute = createRootRouteWithContext<{
  data: FigDataStoreHandle;
}>()({
  component: AppShell,
  errorComponent: RouteError,
});

const homeRoute = createRoute({
  component: Home,
  getParentRoute: () => rootRoute,
  path: "/",
});

const peopleRoute = createRoute({
  component: PeopleDirectory,
  getParentRoute: () => rootRoute,
  path: "people",
});

const personRoute = createRoute({
  component: PersonDetail,
  errorComponent: RouteError,
  getParentRoute: () => rootRoute,
  loader: ({ context, params }) =>
    context.data.ensureData(personResource, params.personId),
  pendingComponent: PersonPending,
  path: "people/$personId",
  validateSearch: (search) => ({
    from:
      search.from === "directory" || search.from === "home"
        ? search.from
        : undefined,
  }),
});

const settingsRoute = createRoute({
  component: Settings,
  getParentRoute: () => rootRoute,
  path: "settings",
  validateSearch: (search) => ({
    panel: isSettingsPanel(search.panel) ? search.panel : "events",
  }),
});

const routeTree = rootRoute.addChildren([
  homeRoute,
  peopleRoute,
  personRoute,
  settingsRoute,
]);

const container = document.getElementById("root");
if (container === null) throw new Error("Missing #root container.");
const root = createRoot(container);

// root.data is a lazy handle, so it can enter router context before the
// first render. defaultPreloadStaleTime: 0 hands every load and preload
// event to the loaders, which delegate to the data store.
const router = createRouter({
  context: { data: root.data },
  defaultPendingMinMs: 300,
  defaultPendingMs: 0,
  defaultPreloadStaleTime: 0,
  routeTree,
});

declare module "@tanstack/router-core" {
  interface Register {
    router: typeof router;
  }
}

function AppShell(): FigNode {
  const location = useLocation();
  const status = useRouterState({ select: (state) => state.status });
  const matchTrail = useRouterState({
    select: (state) => state.matches.map((match) => match.routeId).join(" → "),
  });
  const statusClass =
    status === "idle"
      ? "border-fig bg-fig-tint text-fig"
      : "border-loader bg-loader-tint text-loader";

  return (
    <div class="mx-auto min-h-screen max-w-5xl px-4 py-10 sm:px-6 sm:py-12">
      <div class="frame flex min-h-[calc(100vh-6rem)] flex-col border-shell p-0">
        <span class="frame-tag text-shell">router shell</span>
        <header class="flex flex-wrap items-center gap-4 border-b border-line px-5 py-5 sm:px-7">
          <Link class="flex items-center gap-3 text-ink no-underline" to="/">
            <span class="grid size-9 place-items-center rounded-md border-[1.5px] border-route bg-route-tint font-serif text-lg font-semibold text-route">
              F
            </span>
            <span class="grid leading-tight">
              <strong class="text-sm font-semibold">Fig</strong>
              <small class="font-mono text-[10px] tracking-wide text-muted uppercase">
                × TanStack Router
              </small>
            </span>
          </Link>
          <nav
            aria-label="Primary navigation"
            class="order-3 flex w-full gap-1 sm:order-none sm:w-auto"
          >
            <Link activeOptions={{ exact: true }} class={navLinkClass} to="/">
              Overview
            </Link>
            <Link class={navLinkClass} to="/people">
              People
            </Link>
            <Link
              activeOptions={{ includeSearch: false }}
              class={navLinkClass}
              search={{ panel: "events" }}
              to="/settings"
            >
              Inspector
            </Link>
          </nav>
          <span
            aria-live="polite"
            class={`ml-auto inline-flex items-center gap-2 rounded-full border px-2.5 py-1 font-mono text-[10px] tracking-wide uppercase ${statusClass}`}
          >
            <span class="size-1.5 rounded-full bg-current" />
            {status}
          </span>
        </header>

        <main class="flex-1 px-5 py-8 sm:px-7 sm:py-10">
          <Outlet />
        </main>

        <footer class="flex flex-wrap gap-x-8 gap-y-2 border-t border-line bg-white/50 px-5 py-4 font-mono text-[11px] text-muted sm:px-7">
          <span>
            <strong class="font-semibold text-ink">Location</strong>{" "}
            {location.pathname}
          </span>
          <span>
            <strong class="font-semibold text-ink">Matches</strong>{" "}
            {matchTrail || "waiting"}
          </span>
        </footer>
      </div>
    </div>
  );
}

function Home(): FigNode {
  return (
    <div class="space-y-10">
      <section class="max-w-3xl">
        <div class="mb-3 font-mono text-[11px] font-semibold tracking-[0.12em] text-route uppercase">
          Framework adapter prototype
        </div>
        <h1 class="m-0 text-3xl leading-tight font-semibold tracking-[-0.025em] sm:text-4xl">
          TanStack’s router core,
          <span class="block text-route">rendered by Fig.</span>
        </h1>
        <p class="mt-5 max-w-2xl text-[15px] leading-7 text-muted">
          Matching, loaders, search validation, and history stay with TanStack.
          Components, subscriptions, native links, and events belong to Fig.
        </p>
        <div class="mt-6 flex flex-wrap gap-2.5">
          <Link class="button button-route" to="/people">
            Explore the directory
          </Link>
          <Link
            class="button button-quiet"
            params={{ personId: "ada" }}
            preload="intent"
            search={{ from: "home" }}
            to="/people/$personId"
          >
            Preload Ada’s profile
          </Link>
        </div>
        <p class="mt-5 border-l-2 border-line pl-3 font-mono text-[11px] leading-5 text-muted">
          Try opening either link with ⌘/Ctrl-click: Fig preserves the browser’s
          native behavior.
        </p>
      </section>

      <section
        class="grid gap-5 md:grid-cols-3"
        aria-label="Adapter capabilities"
      >
        <Feature
          code="router-core"
          description="Code routes and loaders use TanStack’s current core without a fork."
          number="01"
          tone="route"
          title="One routing engine"
        />
        <Feature
          code="useSyncExternalStore"
          description="A private atom bridge publishes only the selected router state to Fig."
          number="02"
          tone="loader"
          title="Fine-grained updates"
        />
        <Feature
          code={'mix={on("click", …)}'}
          description="Links render real anchors and intercept only ordinary primary clicks."
          number="03"
          tone="fig"
          title="Native by default"
        />
      </section>
    </div>
  );
}

function Feature(props: {
  code: string;
  description: string;
  number: string;
  tone: Accent;
  title: string;
}): FigNode {
  const toneClass = accentClasses[props.tone];
  return (
    <article class={`frame min-h-52 p-5 ${toneClass}`}>
      <span class="frame-tag text-current">capability {props.number}</span>
      <h2 class="mt-1 text-base font-semibold text-ink">{props.title}</h2>
      <p class="mt-3 text-sm leading-6 text-muted">{props.description}</p>
      <code class="absolute right-5 bottom-5 left-5 overflow-hidden text-ellipsis rounded bg-white/70 px-2 py-1.5 font-mono text-[10px] whitespace-nowrap text-current">
        {props.code}
      </code>
    </article>
  );
}

function PeopleDirectory(): FigNode {
  return (
    <div class="space-y-8">
      <header class="grid gap-4 border-b border-line pb-6 md:grid-cols-[1fr_1.25fr] md:items-end">
        <div>
          <div class="mb-2 font-mono text-[11px] font-semibold tracking-[0.12em] text-route uppercase">
            Intent preloading
          </div>
          <h1 class="m-0 text-3xl font-semibold tracking-[-0.02em]">
            People directory
          </h1>
        </div>
        <p class="m-0 text-sm leading-6 text-muted">
          Hover or focus a profile before opening it. The route loader starts
          ahead of navigation and fills Fig’s data store; the profile component
          reads the same entry.
        </p>
      </header>

      <section class="grid gap-5 md:grid-cols-3">
        {people.map((person) => (
          <Link
            class="frame group grid min-h-60 content-between border-route bg-route-tint p-5 text-ink no-underline transition-transform hover:-translate-y-0.5 hover:bg-white"
            key={person.id}
            params={{ personId: person.id }}
            preload="intent"
            preloadDelay={120}
            search={{ from: "directory" }}
            to="/people/$personId"
          >
            <span class="frame-tag text-route">route /people/$personId</span>
            <span
              class={`grid size-11 place-items-center rounded-md border-[1.5px] font-mono text-xs font-semibold ${accentClasses[person.accent]}`}
            >
              {person.initials}
            </span>
            <span class="mt-8 grid gap-1">
              <strong class="text-base font-semibold">{person.name}</strong>
              <small class="font-mono text-[10px] tracking-wide text-route uppercase">
                {person.role}
              </small>
              <span class="mt-2 text-sm leading-6 text-muted">
                {person.focus}
              </span>
            </span>
            <span
              aria-hidden="true"
              class="absolute right-4 bottom-4 font-mono text-sm text-route transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
            >
              ↗
            </span>
          </Link>
        ))}
      </section>

      <Link
        class="inline-flex font-mono text-xs text-danger underline decoration-danger/30 underline-offset-4 hover:decoration-danger"
        params={{ personId: "unknown" }}
        search={{ from: "directory" }}
        to="/people/$personId"
      >
        Test the route error boundary with an unknown profile →
      </Link>
    </div>
  );
}

function PersonDetail(): FigNode {
  const { personId } = useParams({ from: "/people/$personId" });
  // Reads the entry the route loader ensured — and subscribes, so an
  // invalidation re-renders this component with the revalidated value.
  const person = readData(personResource, personId);
  const search = useSearch({ from: "/people/$personId" });
  const navigate = useNavigate();

  return (
    <div class="space-y-6">
      <button
        class="button button-quiet cursor-pointer"
        mix={on("click", () => void navigate({ to: "/people" }))}
        type="button"
      >
        ← Directory
      </button>
      <button
        class="button button-quiet cursor-pointer"
        mix={on("click", () => invalidateData(personResource, personId))}
        type="button"
      >
        Refresh profile data
      </button>

      <article class="frame grid gap-7 border-loader bg-loader-tint p-6 sm:grid-cols-[auto_1fr] sm:p-8">
        <span class="frame-tag text-loader">loader result</span>
        <div
          class={`grid size-20 place-items-center rounded-lg border-[1.5px] font-mono text-lg font-semibold ${accentClasses[person.accent]}`}
        >
          {person.initials}
        </div>
        <div>
          <span class="font-mono text-[10px] tracking-wide text-loader uppercase">
            Loader resolved at {person.loadedAt}
          </span>
          <h1 class="mt-2 mb-0 text-3xl font-semibold tracking-[-0.02em]">
            {person.name}
          </h1>
          <p class="mt-1 font-mono text-xs text-loader">{person.role}</p>
          <p class="mt-4 text-sm leading-6 text-muted">{person.focus}</p>
          <dl class="mt-7 grid gap-px overflow-hidden rounded-md border border-line bg-line sm:grid-cols-3">
            <div class="bg-white p-3.5">
              <dt class="font-mono text-[10px] tracking-wide text-muted uppercase">
                Route param
              </dt>
              <dd class="mt-1 font-mono text-xs text-ink">{person.id}</dd>
            </div>
            <div class="bg-white p-3.5">
              <dt class="font-mono text-[10px] tracking-wide text-muted uppercase">
                Arrived from
              </dt>
              <dd class="mt-1 font-mono text-xs text-ink">
                {search.from ?? "direct URL"}
              </dd>
            </div>
            <div class="bg-white p-3.5">
              <dt class="font-mono text-[10px] tracking-wide text-muted uppercase">
                Rendering
              </dt>
              <dd class="mt-1 font-mono text-xs text-ink">Fig component</dd>
            </div>
          </dl>
        </div>
      </article>
    </div>
  );
}

function PersonPending(): FigNode {
  return (
    <div aria-busy="true" aria-live="polite">
      <div class="frame grid min-h-64 gap-7 border-loader border-dashed bg-loader-tint p-6 sm:grid-cols-[auto_1fr] sm:p-8">
        <span class="frame-tag text-loader">loader pending</span>
        <div class="shimmer size-20 rounded-lg bg-loader/20" />
        <div class="grid content-center gap-3">
          <span class="shimmer h-2.5 w-28 rounded-sm bg-loader/20" />
          <span class="shimmer h-4 w-3/4 rounded-sm bg-loader/20" />
          <span class="shimmer h-3 w-1/2 rounded-sm bg-loader/20" />
        </div>
      </div>
      <p class="mt-3 font-mono text-[11px] text-loader">Loading route data…</p>
    </div>
  );
}

function Settings(): FigNode {
  const { panel } = useSearch({ from: "/settings" });
  const [eventCount, setEventCount] = useState(0);
  const panelClass =
    panel === "events"
      ? "border-fig bg-fig-tint"
      : panel === "loading"
        ? "border-loader bg-loader-tint"
        : "border-route bg-route-tint";
  const panelLabelClass =
    panel === "events"
      ? "text-fig"
      : panel === "loading"
        ? "text-loader"
        : "text-route";

  return (
    <div class="space-y-8">
      <header class="grid gap-4 border-b border-line pb-6 md:grid-cols-[1fr_1.25fr] md:items-end">
        <div>
          <div class="mb-2 font-mono text-[11px] font-semibold tracking-[0.12em] text-route uppercase">
            Search-param routing
          </div>
          <h1 class="m-0 text-3xl font-semibold tracking-[-0.02em]">
            Adapter inspector
          </h1>
        </div>
        <p class="m-0 text-sm leading-6 text-muted">
          Each tab is URL state validated by the route. Reload or share the URL
          and the same panel opens.
        </p>
      </header>

      <nav aria-label="Inspector panels" class="flex flex-wrap gap-2">
        {settingsPanels.map((name) => (
          <Link
            activeOptions={{ exact: true }}
            class="button button-quiet capitalize data-[status=active]:border-route data-[status=active]:bg-route-tint data-[status=active]:text-route"
            key={name}
            search={{ panel: name }}
            to="/settings"
          >
            {name}
          </Link>
        ))}
      </nav>

      <section class={`frame min-h-72 p-6 sm:p-8 ${panelClass}`}>
        <span class={`frame-tag ${panelLabelClass}`}>active panel</span>
        {panel === "events" ? (
          <>
            <h2 class="mt-0 text-xl font-semibold">Native event composition</h2>
            <p class="max-w-2xl text-sm leading-6 text-muted">
              This button uses Fig’s <code>on("click")</code> mixin. The router
              link beside it uses the same primitive internally.
            </p>
            <button
              class="button mt-5 cursor-pointer border-fig bg-white text-fig hover:bg-fig-tint"
              mix={on("click", () => setEventCount((count) => count + 1))}
              type="button"
            >
              Dispatch native click · {eventCount}
            </button>
          </>
        ) : panel === "loading" ? (
          <>
            <h2 class="mt-0 text-xl font-semibold">Loader lifecycle</h2>
            <p class="max-w-2xl text-sm leading-6 text-muted">
              Navigate to a profile to see pending UI, async route data, cache
              reuse, and route-scoped error rendering.
            </p>
            <Link
              class="button mt-5 border-loader bg-white text-loader hover:bg-loader-tint"
              to="/people"
            >
              Open loader examples
            </Link>
          </>
        ) : (
          <>
            <h2 class="mt-0 text-xl font-semibold">Registered router types</h2>
            <p class="max-w-2xl text-sm leading-6 text-muted">
              The demo augments TanStack’s <code>Register</code> interface with
              the Fig router. Every <code>to</code>, <code>params</code>, and{" "}
              <code>search</code> object in this file is checked against the
              route tree.
            </p>
            <pre class="mt-5 overflow-x-auto rounded-md border border-route/25 bg-white/80 p-4 font-mono text-xs leading-5 text-route">
              <code>{`declare module "@tanstack/router-core" {\n  interface Register {\n    router: typeof router\n  }\n}`}</code>
            </pre>
          </>
        )}
      </section>
    </div>
  );
}

function RouteError({ error, reset }: RouteErrorComponentProps): FigNode {
  return (
    <div class="frame border-danger bg-danger-tint p-6 sm:p-8">
      <span class="frame-tag text-danger">route error</span>
      <div class="font-mono text-[11px] font-semibold tracking-wide text-danger uppercase">
        404-ish
      </div>
      <h1 class="mt-2 mb-0 text-2xl font-semibold tracking-[-0.02em]">
        The loader declined that route.
      </h1>
      <p class="mt-3 text-sm text-muted">
        {error instanceof Error ? error.message : "Unknown route error."}
      </p>
      <div class="mt-6 flex flex-wrap gap-2.5">
        <Link class="button border-danger bg-white text-danger" to="/people">
          Return to directory
        </Link>
        <button
          class="button button-quiet cursor-pointer"
          mix={on("click", () => {
            // The rejection is cached in the data store; clear the keys
            // attributed to this error before the router re-runs the loader.
            invalidateDataError(error);
            reset();
          })}
          type="button"
        >
          Retry loader
        </button>
      </div>
    </div>
  );
}

function isSettingsPanel(value: unknown): value is SettingsPanel {
  return value === "events" || value === "loading" || value === "types";
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

root.render(<RouterProvider router={router} />);
