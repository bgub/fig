# Plan: Serialized Components as Data Resources

Status: adopted; Phases 0–1 landed 2026-07-13, Phases 2–5 pending

## Progress

- **Phase 0 (spec)** — landed: `docs/concepts/payload.md` rewritten around format-not-architecture with the legacy targeted-refresh layer in a marked section; `data.md`, `errors.md`, `architecture.md`, `open-questions.md` updated.
- **Phase 1 (core payload decode)** — landed: the payload format (row/model types, codecs, value codec, negotiation, error decoding) moved to browser-safe `@bgub/fig/payload`; `decodePayloadStream` + `PayloadDecode` implemented there (fig-server's serializer builds against the format through `@bgub/fig/internal`); dev-time client-API throws added to `renderToPayloadStream`; failure-semantics table covered by unit tests in `packages/fig/src/payload.test.ts` and render→decode round trips in `packages/fig-server/src/payload-decode.test.ts`.
- Implementation notes from Phase 1:
  - Asset dependency is declared on the wire: `assets` rows gained an optional `for` — the row the declaring subtree actually settles into, decided at serialization scope exit (a suspended subtree takes its assets to its outlined row), so the decoder gates exactly the dependent row and a hole's stylesheet never delays the enclosing tree. Client-reference assets gate only the island (the gate lives inside the island component, not the referencing chunk).
  - The codec's row-decoder interface is named `PayloadRowDecoder` (avoiding collision with `PayloadDecode`).
  - `useSyncExternalStore` stays allowed during payload render — its required `getServerSnapshot` path is a read, and fig-start's `Outlet` depends on it. The dev throw list is `useState`, `useActionState`, `useTransition`, `useStableEvent`, `useReactive`, `useBeforePaint`, `useBeforeLayout`.
  - **Gap found:** promise-valued _children_ (the `Post` example below) are not yet accepted — the serializer treats thenable children as invalid children and the client reconciler has no thenable-child support. Streaming currently outlines via suspending server components and promise-valued props. Tracked in `docs/concepts/open-questions.md`; must be resolved before the example ships as written.
- **Phase 2 (Fig DOM adapter + lifetime integration)** — landed 2026-07-13: loader signals are generation-lifetime (live after fulfillment; abort on supersession/hydrate-over/eviction/disposal; a rejected load aborts its own; invalidate never aborts), the load context carries the internal generation-guarded hydration capability (self-key rows are skipped so a loader cannot supersede itself), and fig-dom ships `payloadDataLoader`. Partition question resolved: `data` rows carry raw keys and partitioning is store-keying applied independently on each side, so `dataPartition` on `renderToPayloadStream` survives unchanged and the capability hydrates through the client store's own partition. Covered by store-level signal/capability tests and fig-dom adapter tests (HTTP validation, readData element trees, refresh retention, supersession aborting the background decode, asset gating, stub-store element-value hydration).
- **Phase 3 (parity and performance validation)** — decided 2026-07-13. `benchmarks/scenarios/payload.mjs` gained `payload.refresh-*` scenarios comparing one legacy targeted boundary refresh against a full resource-model refresh (re-decode the whole document + render fresh elements over the old tree) on a rows×10-item document. Medians on the development machine (15 samples; machine- and revision-sensitive, per the reconciler-explorations measurement protocol): at 100 rows (~1.1k elements) consumer 1.26ms vs resource 1.49ms (decode-only 1.10ms); at 1000 rows (~11k elements) consumer 14.45ms vs resource 17.48ms (decode-only 12.08ms). Two findings: the legacy refresh machinery is itself O(document) per refresh (refresh id-range rescans and boundary-reachability walks), so decoded-chunk memoization's reconciliation savings mostly cancel out; and decode dominates the resource-model cost (~70–80%), which is the coarse-single-key worst case that nested resource keys already shrink. **Decision: ship without cross-refresh identity** — ordinary keyed reconciliation of fresh elements costs ~0.4ms/5.4ms at 1.1k/11k elements, and parity with the deleted machinery is comfortably met. Revisit only if a real document profile shows reconciliation (not decode) dominating. The non-authoritative demo path is `apps/demo-payload`'s `/resource` page: a serialized post served by a plain `renderToPayloadStream` endpoint and consumed with `payloadDataLoader` + `readData` — progressive holes, an interactive island, data-row hydration with cross-key freshening, transition-refresh retention, key navigation, and pre-root failure recovery, all covered by `e2e/resource-model.spec.ts` while the legacy consumer page keeps running beside it.
- **Phases 4–5** — not started (fig-start migration; targeted-refresh removal).

Context: replace the payload architecture (boundaries, targeted refresh protocol, consumer fetch seam) with "serialize a component, deliver it as a data resource." Inspired in part by https://tanstack.com/blog/react-server-components — the good idea inside RSC is the data format, not the architecture.

## Example

No framework, no boundaries, no refresh protocol — one Express route serving a payload stream, one client consuming it as an ordinary data resource.

```tsx
// server.tsx — creates and serves a payload stream
import express from "express";
import { Readable } from "node:stream";
import { Suspense } from "@bgub/fig";
import { renderToPayloadStream } from "@bgub/fig-server/payload";
import { loadComments, loadPost, logAndDigest } from "./db.ts";

function Post({ slug }: { slug: string }) {
  const post = loadPost(slug);
  return (
    <article>
      <h1>{post.title}</h1>
      <section>{post.body}</section>
      <Suspense fallback={<p>Loading comments…</p>}>
        {loadComments(slug).then((comments) => (
          <ul>
            {comments.map((c) => (
              <li key={c.id}>{c.text}</li>
            ))}
          </ul>
        ))}
      </Suspense>
    </article>
  );
}

const app = express();

app.get("/posts/:slug", (req, res) => {
  const { stream, contentType, abort } = renderToPayloadStream(
    <Post slug={req.params.slug} />,
    { onError: (error) => ({ digest: logAndDigest(error) }) },
  );
  res.type(contentType);
  req.on("close", () => abort());
  Readable.fromWeb(stream).pipe(res);
});

app.listen(3000);
```

```tsx
// client.tsx — consumes the stream as an ordinary data resource
import {
  Suspense,
  dataResource,
  on,
  readData,
  refreshData,
  transition,
} from "@bgub/fig";
import { createRoot, payloadDataLoader } from "@bgub/fig-dom";
import { loadClientReference } from "./client-manifest.ts";

const postResource = dataResource({
  key: (slug: string) => ["post", slug],
  load: payloadDataLoader({
    request: (slug, { signal }) => fetch(`/posts/${slug}`, { signal }),
    loadClientReference,
  }),
});

function PostPage({ slug }: { slug: string }) {
  const post = readData(postResource, slug); // suspends until the root row decodes
  // The root publishes in a transition lane. An already revealed Suspense
  // boundary keeps its previous content if the new render suspends through
  // it; Suspense boundaries inside the new tree may still show fallbacks.
  // invalidateData marks stale instead: the next read re-runs the loader.
  const refresh = () => transition(() => refreshData(postResource, slug));
  return (
    <main>
      <button events={[on("click", refresh)]}>Refresh</button>
      {post}
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <Suspense fallback={<p>Loading post…</p>}>
    <PostPage slug="hello-fig" />
  </Suspense>,
);
```

The promise-valued child inside `Post` is the streaming story: it serializes as an outlined row that suspends-and-fills by id, so comments stream into the already-delivered tree — including on refresh. Fig DOM's `payloadDataLoader` is the focused web adapter: it validates the response and codec, connects generation lifetime and internal hydration authority to `decodePayloadStream`, prepares assets with reveal gating, observes decode completion, and returns the decoded root value. The standalone example supplies only the request and client-reference manifest loader; Fig Start-generated resource stubs supply those too. The low-level client decoder lives at `@bgub/fig/payload`; browser code must not import `@bgub/fig-server` to decode.

## Summary

A server can serialize any component tree into a value; that value travels as an ordinary data resource and is refreshed/invalidated with the existing freshness verbs. The resource key **is** the refresh boundary. Streaming structure is a property of the value (a tree with thenable holes); the store owns only the consuming loader generation's lifetime and authority. Core keeps the format; frameworks own the wire.

This extends two stances core already took:

- "Remote Refresh Is A Framework Layer" (`docs/concepts/data.md`) — the store only knows loader-backed and hydrate-only entries; endpoints belong to fig-start.
- Server actions and temporary references are deliberately absent from the payload row model; action transport is fig-start's (`docs/concepts/hooks.md`, `docs/concepts/open-questions.md`).

## Design Decisions

1. **Core keeps element serialization as a first-class data format.** The ordinary payload value codec round-trips cycles, `Map`/`Set`/`Date`, and shared references; the payload model serializer layers rendered Fig elements, promises, and client references on top of that value machinery. Frameworks cannot cleanly rebuild this against internal element brands, so the format stays. Everything architectural on top of it leaves core or is deleted.

2. **`renderToPayloadStream` keeps its name; the architecture around it goes.** The signature drops `refreshBoundary`/boundary machinery (`codec`, `onError`, `highWaterMark`, `signal` stay). It renders with no client dispatcher: any Fig client API (`useState`, effects, events, `bind`, …) **throws** at dev time. No directives, no build-time module-graph coloring on the server side. The client half is `decodePayloadStream`. "Payload" survives as the format name, so `payload.md` stays the concept home.

3. **Delivery is a data resource.** The client loader fetches the framework's endpoint and decodes; the decoded element tree is the entry value. `readData(postResource, slug)` suspends like any other read and returns renderable elements. Hydration, stale-while-refresh, supersession, and eviction remain store concerns. Generation guarding expands to cover post-root ingestion, and loader signals become generation-lifetime signals rather than pending-promise-lifetime signals. A fulfilled serialized-component entry may still contain live payload holes: fulfilled means the root value has published, not that every streamed descendant has settled.

4. **Streaming: the entry settles once, at the root row, with a value containing promise holes.** A `PayloadDecode`'s `value` resolves when the root row decodes while decoding continues in the background; unfinished subtrees are outlined thenables (existing model-row semantics). Nested `Suspense` inside the serialized tree reveals holes as rows arrive via the thenable registry. If post-root ingestion fails, unresolved holes reject and propagate through the nearest `ErrorBoundary` that covers the slot being rendered. The store does not interpret payload streams, but it owns the lifetime and authority of the loader generation consuming them.

5. **Refresh policy uses existing transition semantics, without promising all-hole atomicity.**
   - Plain `refreshData`: new tree publishes at its root row; unfinished sections show fallbacks.
   - `refreshData` inside `transition()`: the root publishes in the refresh's transition lane. If rendering the new tree suspends through an already revealed `Suspense` boundary, previous content stays visible there. `Suspense` boundaries serialized inside the new tree may still commit their own fallbacks.
   - Hole completion is not part of the refresh promise. Background ingestion is tied to the loader generation's `{ signal }`; supersession, hydration, eviction, and store disposal abort it.

6. **After parity validation, the targeted-refresh protocol is deleted, not moved.** `PayloadBoundary`, `refresh`/`refresh-error` rows, `x-fig-payload-boundary`, refresh id-range namespacing, and the "targeted refresh wins until a newer parent model row" authority rule all collapse into resource keys + store hydration rules ("server push wins" already exists).

7. **`clientReference` stays in core as the one escape hatch.** Streaming makes this necessary: a streamed hole that fills with an interactive island (markdown post containing a live demo) requires interleaving. The reference is pure data (`{ id, exportName?, assets?, ssr? }`); manifests, loaders, and module conventions stay framework-supplied.

8. **RPC stays out of core.** Already the stance. The primitive-shaped gap worth considering in core is optimistic state (a `useOptimistic`-like hook needs lane awareness and cannot live in a framework); wire typesafety is fig-start's problem.

## Data And Context Across The Boundary

**Server components can read data — the server/client line is statefulness, not reads.** The dev-time throw list is state, effects, and interactivity (`useState`, effects, `events`, `bind`, actions). The read verbs (`readData`, `readPromise`, `readContext`) are server-safe: the payload render has a per-request store, loaders run server-side, and a pending read suspends that subtree into an outlined streaming hole. This defines "server component" in Fig: not "pure function of props" — render-only.

**Server components provide data by reading it.** Settled entries from the render's store stream as `data` rows (existing contract), and hydration into the client store is already specced as a completed server-pushed refresh (server wins, in-flight loads aborted, generation bumped). Consequences:

- Refreshing a serialized-component resource also freshens every data entry the server tree read; client subscribers to those keys update, and client-reference islands calling `readData` on the same keys read hydrated values with no second request. This generalizes "payload navigation makes no second data request" from route navigations to any serialized-component refresh — state it as a contract.
- Plumbing gap: `data` rows reached the store through `bindRoot`, which is deleted. Keep hydration authority internal to the data store / Fig DOM adapter instead of adding public `hydrate(entries)` to `DataResourceLoadContext`. `payloadDataLoader` receives a narrow, generation-guarded internal capability that hydrates through the calling store only while that load generation is authoritative and returns `false` after supersession. Standalone decode callers pass an equivalent explicit capability.

**Context is render-scoped and erased by serialization.**

- Within the server tree it just works: `readContext` resolves at render time. Idiomatic request-state injection without prop drilling: `renderToPayloadStream(<SessionContext value={session}><Post /></SessionContext>)`. Nothing context-shaped crosses the wire — every function component has already run.
- Client context reaches client-reference islands, not the serialized tree itself: islands are real client components and read context from wherever the decoded tree sits. `{post}` rendered under a client `ThemeProvider` themes every island inside the post. State this as a contract.
- Server-tree-provides-context-to-islands is deliberately unsupported for now: pass props to the reference, or wrap the island in a client provider component. Serializable provider elements crossing the wire is the kind of surface that quietly rebuilds the architecture this plan deletes — revisit only on demonstrated need.

## SSR Hydration Constraint

Initial document hydration cannot treat a serialized-component resource as an ordinary `FigDataHydrationEntry` value. Ordinary data rows use the value codec; serialized component entries use the payload model path and may contain Fig element models, client references, asset gates, and live thenable holes.

Core can ship a simple complete-handoff path: hydrate serialized-component entries only after `allReady`, when no live holes remain. First-paint streaming is a Fig Start constraint: the framework must bind the hydrated resource entry to the same inline frame row stream and generation authority used by the document payload, so pending holes continue to fill after the shell flush. The deletion gate cannot pass until the stub-store buffering path handles a root value with thenable holes without replacing server-rendered DOM.

## Cut Lines

The low-level client decoder returns a live decode, not a thenable or a data-resource value:

```ts
interface PayloadDecode {
  value: Promise<FigNode>;
  completion: Promise<
    | { status: "complete" }
    | { status: "failed"; error: unknown }
    | { status: "aborted" }
  >;
  abort(reason?: unknown): void;
}
```

`value` rejects only when the stream fails before producing a root value. `completion` never rejects, so callers can observe post-root transport/protocol failure without creating an unhandled rejection. Post-root failures propagate to UI by rejecting unresolved decoded holes/slots; a network failure cannot retroactively throw through already fully decoded content that no longer has a pending slot. Calling `abort` is idempotent and has the same remaining-row and unresolved-hole behavior as aborting `signal`. `PayloadDecode` deliberately does not implement `PromiseLike`: magical thenable assimilation would discard `completion` and `abort` when returned through an `async` loader.

Fig DOM's `payloadDataLoader` is the web/data-resource adapter:

```ts
function payloadDataLoader<TArgs extends unknown[]>(options: {
  request: (
    ...argsAndContext: [...TArgs, { signal: AbortSignal }]
  ) => Response | PromiseLike<Response>;
  loadClientReference?: LoadClientReference;
  resolveClientReference?: ResolveClientReference;
}): DataResource<TArgs, FigNode>["load"];
```

Internally it receives the complete load context plus private store authority, calls `request`, rejects non-success responses, requires a body, validates the response's payload codec/content type, and cancels unusable bodies. It passes the generation-lifetime `signal`, guarded internal hydration capability, and a DOM asset-preparation function to `decodePayloadStream`, observes `decode.completion`, and returns `decode.value`. Asset preparation uses `insertAssetResources`; its returned stylesheet gate delays only models/holes that declare a dependency on those assets. Post-root failures still follow the failure semantics below; the adapter must not create an unhandled rejection or silently discard a failed completion. This keeps the store's ordinary public loader contract and keeps HTTP, DOM-asset, and payload plumbing out of application loaders.

**`@bgub/fig/payload` keeps:**

- Payload value codec (`encodePayloadValue` / `decodePayloadValue`), data entry helpers, codec pluggability (`PayloadCodec`).
- `decodePayloadStream(stream, { signal, hydrate?, loadClientReference?, resolveClientReference?, prepareAssets? })` — the renderer-neutral client half; returns a `PayloadDecode`, ingests in the background, and aborts on the generation-lifetime signal. `prepareAssets(assets)` may return a promise that gates the dependent model/hole reveal. Browser-safe import home: `@bgub/fig/payload`.
- `PayloadDecode` exposes `value`, non-rejecting `completion`, and `abort(reason?)`; post-root work is never hidden behind an already-settled promise.
- Row types, codec negotiation helpers, error row decoding, and data-entry encode/decode helpers.

**`@bgub/fig` keeps:**

- `clientReference` (already in `@bgub/fig`).

**`@bgub/fig-server/payload` keeps:**

- `renderToPayloadStream(node, { codec?, onError?, highWaterMark?, signal? })` — the server half, minus boundary options.
- Error rows under the existing `onError → { digest?, message? }` contract.
- Asset rows and client-reference assets remain part of the format. The decoder passes them to `prepareAssets` as soon as their rows arrive and awaits its gate before revealing only dependent content.
- The streaming HTML renderer (`renderToStream`, `prerender`) — untouched; first paint keeps real streaming SSR.

**Fig DOM keeps:**

- `payloadDataLoader(options)` — adapts a response-producing callback into an ordinary data-resource loader, validates HTTP/payload responses, prepares DOM assets with `insertAssetResources`, and owns the internal hydrate / `decode.value` plumbing.

**fig-start owns:**

- The endpoint serving serialized components (sibling of the existing `remoteDataResource` data endpoint; same id/registration approach).
- Generated resource stubs that supply transport, response validation, manifests / `loadClientReference` wiring, and asset insertion without repeating them in application code.
- `.server.ts(x)` conventions and the `figData` transform.
- Frame-bound SSR hydration of in-flight streamed entries, built on the inline frame transport and the SSR Hydration Constraint above.

**Deleted after the deletion gate passes:**

- `PayloadBoundary` + duplicate-id dev check.
- `refresh` / `refresh-error` rows, `PAYLOAD_BOUNDARY_HEADER`, refresh id-range namespacing, targeted-refresh authority rule.
- `PayloadConsumer` as a public seam (`consumer.fetch`, `bindRoot`, `rootReady`, `preloadClientReferences`) — subsumed by the decoder + ordinary data resources. `PayloadFetchError` goes with it (loaders surface fetch failures as ordinary rejected refresh results).
- The document-render-consumes-a-payload-stream mode. The `ssr`-capable-reference path stays through migration and can be removed only after first-paint SSR and hydration tests demonstrate an equivalent path.

## Separate Package-Ownership Follow-up

Moving `serverDataResource`, the `figData` transform, and endpoint-discovery helpers is intentionally outside this plan. See `tmp/fig-start-bundler-ownership-plan.md` (scratch, not yet adopted). That reorganization is not on the critical path for proving serialized components as data resources.

## Open Questions (resolve before implementation)

1. **Decode memoization across refreshes.** First benchmark ordinary keyed reconciliation against the existing consumer: new element objects imply traversal, but not necessarily host replacement. If measurements justify cross-refresh identity, define a stable identity source such as server-authored segment keys or content hashes and its memory story. Request-local row/graph ids are allocation details and are not cross-refresh identity.

2. **"Fulfilled entry containing a rejected hole."** An `error` row after root rejects that hole's thenable → nearest `ErrorBoundary` inside the tree catches it (digest contract intact) while the entry stays fulfilled. New observable state; spec it explicitly, including how `invalidateDataError` attribution interacts with hole-level errors.

3. **Serialization scope rules.** Exactly which client APIs throw, at what point (render-time dispatcher trap), and what the error carries. (The read-verbs-are-server-safe / data-rows-hydrate-through-decode answers live in Data And Context Across The Boundary; the remaining work is the precise throw list.)

4. **Generation-lifetime loader context.** `signal` remains live after the loader promise fulfills and aborts when its generation is superseded, hydrated over, evicted, or disposed. The remaining decision is how the internal payload adapter capability interacts with partitions (does `dataPartition` on `renderToPayloadStream` survive?).

5. **Wire shape for the resource value.** The row stream is currently a whole-response format. Decide whether a serialized-component resource response _is_ a row stream (content-type + codec negotiation reused) or an envelope the framework defines. Lean: core defines stream-of-rows in, value out; framework owns HTTP.

6. **Optimistic-state primitive.** Out of scope: capture it in a separate plan and note the dependency from action/refresh UX.

## Failure Semantics

| Failure | Observable result |
| --- | --- |
| Transport, codec, or protocol failure before the root row | `decode.value` rejects; an existing resource value remains stale through ordinary failed-refresh semantics. |
| `error` row belonging to an outlined hole | That hole rejects; the nearest `ErrorBoundary` covering that decoded slot handles it. The fulfilled entry itself remains published. |
| Truncated or malformed stream after the root row | Every unresolved hole rejects with the transport/protocol error and propagates through its nearest `ErrorBoundary`; `decode.completion` resolves to `{ status: "failed", error }`; the fulfilled entry itself remains published. |
| Client-reference load or resolution failure | The referencing decoded component rejects through its nearest `ErrorBoundary`; completion reports failure only when the failure prevents protocol ingestion from continuing. |
| Abort or supersession | Remaining rows are ignored, unresolved holes reject with an internal abort reason that does not become a user error, and completion reports `aborted`. |
| Late `data` or asset row after authority is lost | The generation guard rejects it; it cannot mutate the store or insert assets. |

## Work Phases

**Phase 0 — spec.** Rewrite `docs/concepts/payload.md` around format-not-architecture (naming resolved: "payload" stays the format name and `payload.md` stays the concept home); add `@bgub/fig/payload` as the browser-safe payload decode home; update `data.md` (streamed values, fulfilled entries with live holes, hole errors, hydration timing), `errors.md` (hole rejection), `architecture.md` (ownership), `open-questions.md` (retire payload-codec/DevTools-fidelity items as stated; add the new open questions).

**Phase 1 — core payload decode.** Implement `PayloadDecode` and `decodePayloadStream` on top of the existing renderer + codec without deleting the current consumer or boundary protocol. Add client-API-throws enforcement, root-row settlement, observable background ingestion, asset preparation gates, and signal/decode abort. Tests: nesting client references, promises, shared objects, cycles inside streamed holes (per the existing codec test rule); every row in the failure-semantics table; asset preparation before dependent reveal; idempotent abort; proof that `PayloadDecode` is not thenable.

**Phase 2 — Fig DOM data-resource adapter and lifetime integration.** Implement `payloadDataLoader`; define generation-lifetime `signal` semantics and the private, generation-guarded hydration capability. Integrate `readData` returning element trees and `data`-row hydration through the adapter. Test response status/body/content-type validation, body cancellation, DOM asset insertion and dependent stylesheet gating, supersession, hydration-over, eviction, inactivity, disposal, transition-lane root publication, inner fallback behavior, and stub-store hydration buffering. E2e: stream a markdown-post-like resource that itself reads data, invalidate mid-view, verify progressive reveal, transition retention only at the appropriate already-revealed boundary, and cross-key freshening of a client subscriber.

**Phase 3 — parity and performance validation.** Port a non-authoritative demo-start path while the old consumer remains available. Benchmark ordinary keyed reconciliation against today's decoded-chunk memoization. Add stable cross-refresh segment identity only if the measurements justify it; do not infer identity from request-local graph ids.

**Phase 4 — Fig Start migration.** Port fig-start (`server.ts`, `client.ts`) and `apps/demo-start` to the endpoint + resource model, including frame-bound streamed hydration for the document path. Retain the old consumer, targeted refresh, and SSR-capable client references until the deletion gate below passes.

**Phase 5 — targeted-refresh removal.** Once the deletion gate passes, simplify `renderToPayloadStream`, remove boundary options and the consumer seam, and delete the targeted-refresh row protocol. Keep `clientReference`-in-hole loading overlap by starting loads as reference rows arrive.

**Separate follow-ups.** DevTools name fidelity for serialized trees and the optimistic-state primitive.

## Deletion Gate

Do not delete `PayloadBoundary`, targeted-refresh rows, `PayloadConsumer`, or SSR-capable client references until demo-start demonstrates all of the following on the resource model with tests:

- initial navigation and back/forward cache behavior;
- nested refresh granularity represented by nested resource keys;
- progressive holes and transition behavior at both outer and inner `Suspense` boundaries;
- data-row hydration, cross-key freshening, and rejection of late rows from obsolete generations;
- streamed asset insertion/reveal gating and client-reference loading overlap;
- interactive islands, first-paint SSR, and hydration without replacing server-rendered DOM;
- pre-root failure, post-root hole/protocol failure, retry, and aborted refresh recovery.

## Risks

- **Decode traversal may be a perf cliff.** Today's consumer bails unchanged subtrees out of re-renders. Measure ordinary keyed reconciliation before choosing a stable cross-refresh identity mechanism, but do not remove the consumer before parity is acceptable on large documents.
- **Losing sub-tree refresh granularity.** Boundary-level refresh becomes "define more resources." Fine in theory; validate on demo-start's actual routes before deleting `PayloadBoundary`.
- **Generation lifetime is a real data-store contract change.** Keeping loader signals live after root fulfillment must not leak listeners or let obsolete decoders hydrate data or insert assets.
- **Frame-bound SSR hydration** is the fiddliest new machinery and reintroduces transport complexity — contain it in fig-start; do not let it leak a contract into the store.
- **Churn window.** Pre-0.0.2, no external consumers — cost is as low as it will ever be, but `payload.md` is marked "stable API"; the spec change needs to land with the code (repo convention).
