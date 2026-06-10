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

## Resources

Use `resources([...], children)` from `@bgub/fig` to attach document resources to
a subtree:

```tsx
import { resources, stylesheet, title } from "@bgub/fig";

function Page() {
  return resources(
    [title("Fig"), stylesheet("/app.css", { precedence: "app" })],
    <main>Ready</main>,
  );
}
```

The document renderer keeps head-only metadata separate from body segment HTML
and injects `title()` and `meta()` before `</head>`. With the lower-level
`renderToReadableStream`, those tags are available through `result.getHead()`
after `headReady`; they are never emitted into segment HTML. `headReady`
resolves with the shell and seals the initial document head. If a new head
resource is found later, such as behind pending Suspense, Fig reports it through
`onResourceError`. You can still call `getHead()` again after `allReady` if your
server intentionally waits for complete metadata, but required shell metadata
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
Suspense content, is reported through `onResourceError` and is not added to the
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

`resources` can attach resources to component modules without wrapping the
component tree. It is a string-keyed record intended for bundler/module ids.
Use `resolveResourceKey` to map a component type to one of those ids:

```tsx
renderToReadableStream(<Page />, {
  resolveResourceKey: (type) => (type === Page ? "app/page.tsx" : undefined),
  resources: {
    "app/page.tsx": [title("Page"), stylesheet("/page.css")],
  },
});
```

Manifest resources use the same registry, destination rules, dedupe checks, and
Suspense reveal gating as explicit `resources(...)` wrappers.

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
