## @bgub/fig-reconciler@0.1.0-alpha.1

### Asset descriptors use native names and preserve native ordering

Client-inserted and host-rendered stylesheets now form precedence buckets in
the order each distinct precedence value is first discovered. A stylesheet
discovered later for an existing bucket is inserted before the following
bucket, keeping lazy and payload-delivered CSS in its intended cascade order.

Raw `<script>` elements now enter the asset registry only when explicitly
marked `async`. Non-async scripts retain their native document position and
execution semantics; explicit `script()` descriptors continue to support all
asset-delivery modes.

Asset descriptor options and serialized payload asset rows now use native HTML
attribute names: `crossorigin`, `fetchpriority`, and `http-equiv`. The previous
React-style `crossOrigin`, `fetchPriority`, and `httpEquiv` spellings are
removed.

Host resource resolution now receives the actual host parent and fixes
out-of-band placement once per fiber. SVG and MathML titles consequently stay
in their native namespace, while HTML titles carrying `itemprop` stay in-tree;
ordinary document titles continue to use the shared head registry.

### Restore shadowed document metadata when its winner leaves

Client title and meta entries now keep stable per-fiber ownership claims. The
latest acquired live claim controls the single canonical DOM element; updates
to shadowed claims stay dormant, and removing the winner immediately restores
the latest remaining value.

Hoisted host and declarative asset lifecycle callbacks receive an opaque,
stable `AssetResourceOwner`. Hoisted updates own the complete canonical host
update, including text, so a shadowed fiber cannot overwrite registry state.

### `@bgub/fig-reconciler/devtools` is now type-only

`devtoolsTypeName` and `getFigDevtoolsGlobalHook` were reconciler
implementation helpers, not part of the DevTools protocol; both moved
to an internal module. The subpath now exposes exactly the protocol and
snapshot types (`FigDevtoolsGlobalHook`, `FigDevtools*Snapshot`, ...).
DevTools frontends define their own hook accessor against the
`FigDevtoolsGlobalHook` shape, which is unchanged.

### DevTools show per-fiber data-resource dependencies

`@bgub/fig` data stores expose `inspectDataDependencyCanonicalKeys(owner)`,
a dev-only inspection read of the canonical keys an owner's committed
`readData` subscriptions point at (returns an empty array in prod builds).

`@bgub/fig-reconciler` devtools snapshots record those keys on every fiber
as `FigDevtoolsFiberSnapshot.dataResourceCanonicalKeys`. The field is
required, so external snapshot producers must supply it (empty array when
unknown).

The `@bgub/fig-devtools` panel filters the Data section by the selected
fiber's dependencies instead of always listing the entire store, and tree
rows show a green badge with the fiber's data-resource read count next to
the blue hook-count badge. Selecting
the root still lists every entry, including those with no committed
subscriber (unclaimed preloads, hydrated-but-unread rows). Refreshing
entries no longer render a redundant `Pending` row.

### Recover full-document Suspense hydration mismatches

Full-document hydration now escalates a mismatch inside the document-level
Suspense boundary to root recovery, preserves the document doctype, and
rebuilds the document without reusing cleared insertion anchors.

### `ensureData`: the awaitable read for code outside render

`ensureData(resource, ...args)` resolves the value a key would render with:
the cached value when the entry has one (kicking the same background
revalidation a stale `readData` does), or the in-flight load's settlement on
a cache miss. It rejects with the error `readData` would throw, follows
superseding loads and server hydrations to the authoritative value, and never
subscribes — pair it with `readData` in the component, which claims the
settled entry within the preload retention window. An awaiting caller retains
the entry, so the unclaimed-preload eviction cannot abort a load out from
under an ensure.

Available as a free function (ambient store) and on the explicit handle
(`readDataStore()`, `root.data`). This is the delegation verb for external
routers: a route loader awaits `ensureData`, the component reads with
`readData`, and the data store stays the single cache.

### Keep `useId` stable through selective hydration

`useId` now follows one canonical server/hydration tree path through Suspense
and Activity. Dehydrated boundaries snapshot that path when they claim their
server marker, then restore it when hydration resumes, so client updates that
insert or move surrounding siblings cannot renumber ids already present in the
server HTML. Suspense's private Activity wrapper is transparent to the path.

Components mounted only on the client now receive ids from a separate
`fig-C-*` namespace. Those ids remain stable for the component lifetime and
cannot collide with ids reserved by server-rendered content that has not
hydrated yet.

### `isValidElement` has a single home on the main entry

`isValidElement` was the one runtime export with two homes: the app-facing
main entry and `@bgub/fig/internal` (grouped with the other `$$typeof`
brand predicates). It is now exported only from `@bgub/fig`; the renderer
and server packages import it from there. The internal-only predicates
(`isSuspense`, `isPortal`, ...) are unchanged.

### Make DOM View Transitions explicitly optional

`enableViewTransitions()` from `@bgub/fig-dom/view-transitions` explicitly
activates native DOM View Transitions, including after roots exist. Applications
that omit the optional entry exclude both the reconciler planner and browser
adapter from their bundles.

Renderer authors can install the optional View Transition planner through the
new single-owner commit-coordinator seam. Coordinator types preserve the host's
container and instance identities, while a private type-only contract keeps the
planner's fiber and root views aligned with the reconciler.

### Promise-valued children render through Suspense

`FigNode` now accepts promises of nodes. Promise children occupy distinct,
host-transparent child slots, suspend through the nearest `Suspense`, and route
rejections or invalid resolved children through normal error handling.

HTML rendering retains exact promise children as independent streaming tasks,
while Payload uses node-validated promise rows that decode to the same child
shape. Payload-rendered async components are invoked once and retain their
component-scoped assets on the outlined row.

### Move `act` to `@bgub/fig-reconciler/test-utils`

`act` is testing infrastructure, not renderer construction, so it moves
off the main entry onto a `./test-utils` subpath — the same shape as
`@bgub/fig-dom/test-utils`. DOM tests keep importing `act` from
`@bgub/fig-dom/test-utils`; renderer tests now import it from
`@bgub/fig-reconciler/test-utils`. Behavior is unchanged; the subpath
shares the scheduler instance with the main entry.

### Remove `HostRenderConfig` and `HostValidationConfig`

Both were plain `Pick<HostConfig, ...>` regroupings with no consumers
and no enforcement value. The capability types stay: those are
coherent host method groups for renderers that implement them. Their
`Required<Pick<...>>` portions express complete required method sets,
while intersections preserve deliberately optional notifications such
as `commitHydratedInstance`. `HostPortalConfig` describes the optional
portal lifecycle pair; portals themselves use the core mutation methods.
Hosts that referenced the removed aliases should use
`Pick<HostConfig, ...>` inline or `HostConfig` itself.

### Mark host subtrees committed when a re-placed wrapper inserts them

Re-placing a reused non-host fiber (for example a component moved during the
same commit that reveals a captured Suspense primary) inserts its host
subtree in one pass. Those host fibers were never individually placed, so
they kept claiming they had never committed; the next re-render then
re-assembled their live instances during the render phase, detaching
committed children and crashing the commit's recorded deletions with
`NotFoundError: removeChild`. Subtree insertion now marks never-committed
host fibers committed (acquiring uncommitted hoisted instances), exactly
like a direct host placement, and a dev-mode parity assert fails the commit
that inserts a placed host fiber without marking it — catching the whole
class at its source instead of at the next navigation's crash.

### Fix first-load styling and development client navigation

Keep TanStack Start's compiler-sensitive client modules out of Vite dependency
prebundling so client navigation uses the client server-function transport
instead of executing server-only context access in the browser. Preserve
browser-extension roots appended to document singletons during hydration so a
third-party node cannot trigger document replacement and remove stylesheets.

### Preserve framework-managed asset placement

Framework adapters can now keep externally managed head and body tags in their
declared positions without exposing a DOM prop. TanStack Router uses this for
route-managed links, styles, and scripts while continuing to map title and meta
entries through Fig asset resources. Full-document hydration now ignores the
doctype and one shared marker identifies every server-owned node without a
client fiber. Declarative asset lists also gain a client commit lifecycle, so
route titles and metadata update during navigation.

### Add the TanStack Start runtime adapter

`createDataStore` now creates a root-neutral Fig store that route loaders can
populate before a renderer exists. Server and client renderers adopt that exact
store, preserving one cache while attaching their lifecycle and scheduling.

The new TanStack Start runtime uses the store for route loading, server
rendering, Fig-owned document serialization, client deserialization, and
hydration. Route-managed head and script output maps through the Router adapter,
including Fig asset resources. The end-to-end contract verifies no initial
client refetch and exactly one reload after invalidation.

### Add typed View Transition scopes and abortable lifecycle events

`transition` and the `useTransition` starter now accept explicit transition
types, which Fig carries with the updates that reach each root and forwards to
the browser without leaking into unrelated commits.

`ViewTransition` adds one `onTransition(event, signal)` lifecycle callback for
enter, exit, share, and update phases. Events expose all participating surfaces
and the commit's transition types. Fig DOM's optional View Transition entry can
resolve those opaque surfaces into group, image-pair, old, and new pseudo
handles for animation and inspection; the signal aborts when the native
transition finishes.

## @bgub/fig-reconciler@0.1.0-alpha.0 (alpha)

### Initial alpha release

First public alpha release of Fig.
