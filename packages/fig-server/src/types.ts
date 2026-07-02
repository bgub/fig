import type {
  ElementType,
  FigClientReference,
  FigNode,
  FigAssetResource,
  FigAssetResourceList,
  Props,
} from "@bgub/fig";
import type { FigDataHydrationEntry } from "@bgub/fig/internal";
import type { DataResourceKeyInput } from "@bgub/fig-data";

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
  onAssetError?: (error: unknown, info: ServerAssetErrorInfo) => void;
  onShellError?: (error: unknown) => void;
  clientReferenceFallback?: (
    reference: FigClientReference,
    props: Props,
  ) => FigNode;
  resolveAssetKey?: (type: ElementType) => string | undefined;
  dataContext?: unknown;
  dataPartition?: DataResourceKeyInput;
  assets?: Record<string, FigAssetResourceList>;
  signal?: AbortSignal;
}

export interface ServerErrorInfo {
  componentStack: string;
}

export interface ServerErrorPayload {
  digest?: string;
  message?: string;
}

export interface ServerAssetErrorInfo {
  componentStack: string;
  destination: ServerAssetDestination;
  key: string;
  resource: FigAssetResource;
}

export type ServerAssetDestination = "head" | "stream";

interface ServerStreamRenderResult {
  abort(reason?: unknown): void;
  allReady: Promise<void>;
  contentType: "text/html; charset=utf-8";
  getData(): FigDataHydrationEntry[];
  shellReady: Promise<void>;
  stream: ReadableStream<Uint8Array>;
}

export interface ServerDocumentRenderResult extends ServerStreamRenderResult {}

export interface ServerFragmentRenderResult extends ServerStreamRenderResult {
  getHead(): string;
  headReady: Promise<string>;
}

export interface ServerRenderRequest {
  abort(reason?: unknown): void;
  allReady: Promise<void>;
  getData(): FigDataHydrationEntry[];
  getHead(): string;
  headReady: Promise<string>;
  shellReady: Promise<void>;
  stream: ReadableStream<Uint8Array>;
}

export type ServerRenderResult = ServerFragmentRenderResult;

export type ServerRenderable = FigNode;
