import type { FigNode } from "@bgub/fig";
import { createServerRenderRequest } from "./renderer.ts";
import type { ServerRenderOptions, ServerRenderResult } from "./types.ts";

const contentType = "text/html; charset=utf-8";

export function renderToReadableStream(
  node: FigNode,
  options: ServerRenderOptions = {},
): ServerRenderResult {
  const request = createServerRenderRequest(node, options);

  return {
    ...request,
    contentType,
  };
}

export async function renderToString(
  node: FigNode,
  options: ServerRenderOptions = {},
): Promise<string> {
  const result = renderToReadableStream(node, options);
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
  ServerRenderOptions,
  ServerRenderResult,
} from "./types.ts";
