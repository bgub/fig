import {
  dataResource,
  ErrorBoundary,
  type FigNode,
  readData,
  refreshData,
  Suspense,
  useState,
  useTransition,
} from "@bgub/fig";
import { createRoot, on, payloadDataLoader } from "@bgub/fig-dom";
import { LikeButton } from "./client-components.tsx";
import { payloadSummaryResource } from "./data.ts";
import {
  brokenResourceSeed,
  likeButtonReferenceId,
} from "./resource-shared.ts";

// The plan's client half, verbatim in shape: the serialized post travels as
// an ordinary data resource; the key is the refresh boundary; freshness uses
// the existing verbs. No consumer, no boundary protocol, no refresh header.
const postResource = dataResource<[number], FigNode>({
  key: (seed: number) => ["resource-post", seed],
  load: payloadDataLoader<[number]>({
    request: (seed, { signal }) =>
      fetch(`/resource-payload?seed=${seed}`, { signal }),
    resolveClientReference: (metadata) =>
      metadata.id === likeButtonReferenceId ? LikeButton : undefined,
  }),
});

function ResourcePage() {
  const [seed, setSeed] = useState(1);

  return (
    <main class="app-frame">
      <header class="app-header">
        <div>
          <h1>Serialized components as data resources</h1>
          <p class="muted">
            One payload stream per post, delivered through readData; refresh and
            navigation are ordinary data-resource operations.
          </p>
        </div>
        <div class="actions">
          <button
            class="button"
            data-resource-nav="next"
            events={[on("click", () => setSeed((value) => value + 1))]}
            type="button"
          >
            Next post
          </button>
          <RefreshPostButton seed={seed} />
          <button
            class="button"
            data-resource-nav="broken"
            events={[on("click", () => setSeed(brokenResourceSeed))]}
            type="button"
          >
            Load broken post
          </button>
          <button
            class="button"
            data-resource-nav="first"
            events={[on("click", () => setSeed(1))]}
            type="button"
          >
            First post
          </button>
        </div>
      </header>
      <section class="grid">
        <ErrorBoundary
          fallback={(error) => (
            <section class="panel tone-warn" data-resource-error>
              <h2>Post failed to load</h2>
              <p class="muted">
                {error instanceof Error ? error.message : String(error)}
              </p>
              <p class="muted">Use “First post” to recover.</p>
            </section>
          )}
          key={seed}
        >
          <Suspense
            fallback={<p data-resource-state="loading">Loading post…</p>}
          >
            <PostView seed={seed} />
          </Suspense>
        </ErrorBoundary>
      </section>
    </main>
  );
}

function PostView({ seed }: { seed: number }) {
  // Suspends until the payload's root row decodes; holes inside keep
  // streaming afterwards.
  const post = readData(postResource, seed);
  // Hydrated from the same response's data rows — the client loader never
  // runs for this key, and a post refresh freshens it (server wins).
  const summary = readData(payloadSummaryResource, seed);

  return (
    <div class="resource-view">
      {post}
      <p class="muted" data-resource-summary>
        summary: {summary.source} · {summary.bucket} · load {summary.reads}
      </p>
    </div>
  );
}

function RefreshPostButton({ seed }: { seed: number }) {
  const [isPending, startTransition] = useTransition();

  return (
    <button
      class="button"
      data-refresh-state={isPending ? "pending" : "idle"}
      data-resource-refresh
      events={[
        on("click", () => {
          startTransition(async () => {
            await refreshData(postResource, seed);
          });
        }),
      ]}
      type="button"
    >
      {isPending ? "Refreshing post..." : "Refresh post"}
    </button>
  );
}

export function mountResourceApp(container: Element): void {
  const root = createRoot(container);
  root.render(<ResourcePage />);
  document.body.dataset.figResourceDemo = "ready";
}
