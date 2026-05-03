# @bgub/fig-server

Fig server renderer.

## Installation

```bash
pnpm add @bgub/fig-server
```

## Usage

```ts
import { renderToReadableStream, renderToString } from "@bgub/fig-server";
```

```ts
const result = renderToReadableStream(<App />);
await result.shellReady;

return new Response(result.stream, {
  headers: { "content-type": result.contentType },
});
```

`renderToReadableStream` is the primary API. It returns a
`ServerRenderResult` with a Web `ReadableStream`, a `shellReady` promise, an
`allReady` promise, a content type, and an abort handle. Pending Suspense
boundaries stream their fallback in the shell, then receive completed content
through nonce-compatible inline scripts. Aborting after the shell flushes the
affected boundaries as client-rendered fallbacks.

`renderToString` is a convenience wrapper that waits for `allReady` and
collects the readable stream:

```ts
const html = await renderToString(<App />);
```

The server renderer supports function components, fragments, context providers,
`useState` initial values, no-op server effects, host prop serialization,
streaming Suspense, partial segments inside Suspense boundaries, abort fallback
flushing, and Suspense-only server error recovery. Error boundaries do not catch
server render errors.

## License

MIT
