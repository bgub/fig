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
          The gray shell renders instantly in the browser. Everything below it
          streams from one payload request and fills its slot when it lands.
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
            events={[on("click", () => setSeed((value) => value + 1))]}
            type="button"
          >
            Next post
          </button>
          <RefreshPostButton seed={seed} />
          <button
            data-resource-nav="broken"
            events={[on("click", () => setSeed(brokenResourceSeed))]}
            type="button"
          >
            Load broken post
          </button>
          <button
            data-resource-nav="first"
            events={[on("click", () => setSeed(1))]}
            type="button"
          >
            First post
          </button>
        </div>
      </header>
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
    </main>
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

function PostView({ seed }: { seed: number }) {
  // Suspends until the payload's root row decodes; holes inside keep
  // streaming afterwards.
  const post = readData(postResource, seed);
  // Hydrated from the same response's data rows — the client loader never
  // runs for this key, and a post refresh freshens it (server wins).
  const summary = readData(payloadSummaryResource, seed);

  return (
    <div class="payload-slot">
      {post}
      <p class="data-strip" data-resource-summary>
        <span class="tag">hydrated data</span>
        summary: {summary.source} · {summary.bucket} · load {summary.reads}
      </p>
    </div>
  );
}

function RefreshPostButton({ seed }: { seed: number }) {
  const [isPending, startTransition] = useTransition();

  return (
    <button
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
      {isPending ? "Refreshing post…" : "Refresh post"}
    </button>
  );
}

export function mountResourceApp(container: Element): void {
  const root = createRoot(container);
  root.render(<ResourcePage />);
  document.body.dataset.figResourceDemo = "ready";
}
