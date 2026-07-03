import type { FigNode } from "@bgub/fig";
import { createServerRenderRequest } from "./renderer.ts";
import type {
  ServerDocumentRenderResult,
  ServerFragmentRenderResult,
  ServerRenderOptions,
} from "./types.ts";

export { escapeAttribute, escapeText } from "./html.ts";

export function renderToReadableStream(
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

export async function renderToString(
  node: FigNode,
  options: ServerRenderOptions = {},
): Promise<string> {
  const result = renderToReadableStream(node, options);
  await result.allReady;
  return readStreamToString(result.stream);
}

export async function renderDocumentToString(
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
