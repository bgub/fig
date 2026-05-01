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
const result = await renderToReadableStream(<App />);

return new Response(result.stream, {
  headers: { "content-type": result.contentType },
});
```

`renderToReadableStream` is the primary API. It returns a
`ServerRenderResult` with a Web `ReadableStream`, an `allReady` promise, a
content type, and an abort handle.

`renderToString` is a convenience wrapper that collects the readable stream:

```ts
const html = await renderToString(<App />);
```

The first implementation renders plain HTML. It supports function components,
fragments, context providers, `useState` initial values, no-op server effects,
host prop serialization, and Suspense fallbacks for pending promises.

## License

MIT
