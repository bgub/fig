import type { FigNode } from "@bgub/fig";

export interface ServerRenderOptions {
  /**
   * Prefix for generated streaming Suspense identifiers.
   * Defaults to an empty string.
   */
  identifierPrefix?: string;
  nonce?: string;
  onError?: (
    error: unknown,
    info: ServerErrorInfo,
  ) => ServerErrorPayload | undefined;
  onShellError?: (error: unknown) => void;
  signal?: AbortSignal;
}

export interface ServerErrorInfo {
  componentStack: string;
}

export interface ServerErrorPayload {
  digest?: string;
  message?: string;
}

export interface ServerRenderRequest {
  abort(reason?: unknown): void;
  allReady: Promise<void>;
  shellReady: Promise<void>;
  stream: ReadableStream<Uint8Array>;
}

export interface ServerRenderResult extends ServerRenderRequest {
  contentType: "text/html; charset=utf-8";
}

export type ServerRenderable = FigNode;
