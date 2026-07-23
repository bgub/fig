# Intentional Differences From React

Status: stable orientation

Fig keeps React's modern runtime ideas—fibers, lanes, hooks, Suspense, streaming, and selective hydration—but does not preserve every React API. This page is the quick map for React users. The linked concept files own the full contracts.

## Component Model

- There are no class components, string refs, legacy context, or legacy root APIs. Use `createRoot` and `hydrateRoot`.
- Context objects are their own providers: `<Theme value="dark">`. There is no `.Provider`, `Consumer`, or `displayName`.
- Development is always strict. There is no `StrictMode` component or opt-out.
- Batching is automatic. There is no public `batchedUpdates`; use `flushSync` only when work truly must commit now.
- `lazy(load)` expects the loader to return a component directly, not `{ default: Component }`.
- `ErrorBoundary` is a component with a sticky fallback. Change its key or remount it to reset.

## Hooks And Async Work

- Effects are named for when they run: `useReactive`, `useBeforePaint`, and `useBeforeLayout`.
- Long-lived callbacks receive an `AbortSignal` and return no cleanup. Fig aborts effects, binds, event handlers, stable events, transitions, actions, and data loads when their run loses authority.
- There is no `useReducer`; reducer helpers can use `useState`.
- There is no `useRef`. Use `bind` for DOM access and `useMemo(() => ({ current: null }), [])` for mutable storage.
- There is no `memo()`. Fig's bailouts preserve child identity automatically; memoize a child element when you intentionally want to pin a subtree.
- React's `use(resource)` is split into `readContext`, `readPromise`, and `readData`.
- `useStableEvent` is the general stable-callback primitive. It is not limited to effects and receives Fig's trailing signal.
- Async transitions keep post-`await` updates in the transition. Hook transitions and actions are cancellable; actions are last-run-wins rather than serial.
- Server action transport belongs to frameworks.

See [Hooks](./hooks.md) and [Rendering](./rendering.md).

## DOM And Events

- Host props use native names: `class`, `for`, `tabindex`, `stroke-width`, and `xlink:href`.
- Trusted raw HTML is `unsafeHTML`, not `dangerouslySetInnerHTML`.
- Event listeners use `mix={on("click", handler)}`, receive native events, and follow native propagation.
- `focus` and `blur` do not bubble. Use `focusin`, `focusout`, or capture.
- `input` and `change` keep their browser meanings. There is no React-style `onChange` remapping.
- DOM nodes use `bind`, not refs or `forwardRef`.
- Form `value` and `checked` control live properties. `defaultValue` and `defaultChecked` own the default and reflected HTML state.

Fig DOM's JSX types reject React spellings and event props at compile time. HTML and SVG use closed native attribute sets; MathML and custom elements remain open.

See [Events](./events.md), [Host mixins](./mixins.md), and [JSX](./jsx.md).

## Data And Assets

- Data resources live in `@bgub/fig`. Their array keys are canonical identities shared by reads, mutations, hydration, and Payload.
- The main freshness operations are `invalidateData` (mark stale) and `refreshData` (fetch now and return a result union).
- Ambient data functions work only during Fig's synchronous execution window. Capture `readDataStore()` or use `root.data` after `await`.
- Renderers install the store lazily from a resource; importing Fig does not register a global store.
- Asset resources replace React's implicit hoistables with plain descriptors such as `stylesheet`, `preload`, `script`, `title`, and `meta`.

See [Data resources](./data.md) and [Asset resources](./assets.md).

## Server Rendering

- Server rendering is Web-`ReadableStream`-first and returns its result object synchronously.
- Readiness uses `shellReady`, optional `headReady`, and `allReady` promises instead of shell callbacks.
- `renderToHtml` buffers the exact streamed output, including reveal scripts. It is not React's `renderToString`.
- `prerender` waits for all async work and produces settled static HTML.
- Consumer backpressure pauses output between complete chunks, not rendering itself. Fig has no `progressiveChunkSize` heuristic.
- Server errors cross the wire only through `onError(error, info) => ({ digest, message })`.
- Streaming Suspense uses inline scripts and a CSP nonce. Fig does not ship an alternate external reveal runtime.

See [Server rendering](./server-rendering.md) and [Suspense streaming](./suspense-streaming.md).

## Payload

Fig calls its server-component format **Payload**, never RSC or Flight. Those are React brands.

- `renderToPayloadStream` serializes a component tree.
- `decodePayloadStream` reconstructs it in a renderer-neutral client package.
- `payloadDataLoader` delivers it as an ordinary data-resource value, so the resource key is also the refresh boundary.
- Client references carry structured ids, export names, SSR capability, and assets.
- Errors carry only the server's digest/message result.
- Server actions and temporary references are not part of the row model.

See [Payload](./payload.md).

## Renderer Boundaries

- Every public export has one package home. Renderer packages do not mirror core APIs.
- Fibers and lanes stay private. Event priority crosses renderer boundaries as `"default"`, `"continuous"`, or `"discrete"`.
- The scheduler is internal and publishes no `unstable_` surface.
- Development behavior is removed through compile-time `__FIG_DEV__` gates rather than runtime environment checks or separate builds.
- Invalid render input throws before commit instead of warning afterward.

See [Architecture](./architecture.md) and [Renderer authoring](./renderer-authoring.md).

## Rename Cheat Sheet

| React                          | Fig                          |
| ------------------------------ | ---------------------------- |
| `className`, `htmlFor`         | `class`, `for`               |
| `onClick={fn}`                 | `mix={on("click", fn)}`      |
| `ref`, `forwardRef`            | `bind`                       |
| `dangerouslySetInnerHTML`      | `unsafeHTML`                 |
| `useEffect`                    | `useReactive`                |
| `useLayoutEffect`              | `useBeforePaint`             |
| `useInsertionEffect`           | `useBeforeLayout`            |
| `useEffectEvent`               | `useStableEvent`             |
| `startTransition`              | `transition`                 |
| `use(context)`, `use(promise)` | `readContext`, `readPromise` |
| RSC / Flight                   | Payload                      |
