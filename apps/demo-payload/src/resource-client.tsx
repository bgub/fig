import {
  createContext,
  dataResource,
  ErrorBoundary,
  type FigNode,
  readContext,
  readData,
  refreshData,
  Suspense,
  useState,
  useTransition,
} from "@bgub/fig";
import type { ResolveClientReference } from "@bgub/fig/payload";
import { createRoot, on, payloadDataLoader } from "@bgub/fig-dom";
import { LikeButton } from "./client-components.tsx";
import {
  brokenResourceSeed,
  likeButtonReferenceId,
  postSlotReferenceId,
  weatherSlotReferenceId,
} from "./resource-shared.ts";

// Every client component the payload streams can reference, shared by all
// three loaders: the wire carries ids, the client owns the components.
const resolveClientReference: ResolveClientReference = (metadata) =>
  ({
    [likeButtonReferenceId]: LikeButton,
    [postSlotReferenceId]: PostSlot,
    [weatherSlotReferenceId]: WeatherSlot,
  })[metadata.id];

// The plan's client half, verbatim in shape: each serialized tree travels as
// an ordinary data resource; the key is the refresh boundary; freshness uses
// the existing verbs. No consumer, no boundary protocol, no refresh header.
const postResource = dataResource<[number], FigNode>({
  key: (seed: number) => ["resource-post", seed],
  load: payloadDataLoader<[number]>({
    request: (seed, { signal }) => fetch(resourcePayloadUrl(seed), { signal }),
    resolveClientReference,
  }),
});

function resourcePayloadUrl(seed: number): string {
  const url = new URL("/resource-payload", window.location.origin);
  url.searchParams.set("seed", String(seed));

  const commentsGate = new URLSearchParams(window.location.search).get(
    "fig-e2e-comments-gate",
  );
  if (commentsGate !== null) {
    url.searchParams.set("fig-e2e-comments-gate", commentsGate);
  }

  return `${url.pathname}${url.search}`;
}

// A second serialized slot with its own key: refreshing one resource leaves
// the other's entry untouched, which is the whole refresh story — the unit
// of refresh is the data-resource key.
const weatherResource = dataResource<[], FigNode>({
  key: () => ["resource-weather"],
  load: payloadDataLoader<[]>({
    request: ({ signal }) => fetch("/weather-payload", { signal }),
    resolveClientReference,
  }),
});

// The surrounding server component: its stream carries the dashboard frame
// with PostSlot/WeatherSlot as client references, so refreshing it re-renders
// the wrapper on the server without touching the slots' own entries.
const dashboardResource = dataResource<[], FigNode>({
  key: () => ["resource-dashboard"],
  load: payloadDataLoader<[]>({
    request: ({ signal }) => fetch("/dashboard-payload", { signal }),
    resolveClientReference,
  }),
});

// The current post's seed reaches PostSlot through context: the slot mounts
// inside the decoded dashboard tree, where props can't come from the server
// (the server doesn't know client navigation state).
const SeedContext = createContext(1);

// The page is a visible template: every delivery layer renders inside a
// color-coded frame, and pending slots show as dashed outlines that fill in
// as their bytes arrive — app shell first, then the payload's own shell,
// then streamed holes, with client islands hydrating inside it all.
function ResourcePage() {
  const [seed, setSeed] = useState(1);

  return (
    <main class="app frame frame-shell">
      <span class="tag">app shell</span>
      <header>
        <h1>Serialized components, layer by layer</h1>
        <p class="muted">
          The gray shell renders instantly in the browser. Each slot below
          streams from its own payload request, fills in when it lands, and
          refreshes independently — the resource key is the refresh unit.
        </p>
        <div class="legend">
          <span>
            <i class="swatch-shell" /> app shell
          </span>
          <span>
            <i class="swatch-payload" /> payload shell
          </span>
          <span>
            <i class="swatch-streamed" /> streamed hole
          </span>
          <span>
            <i class="swatch-island" /> client island
          </span>
        </div>
        <div class="controls">
          <button
            data-resource-nav="next"
            mix={[on("click", () => setSeed((value) => value + 1))]}
            type="button"
          >
            Next post
          </button>
          <button
            data-resource-nav="broken"
            mix={[on("click", () => setSeed(brokenResourceSeed))]}
            type="button"
          >
            Load broken post
          </button>
          <button
            data-resource-nav="first"
            mix={[on("click", () => setSeed(1))]}
            type="button"
          >
            First post
          </button>
        </div>
      </header>
      <SeedContext value={seed}>
        <Suspense fallback={<DashboardSlotPending />}>
          <DashboardView />
        </Suspense>
      </SeedContext>
    </main>
  );
}

function DashboardView() {
  return (
    <div class="dashboard-slot resource-shell">
      {readData(dashboardResource)}
      <RefreshButton
        label="Refresh dashboard"
        name="dashboard"
        refresh={() => refreshData(dashboardResource)}
      />
    </div>
  );
}

// The dashboard's wireframe while the surrounding server component streams.
function DashboardSlotPending() {
  return (
    <section
      class="frame frame-payload dashboard-slot slot-pending"
      data-dashboard-state="loading"
    >
      <span class="tag">payload shell</span>
      <p class="slot-note">streaming payload…</p>
      <div class="skeleton">
        <i />
        <i />
        <i />
      </div>
    </section>
  );
}

// The post slot: a client component the dashboard payload references. It
// reads the navigation seed from context and its serialized post from the
// post resource — both are client state the server never sees.
function PostSlot() {
  const seed = readContext(SeedContext);

  return (
    <ErrorBoundary
      fallback={(error) => (
        <section class="frame frame-danger payload-slot" data-resource-error>
          <span class="tag">payload failed</span>
          <h2>Post failed to load</h2>
          <p class="muted">
            {error instanceof Error ? error.message : String(error)}
          </p>
          <p class="muted">Use “First post” to recover.</p>
        </section>
      )}
      key={seed}
    >
      <Suspense fallback={<PayloadSlotPending />}>
        <PostView seed={seed} />
      </Suspense>
    </ErrorBoundary>
  );
}

function WeatherSlot() {
  return (
    <Suspense fallback={<WeatherSlotPending />}>
      <WeatherView />
    </Suspense>
  );
}

// The empty payload slot: the wireframe of the post that has not arrived.
function PayloadSlotPending() {
  return (
    <section
      class="frame frame-payload payload-slot slot-pending"
      data-resource-state="loading"
    >
      <span class="tag">payload shell</span>
      <p class="slot-note">streaming payload…</p>
      <div class="skeleton">
        <i />
        <i />
        <i />
      </div>
    </section>
  );
}

// The weather slot's wireframe while its stream is in flight.
function WeatherSlotPending() {
  return (
    <section
      class="frame frame-payload weather-slot slot-pending"
      data-weather-state="loading"
    >
      <span class="tag">payload shell</span>
      <p class="slot-note">streaming payload…</p>
      <div class="skeleton">
        <i />
      </div>
    </section>
  );
}

function PostView({ seed }: { seed: number }) {
  // Suspends until the payload's root row decodes; holes inside keep
  // streaming afterwards.
  return (
    <div class="payload-slot resource-shell">
      {readData(postResource, seed)}
      <RefreshButton
        label="Refresh post"
        name="post"
        refresh={() => refreshData(postResource, seed)}
      />
    </div>
  );
}

function WeatherView() {
  return (
    <div class="weather-slot resource-shell">
      {readData(weatherResource)}
      <RefreshButton
        label="Refresh weather"
        name="weather"
        refresh={() => refreshData(weatherResource)}
      />
    </div>
  );
}

function RefreshButton({
  label,
  name,
  refresh,
}: {
  label: string;
  name: string;
  refresh: () => Promise<unknown>;
}) {
  const [isPending, startTransition] = useTransition();

  return (
    <button
      aria-label={label}
      class="refresh-button"
      data-refresh-state={isPending ? "pending" : "idle"}
      data-resource-refresh={name}
      mix={[
        on("click", () => {
          startTransition(async () => {
            await refresh();
          });
        }),
      ]}
      title={label}
      type="button"
    >
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <path d="M20 11a8 8 0 0 0-14.9-3M4 5v6h6M4 13a8 8 0 0 0 14.9 3M20 19v-6h-6" />
      </svg>
    </button>
  );
}

export function mountResourceApp(container: Element): void {
  const root = createRoot(container);
  root.render(<ResourcePage />);
  document.body.dataset.figResourceDemo = "ready";
}
