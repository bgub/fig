# @bgub/fig-server

Fig server renderer.

## Installation

```bash
pnpm add @bgub/fig-server
```

Fig packages are ESM-only and require Node `^20.19.0 || >=22.12.0` for Node runtime entry
points.

## Usage

```ts
import {
  prerender,
  renderToDocumentHtml,
  renderToDocumentStream,
  renderToStream,
  renderToHtml,
} from "@bgub/fig-server";
```

```ts
const result = renderToDocumentStream(
  <html>
    <head>
      <meta charset="utf-8" />
    </head>
    <body>
      <App />
    </body>
  </html>,
);
await result.shellReady;

return new Response(result.stream, {
  headers: { "content-type": result.contentType },
});
```

Fig server rendering intentionally uses Web `ReadableStream`s instead of
Node-specific streams. Web streams give Fig one streaming API for modern Node,
edge runtimes, Deno, Bun, and browser-like hosts; Node pipeable stream helpers
would be compatibility adapters rather than the primary SSR surface.

`renderToDocumentStream` is the primary SSR API when Fig owns the whole
document. The root must render an `<html>` element with a `<head>`. Fig prepends
`<!doctype html>`, injects collected head resources before `</head>`, and then
streams the body with Suspense updates.

`renderToStream` is the lower-level fragment/body API. It returns a
`ServerFragmentRenderResult` with a Web `ReadableStream`, `headReady`,
`shellReady`, and `allReady` promises, a `getHead()` method, a content type, and
an abort handle. Pending Suspense boundaries stream their fallback in the shell,
then receive completed content through nonce-compatible inline scripts. Aborting
after the shell flushes the affected boundaries as client-rendered fallbacks.

`renderToHtml` buffers the streamed output: it waits for `allReady` and
collects the readable stream:

```ts
const html = await renderToHtml(<App />);
const documentHtml = await renderToDocumentHtml(
  <html>
    <head />
    <body>
      <App />
    </body>
  </html>,
);
```

`prerender` is the settled static renderer for SSG, email, RSS, Open Graph
markup, and tests that should not record streaming protocol details. It waits
for all async work before emitting HTML, so fulfilled Suspense boundaries render
their completed content in logical position with no fallback, staging container,
or `__figSSR` reveal script. Suspense boundaries that fail on the server render
their fallback with a static client-render marker so hydratable pages can retry
that boundary on the client.

```ts
const result = await prerender(<App />, { signal });

result.html;
result.head; // fragment-mode head assets
result.data; // data-resource hydration entries
```

For document output, pass `document: true`; the root must render an `<html>`
document with a `<head>`, and collected head assets are inlined into that
document head:

```ts
const result = await prerender(
  <html>
    <head />
    <body>
      <App />
    </body>
  </html>,
  { document: true },
);
```

Pass `identifierPrefix` when multiple streaming renders share a document. Fig
uses it in generated Suspense marker and script identifiers, and it defaults to
an empty string.

## Data Resources

Server render requests have their own data-resource store. Reads through
`@bgub/fig` dedupe by key within the request and fulfilled entries are
available through `result.getData()`:

```tsx
import { readData } from "@bgub/fig";
import { serverDataResource } from "@bgub/fig/server";
import { renderToStream } from "@bgub/fig-server";

const userResource = serverDataResource<[string], { name: string }>({
  key: (id) => ["user", id],
  load: async (id, { signal }) => fetchUser(id, signal),
});

function Profile({ id }: { id: string }) {
  const user = readData(userResource, id);
  return <h1>{user.name}</h1>;
}

const result = renderToStream(<Profile id="one" />);
await result.allReady;

const initialData = result.getData();
```

Pass `initialData` to `createRoot(...)` or `hydrateRoot(...)` on the client to
hydrate those values by key. Client imports can use a loader-less resource with
the same key; if no client loader exists, `refreshData(...)` reports
`unsupported` and a framework/payload refresh path should revalidate the key.

## Resources

Use `assets([...], children)` from `@bgub/fig` to attach document resources to
a subtree:

```tsx
import { assets, stylesheet, title } from "@bgub/fig";

function Page() {
  return assets(
    [title("Fig"), stylesheet("/app.css", { precedence: "app" })],
    <main>Ready</main>,
  );
}
```

The document renderer keeps head-only metadata separate from body segment HTML
and injects `title()` and `meta()` before `</head>`. With the lower-level
`renderToStream`, those tags are available through `result.getHead()`
after `headReady`; they are never emitted into segment HTML. `headReady`
resolves with the shell and seals the initial document head; `getHead()` keeps
returning that sealed snapshot afterward. If a new head resource is found
later, such as behind pending Suspense, Fig reports it through `onAssetError`
instead of adding it to the already-flushed head, so required shell metadata
should render before `headReady`.

```ts
const result = renderToStream(<Page />);
await result.headReady;

response.write(`<!doctype html><html><head>${result.getHead()}</head><body>`);
```

Document-mode host resource tags lower to the same registry as helper-created
resources:

```tsx
function Page() {
  return (
    <>
      <title>Page</title>
      <meta name="description" content="..." />
      <link rel="stylesheet" href="/page.css" precedence="app" />
      <script type="module" src="/page.js" />
    </>
  );
}
```

Metadata discovered before `headReady` is injected into the initial document
head. Metadata discovered after `headReady`, for example inside pending
Suspense content, is reported through `onAssetError` and is not added to the
already-flushed shell. Stylesheets discovered for later Suspense segments remain
stream-safe: Fig emits them near the segment and gates reveal until they load
unless `{ blocking: "none" }` opts out.

Stylesheets, preloads, fonts, preconnects, and scripts are body-stream-safe
resources. Fig hoists them before the HTML segment that depends on them and
dedupes identical resources. Stylesheets block streamed Suspense reveals by
default; pass `{ blocking: "none" }` to opt out for non-critical styles.

Resource duplicates are checked by key and behavior. Identical duplicates dedupe
silently. Conflicting duplicates throw: for example, the same stylesheet `href`
with a different `media`, the same `title` key with a different value, or the
same meta `name` with different `content`. Preloads are keyed by `href` plus
`as`, so the same URL can be preloaded for distinct targets, but behavior fields
such as `type`, `crossOrigin`, and `fetchPriority` must match for duplicates.
Conflict errors include the resource key plus the existing and incoming
resources.

The `assets` option can attach asset resources to component modules without
wrapping the component tree. It is a string-keyed record intended for
bundler/module ids. Use `resolveAssetKey` to map a component type to one of
those ids:

```tsx
renderToStream(<Page />, {
  resolveAssetKey: (type) => (type === Page ? "app/page.tsx" : undefined),
  assets: {
    "app/page.tsx": [title("Page"), stylesheet("/page.css")],
  },
});
```

Manifest assets use the same registry, destination rules, dedupe checks, and
Suspense reveal gating as explicit `assets(...)` wrappers.

## Payload (server components)

```ts
import {
  createPayloadConsumer,
  decodePayloadValue,
  encodePayloadValue,
  jsonPayloadCodec,
  PAYLOAD_BOUNDARY_HEADER,
  renderToPayloadStream,
  PayloadBoundary,
  PayloadFetchError,
  type PayloadCodec,
} from "@bgub/fig-server/payload";
```

`renderToPayloadStream(node, options?)` renders a server-component payload. The
result exposes `abort(reason?)`, and `options.signal` also cancels the render;
both paths reject `allReady`. The default `jsonPayloadCodec` writes one
readable JSON row per newline and identifies itself with
`text/x-fig-payload; codec=json; charset=utf-8`. Pass a custom `PayloadCodec`
to both `renderToPayloadStream(node, { codec })` and
`createPayloadConsumer({ codec })` when both ends should use a different byte
encoding. Codec ids are implementation ids, not stable public wire formats.

Pass `refreshBoundary` to render a targeted boundary refresh:

```tsx
renderToPayloadStream(<FeedItems />, { refreshBoundary: "feed" });
```

The rendered node must be the replacement content for that boundary. Do not
include a nested `<PayloadBoundary id="feed">` wrapper in the refresh payload.

`createPayloadConsumer()` creates the decoding end of the wire, and
`consumer.fetch(input, options?)` fetches and processes a payload. Pass
`refreshBoundary` to `consumer.fetch` to request and apply a boundary refresh.
`consumer.fetch` sends the consumer codec in `Accept` and checks the response
`codec=` content-type parameter before decoding. Server integrations can read
the exported `PAYLOAD_BOUNDARY_HEADER` constant for targeted refresh requests.
Non-2xx responses reject with `PayloadFetchError`, which exposes `status` and
`response` and cancels the response body before throwing.
Decoded client references require `loadClientReference` or a matching
`resolveClientReference` before render; metadata-only decodes can still inspect
rows without configuring a loader.

`encodePayloadValue` / `decodePayloadValue` are low-level helpers for payload
integrations that need the same data-value fidelity as payload data rows:
`undefined`, `Date`, `Map`, `Set`, `BigInt`, non-finite numbers, `-0`, and
global `Symbol.for` symbols round-trip. Shared references and cycles across
arrays, plain objects, `Map`, and `Set` also round-trip; functions, class
instances, and non-global symbols are rejected.

The server renderer supports function components, fragments, context providers,
`useState` initial values, `useSyncExternalStore` server snapshots, no-op server
effects, host prop serialization, streaming Suspense, partial segments inside
Suspense boundaries, resource hoisting, abort fallback flushing, and
Suspense-only server error recovery. Host elements may render trusted raw content
with `unsafeHTML`, which is written without escaping and cannot be combined with
children. Error boundaries do not catch server render errors.

## License

MIT
