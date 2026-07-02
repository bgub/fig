import type { FigNode } from "@bgub/fig";
import { createServerRenderRequest } from "./renderer.ts";
import type {
  ServerDocumentRenderResult,
  ServerFragmentRenderResult,
  ServerRenderOptions,
} from "./types.ts";

const contentType = "text/html; charset=utf-8";

export function renderToReadableStream(
  node: FigNode,
  options: ServerRenderOptions = {},
): ServerFragmentRenderResult {
  const request = createServerRenderRequest(node, options);

  return {
    ...request,
    contentType,
  };
}

export function renderToDocumentStream(
  node: FigNode,
  options: ServerRenderOptions = {},
): ServerDocumentRenderResult {
  const request = createServerRenderRequest(node, options, {
    document: true,
  });
  request.headReady.catch(() => undefined);

  return {
    abort: (reason) => request.abort(reason),
    allReady: request.allReady,
    contentType,
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
  result.headReady.catch(() => undefined);
  result.shellReady.catch(() => undefined);
  await result.allReady;
  return readStreamToString(result.stream);
}

export async function renderDocumentToString(
  node: FigNode,
  options: ServerRenderOptions = {},
): Promise<string> {
  const result = renderToDocumentStream(node, options);
  result.shellReady.catch(() => undefined);
  await result.allReady;
  return readStreamToString(result.stream);
}

function readStreamToString(
  stream: ReadableStream<Uint8Array>,
): Promise<string> {
  const reader = stream.getReader();
  const textDecoder = new TextDecoder();
  let output = "";

  return reader.read().then(function readNext(result): Promise<string> {
    if (result.done) {
      output += textDecoder.decode();
      return Promise.resolve(output);
    }

    output += textDecoder.decode(result.value, { stream: true });
    return reader.read().then(readNext);
  });
}

export type {
  ServerErrorInfo,
  ServerErrorPayload,
  ServerDocumentRenderResult,
  ServerFragmentRenderResult,
  ServerAssetDestination,
  ServerAssetErrorInfo,
  ServerRenderOptions,
  ServerRenderResult,
} from "./types.ts";
