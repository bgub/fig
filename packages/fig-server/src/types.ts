import type {
  ElementType,
  FigNode,
  FigResource,
  FigResourceList,
} from "@bgub/fig";

export interface ServerRenderOptions {
  /**
   * Prefix for generated streaming Suspense and useId identifiers.
   * Defaults to an empty string.
   */
  identifierPrefix?: string;
  nonce?: string;
  onError?: (
    error: unknown,
    info: ServerErrorInfo,
  ) => ServerErrorPayload | undefined;
  onResourceError?: (error: unknown, info: ServerResourceErrorInfo) => void;
  onShellError?: (error: unknown) => void;
  resolveResourceKey?: (type: ElementType) => string | undefined;
  resources?: Record<string, FigResourceList>;
  signal?: AbortSignal;
}

export interface ServerErrorInfo {
  componentStack: string;
}

export interface ServerErrorPayload {
  digest?: string;
  message?: string;
}

export interface ServerResourceErrorInfo {
  componentStack: string;
  destination: ServerResourceDestination;
  key: string;
  resource: FigResource;
}

export type ServerResourceDestination = "head" | "stream";

interface ServerStreamRenderResult {
  abort(reason?: unknown): void;
  allReady: Promise<void>;
  contentType: "text/html; charset=utf-8";
  shellReady: Promise<void>;
  stream: ReadableStream<Uint8Array>;
}

export interface ServerDocumentRenderResult extends ServerStreamRenderResult {}

export interface ServerFragmentRenderResult extends ServerStreamRenderResult {
  getHead(): string;
  headReady: Promise<void>;
}

export interface ServerRenderRequest {
  abort(reason?: unknown): void;
  allReady: Promise<void>;
  getHead(): string;
  headReady: Promise<void>;
  shellReady: Promise<void>;
  stream: ReadableStream<Uint8Array>;
}

export type ServerRenderResult = ServerFragmentRenderResult;

export type ServerRenderable = FigNode;
