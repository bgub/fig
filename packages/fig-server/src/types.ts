import type {
  ElementType,
  FigClientReference,
  FigNode,
  FigAssetResource,
  FigAssetResourceList,
  FigDataHydrationEntry,
  Props,
} from "@bgub/fig";
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
  clientReferenceFallback?: (
    reference: FigClientReference,
    props: Props,
  ) => FigNode;
  resolveAssetKey?: (type: ElementType) => string | undefined;
  dataPartition?: DataResourceKeyInput;
  assets?: Record<string, FigAssetResourceList>;
  signal?: AbortSignal;
}

export interface ServerPrerenderOptions extends ServerRenderOptions {
  /**
   * Render a full document. The root must render an <html> element with a
   * <head>, and collected head assets are inlined into that document head.
   */
  document?: boolean;
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

// Document mode is the fragment result minus the head accessors: the
// document renderer injects the sealed head into the stream itself.
export type ServerDocumentRenderResult = ServerStreamRenderResult;

export interface ServerFragmentRenderResult extends ServerStreamRenderResult {
  getHead(): string;
  headReady: Promise<string>;
}

export interface ServerPrerenderResult {
  data: FigDataHydrationEntry[];
  /**
   * Fragment-mode collected head HTML. Empty in document mode because the head
   * assets are already inlined into `html`.
   */
  head: string;
  html: string;
}
