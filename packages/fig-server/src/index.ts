import type { FigNode } from "@bgub/fig";
import { createServerRenderRequest } from "./renderer.ts";
import type {
  ServerDocumentRenderResult,
  ServerFragmentRenderResult,
  ServerPrerenderOptions,
  ServerPrerenderResult,
  ServerRenderOptions,
} from "./types.ts";

export {
  createRenderTreeCollector,
  type RenderTreeCollector,
  type RenderTreeKind,
  type RenderTreeNode,
} from "./render-tree.ts";

// The four render entry points form one grid: render + To + (Document?) +
// output form. Stream results are returned synchronously — a shell failure
// rejects `shellReady` (and the stream); there is no callback channel.

export function renderToStream(
  node: FigNode,
  options: ServerRenderOptions = {},
): ServerFragmentRenderResult {
  return createServerRenderRequest(node, options);
}

export function renderToDocumentStream(
  node: FigNode,
  options: ServerRenderOptions = {},
): ServerDocumentRenderResult {
  const request = createServerRenderRequest(node, options, {
    document: true,
  });

  // Document mode owns the head: expose the stream result without the
  // fragment-only head accessors.
  return {
    abort: (reason) => request.abort(reason),
    allReady: request.allReady,
    contentType: request.contentType,
    getData: () => request.getData(),
    shellReady: request.shellReady,
    stream: request.stream,
  };
}

/**
 * The streamed output, buffered: awaits `allReady` and concatenates exactly
 * the bytes a streaming client would have received — including the inline
 * streaming runtime and boundary-reveal scripts when the tree suspends past
 * the shell. Right for caching responses and snapshotting wire output; it is
 * NOT React's `renderToString` (use `prerender` for settled, script-free
 * static markup).
 */
export async function renderToHtml(
  node: FigNode,
  options: ServerRenderOptions = {},
): Promise<string> {
  const result = renderToStream(node, options);
  await result.allReady;
  return readStreamToString(result.stream);
}

/** Document-mode {@link renderToHtml}: the streamed document, buffered. */
export async function renderToDocumentHtml(
  node: FigNode,
  options: ServerRenderOptions = {},
): Promise<string> {
  const result = renderToDocumentStream(node, options);
  await result.allReady;
  return readStreamToString(result.stream);
}

/**
 * Settled static HTML: waits for all async work before flushing, so completed
 * Suspense content is emitted in logical position without streaming scripts.
 */
export async function prerender(
  node: FigNode,
  options: ServerPrerenderOptions = {},
): Promise<ServerPrerenderResult> {
  const { document = false, ...renderOptions } = options;
  const result = createServerRenderRequest(node, renderOptions, {
    document,
    prerender: true,
  });

  await result.allReady;
  const html = await readStreamToString(result.stream);

  return {
    data: result.getData(),
    head: document ? "" : result.getHead(),
    html,
  };
}

async function readStreamToString(
  stream: ReadableStream<Uint8Array>,
): Promise<string> {
  const reader = stream.getReader();
  const textDecoder = new TextDecoder();
  let output = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) return output + textDecoder.decode();
    output += textDecoder.decode(value, { stream: true });
  }
}

export type {
  ServerAssetDestination,
  ServerAssetErrorInfo,
  ServerDocumentRenderResult,
  ServerErrorInfo,
  ServerErrorPayload,
  ServerFragmentRenderResult,
  ServerPrerenderOptions,
  ServerPrerenderResult,
  ServerRenderOptions,
} from "./types.ts";
