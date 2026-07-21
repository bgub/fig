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

Streams respect consumer backpressure: once the stream's internal queue holds
`highWaterMark` encoded bytes (default 65536), completed Suspense content
waits in segment form and flushes as the consumer reads. Rendering itself
never pauses, so `shellReady`/`allReady` settle at the same time regardless of
how fast the stream is consumed.

## Content Security Policy

Every script Fig streams is inline: the Suspense reveal runtime, the
per-boundary reveal ops, and the early event-capture script that opens a
document `<head>`. Under a CSP that restricts `script-src`, generate a
per-request nonce, pass it as the `nonce` option, and allow it in the header —
Fig adds it to every inline script and to emitted `<script>`/`<link>` resource
tags:

```ts
const nonce = crypto.randomUUID();
const result = renderToDocumentStream(<App />, { nonce });

return new Response(result.stream, {
  headers: {
    "content-type": result.contentType,
    "content-security-policy": `script-src 'self' 'nonce-${nonce}'`,
  },
});
```

The nonce is the whole CSP story. Fig intentionally ships no external-runtime
alternative for nonce-less strict CSP (per-render op scripts also rule out
static `script-src` hashes), so streamed Suspense requires the nonce. If you
cannot attach one, use `prerender`: fragment mode emits no scripts at all, and
document mode emits only the nonce-carrying early event-capture script.

## Data Resources

Server render requests have their own data-resource store by default. Reads
through `@bgub/fig` dedupe by key within the request and fulfilled entries are
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

Adapters that run loaders before rendering can create the store themselves.
The renderer adopts that exact store instead of copying its entries:

```tsx
import { createDataStore } from "@bgub/fig";
import { renderToStream } from "@bgub/fig-server";

const dataStore = createDataStore();
await dataStore.ensureData(userResource, "one");

const result = renderToStream(<Profile id="one" />, { dataStore });
result.data === dataStore; // true
```

One renderer may adopt a store, and that renderer owns its lifetime.

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
such as `type`, `crossorigin`, and `fetchpriority` must match for duplicates.
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
import { renderToPayloadStream } from "@bgub/fig-server/payload";
```

`renderToPayloadStream(node, options?)` renders a server-component payload. The
result exposes `stream`, `contentType`, and `allReady`; cancellation is
signal-only — aborting `options.signal` (or cancelling the stream) cancels the
render and rejects `allReady`. Pass the stream and content type directly to a `Response`. Browser
code decodes it with `decodePayloadStream` from `@bgub/fig/payload`, normally
through fig-dom's `payloadDataLoader` adapter. Rows, codecs, value encoding, and
framework document transports are internal implementation details.

The public options cover error sanitization (`onError`), manifest-provided
client assets (`clientReferenceAssets`), data-store partitioning, byte
backpressure (`highWaterMark`), and cancellation (`signal`).

The server renderer supports function components, fragments, context providers,
`useState` initial values, `useSyncExternalStore` server snapshots, no-op server
effects, host prop serialization, streaming Suspense, partial segments inside
Suspense boundaries, resource hoisting, abort fallback flushing, and
Suspense-only server error recovery. Host elements may render trusted raw content
with `unsafeHTML`, which is written without escaping and cannot be combined with
children. Error boundaries do not catch server render errors.

## License

MIT
