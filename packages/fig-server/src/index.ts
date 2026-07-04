import type { FigNode } from "@bgub/fig";
import { createServerRenderRequest } from "./renderer.ts";
import type {
  ServerDocumentRenderResult,
  ServerFragmentRenderResult,
  ServerRenderOptions,
} from "./types.ts";

export { escapeAttribute, escapeText } from "./html.ts";

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
 * NOT React's `renderToString` (settled, script-free static markup is a
 * future prerender mode).
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
  ServerErrorInfo,
  ServerErrorPayload,
  ServerDocumentRenderResult,
  ServerFragmentRenderResult,
  ServerAssetDestination,
  ServerAssetErrorInfo,
  ServerRenderOptions,
} from "./types.ts";
