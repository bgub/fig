import type {
  DataResourceKeyInput,
  ElementType,
  FigAssetResource,
  FigAssetResourceList,
  FigClientReference,
  FigDataHydrationEntry,
  FigDataStoreController,
  FigDataStoreHandle,
  FigNode,
  PreloadResource,
  Props,
} from "@bgub/fig";
import type { RenderTreeCollector } from "./render-tree.ts";

/** Describes server render options. */
export interface ServerRenderOptions {
  /**
   * Prefix for generated streaming Suspense and useId identifiers.
   * Defaults to an empty string.
   */
  identifierPrefix?: string;
  /**
   * Encoded bytes the result stream buffers before flushing pauses until the
   * consumer reads (rendering itself never pauses; completed work waits in
   * segment form). Defaults to 65536; values below 1 are clamped to 1.
   */
  highWaterMark?: number;
  nonce?: string;
  onError?: (
    error: unknown,
    info: ServerErrorInfo,
  ) => ServerErrorPayload | undefined;
  clientReferenceFallback?: (
    reference: FigClientReference,
    props: Props,
  ) => FigNode;
  resolveAssetKey?: (type: ElementType) => string | undefined;
  dataPartition?: DataResourceKeyInput;
  /** Adopt a store populated by request loaders before rendering. */
  dataStore?: FigDataStoreController;
  /**
   * Values loaded before rendering, such as route-loader data. They hydrate
   * the request store before the first component reads it.
   */
  initialData?: readonly FigDataHydrationEntry[];
  assets?: Record<string, FigAssetResourceList>;
  /**
   * Caller-owned collector the renderer fills with the component structure
   * as it renders (see createRenderTreeCollector) — readable mid-render, so
   * a subtree later in document order can prerender introspection UI from
   * everything rendered before it.
   */
  renderTree?: RenderTreeCollector;
  signal?: AbortSignal;
}

/** Describes server prerender options. */
export interface ServerPrerenderOptions extends ServerRenderOptions {
  /**
   * Render a full document. The root must render an <html> element with a
   * <head>, and collected head assets are inlined into that document head.
   */
  document?: boolean;
}

/** Describes server error info. */
export interface ServerErrorInfo {
  componentStack: string;
}

/** Describes server error payload. */
export interface ServerErrorPayload {
  digest?: string;
  message?: string;
}

interface ServerStreamRenderResult {
  abort(reason?: unknown): void;
  allReady: Promise<void>;
  contentType: "text/html; charset=utf-8";
  /** The request-scoped store used by this render. */
  data: FigDataStoreHandle;
  getData(): FigDataHydrationEntry[];
  /**
   * Returns the shell's deduplicated HTTP `Link` value for preload-capable
   * asset resources. Returns undefined before `shellReady`; assets discovered
   * later remain in the HTML stream and are not added retroactively.
   */
  getPreloadHeader(options?: ServerPreloadHeaderOptions): string | undefined;
  shellReady: Promise<void>;
  stream: ReadableStream<Uint8Array>;
}

/** Describes server preload header options. */
export interface ServerPreloadHeaderOptions {
  /** Include only resources that are safe for this response's cache policy. */
  filter?: (resource: ServerPreloadHeaderResource) => boolean;
  /** Maximum UTF-16 code units in the returned value. Defaults to 2,000. */
  maxLength?: number;
}

type HeaderPreloadResource = PreloadResource & {
  href: string;
};

/** Describes server preload header resource. */
export type ServerPreloadHeaderResource = Readonly<
  | Exclude<FigAssetResource, { kind: "meta" | "preload" | "script" | "title" }>
  | HeaderPreloadResource
>;

// Document mode is the fragment result minus the head accessors: the
// document renderer injects the sealed head into the stream itself.
/** Describes server document render result. */
export type ServerDocumentRenderResult = ServerStreamRenderResult;

/** Describes server fragment render result. */
export interface ServerFragmentRenderResult extends ServerStreamRenderResult {
  getHead(this: void): string;
  headReady: Promise<string>;
}

/** Describes server prerender result. */
export interface ServerPrerenderResult {
  data: FigDataHydrationEntry[];
  /**
   * Fragment-mode collected head HTML. Empty in document mode because the head
   * assets are already inlined into `html`.
   */
  head: string;
  html: string;
}
