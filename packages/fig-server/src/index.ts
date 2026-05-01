import type { FigNode } from "@bgub/fig";
import { renderServerTree } from "./renderer.ts";

export interface ServerRenderOptions {
  signal?: AbortSignal;
  onError?: (error: unknown) => void;
}

export interface ServerRenderResult {
  stream: ReadableStream<Uint8Array>;
  allReady: Promise<void>;
  contentType: "text/html; charset=utf-8";
  abort(reason?: unknown): void;
}

const textEncoder = new TextEncoder();
const contentType = "text/html; charset=utf-8";

export async function renderToReadableStream(
  node: FigNode,
  options: ServerRenderOptions = {},
): Promise<ServerRenderResult> {
  throwIfAborted(options.signal);

  const controller = new AbortController();
  const signal = controller.signal;
  const abort = (reason?: unknown) => {
    if (!signal.aborted) controller.abort(reason);
  };

  if (options.signal !== undefined) {
    options.signal.addEventListener(
      "abort",
      () => abort(options.signal?.reason),
      { once: true },
    );
  }

  let html: string;
  try {
    html = renderServerTree(node, { signal }).html;
  } catch (error) {
    reportError(options, error);
    throw error;
  }

  const stream = new ReadableStream<Uint8Array>({
    start(streamController) {
      if (signal.aborted) {
        streamController.error(abortReason(signal));
        return;
      }

      if (html !== "") streamController.enqueue(textEncoder.encode(html));
      streamController.close();
    },
    cancel(reason) {
      abort(reason);
    },
  });

  return {
    stream,
    allReady: Promise.resolve(),
    contentType,
    abort,
  };
}

export async function renderToString(
  node: FigNode,
  options: ServerRenderOptions = {},
): Promise<string> {
  const result = await renderToReadableStream(node, options);

  try {
    const html = await readStreamToString(result.stream);
    await result.allReady;
    return html;
  } catch (error) {
    await result.allReady.catch(() => undefined);
    throw error;
  }
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

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) throw abortReason(signal);
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new Error("Server render was aborted.");
}

function reportError(options: ServerRenderOptions, error: unknown): void {
  try {
    options.onError?.(error);
  } catch {
    // Error reporting should not replace the render failure.
  }
}
