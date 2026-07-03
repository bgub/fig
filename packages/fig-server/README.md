# @bgub/fig-server

Fig server renderer.

## Installation

```bash
pnpm add @bgub/fig-server
```

## Usage

```ts
import {
  renderDocumentToString,
  renderToDocumentStream,
  renderToReadableStream,
  renderToString,
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

`renderToReadableStream` is the lower-level fragment/body API. It returns a
`ServerFragmentRenderResult` with a Web `ReadableStream`, `headReady`,
`shellReady`, and `allReady` promises, a `getHead()` method, a content type, and
an abort handle. Pending Suspense boundaries stream their fallback in the shell,
then receive completed content through nonce-compatible inline scripts. Aborting
after the shell flushes the affected boundaries as client-rendered fallbacks.

`renderToString` is a convenience wrapper that waits for `allReady` and
collects the readable stream:

```ts
const html = await renderToString(<App />);
const documentHtml = await renderDocumentToString(
  <html>
    <head />
    <body>
      <App />
    </body>
  </html>,
);
```

Pass `identifierPrefix` when multiple streaming renders share a document. Fig
uses it in generated Suspense marker and script identifiers, and it defaults to
an empty string.

## Data Resources

Server render requests have their own data-resource store. Reads through
`@bgub/fig-data` dedupe by key within the request and fulfilled entries are
available through `result.getData()`:

```tsx
import { dataResource, readData } from "@bgub/fig-data";
import { renderToReadableStream } from "@bgub/fig-server";

const userResource = dataResource.server(
  dataResource.identity<[string], { name: string }>({
    key: (id) => ["user", id],
    name: "User",
  }),
  {
    load: async (id, { context }) => context.users.find(id),
  },
);

function Profile({ id }: { id: string }) {
  const user = readData(userResource, id);
  return <h1>{user.name}</h1>;
}

const result = renderToReadableStream(<Profile id="one" />, {
  dataContext: { users },
});
await result.allReady;

const initialData = result.getData();
```

Pass `initialData` to `createRoot(...)` or `hydrateRoot(...)` on the client to
hydrate those values by key. Client imports can use the identity-only resource;
if no client loader exists, `refreshData(...)` reports `unsupported` and a
framework/RSC refresh path should revalidate the key.

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
`renderToReadableStream`, those tags are available through `result.getHead()`
after `headReady`; they are never emitted into segment HTML. `headReady`
resolves with the shell and seals the initial document head; `getHead()` keeps
returning that sealed snapshot afterward. If a new head resource is found
later, such as behind pending Suspense, Fig reports it through `onAssetError`
instead of adding it to the already-flushed head, so required shell metadata
should render before `headReady`.

```ts
const result = renderToReadableStream(<Page />);
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
renderToReadableStream(<Page />, {
  resolveAssetKey: (type) => (type === Page ? "app/page.tsx" : undefined),
  assets: {
    "app/page.tsx": [title("Page"), stylesheet("/page.css")],
  },
});
```

Manifest assets use the same registry, destination rules, dedupe checks, and
Suspense reveal gating as explicit `assets(...)` wrappers.

## RSC

```ts
import {
  createRscResponse,
  fetchRsc,
  renderToRscStream,
  RscBoundary,
} from "@bgub/fig-server/rsc";
```

`renderToRscStream(node, options?)` renders a Server Component payload.
Pass `refreshBoundary` to render a targeted boundary refresh:

```tsx
renderToRscStream(<Dashboard />, { refreshBoundary: "feed" });
```

`createRscResponse()` decodes streamed rows on the client, and
`fetchRsc(response, input, options?)` fetches and processes a payload. Pass
`refreshBoundary` to `fetchRsc` to request and apply a boundary refresh.

The server renderer supports function components, fragments, context providers,
`useState` initial values, `useExternalStore` server snapshots, no-op server
effects, host prop serialization, streaming Suspense, partial segments inside
Suspense boundaries, resource hoisting, abort fallback flushing, and
Suspense-only server error recovery. Host elements may render trusted raw content
with `unsafeHTML`, which is written without escaping and cannot be combined with
children. Error boundaries do not catch server render errors.

## License

MIT
