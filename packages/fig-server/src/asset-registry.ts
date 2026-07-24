import { type FigAssetResource, type Props } from "@bgub/fig";
import {
  assetResourceHostAttributes,
  assetResourceKey,
  HYDRATION_SKIP_ATTRIBUTE,
} from "@bgub/fig/internal";
import { writeElementEnd, writeElementStart, writeText } from "./html.ts";
import {
  createPreloadHeaderEntries,
  type PreloadHeaderEntry,
} from "./preload-header.ts";
import { STREAMED_METADATA_ATTRIBUTE } from "./shared.ts";

export type MetadataSnapshotEntry =
  | readonly [key: string, kind: "title", value: string]
  | readonly [
      key: string,
      kind: "meta",
      attributes: ReadonlyArray<readonly [name: string, value: string]>,
    ];

type MetadataResource = Extract<FigAssetResource, { kind: "meta" | "title" }>;
type DeliveryResource = Exclude<FigAssetResource, MetadataResource>;

export interface HeadMetadataHtml {
  preamble: string;
  metadata: string;
}

export class AssetResourceRegistry {
  private readonly emittedResources = new Set<string>();
  private readonly deliveryResources = new Map<string, DeliveryResource>();
  private readonly metadataByOwner = new Map<
    object,
    readonly MetadataResource[]
  >();
  private readonly stylesheetIds = new Map<string, string>();
  private nextStylesheetId = 0;

  constructor(private readonly identifierPrefix: string) {}

  register(resource: FigAssetResource): void {
    if (isMetadataResource(resource)) return;
    this.canonical(resource);
  }

  activateMetadata(
    owner: object,
    resources: readonly FigAssetResource[],
  ): void {
    const metadata = resources.filter(isMetadataResource);
    if (metadata.length === 0) {
      this.metadataByOwner.delete(owner);
      return;
    }
    // Map.set preserves an existing key's position, so updating an owner does
    // not steal precedence from owners activated later.
    this.metadataByOwner.set(owner, metadata);
  }

  releaseMetadata(owner: object): void {
    this.metadataByOwner.delete(owner);
  }

  write(resource: FigAssetResource, sink: AssetSink): string | null {
    if (isMetadataResource(resource)) return null;

    const { key, resource: current } = this.canonical(resource);
    const id = this.revealBlockerId(key, current);

    if (this.emittedResources.has(key)) return id;

    this.emittedResources.add(key);
    writeAssetTag(sink, current, id);
    return id;
  }

  headHtml(nonce?: string, streamMetadata = false): string {
    const { preamble, metadata } = this.headMetadataHtml(nonce, streamMetadata);
    return preamble + metadata;
  }

  headMetadataHtml(nonce?: string, streamMetadata = false): HeadMetadataHtml {
    const buckets: Record<MetadataPhase, string[]> = {
      charset: [],
      parser: [],
      viewport: [],
      metadata: [],
    };

    for (const resource of this.visibleMetadata().values()) {
      const bucket = buckets[metadataPhase(resource)];
      writeAssetTag(
        { nonce, streamMetadata, write: (chunk) => bucket.push(chunk) },
        resource,
        null,
      );
    }

    return {
      preamble: [
        ...buckets.charset,
        ...buckets.parser,
        ...buckets.viewport,
      ].join(""),
      metadata: buckets.metadata.join(""),
    };
  }

  metadataSnapshot(): MetadataSnapshotEntry[] {
    const snapshot: MetadataSnapshotEntry[] = [];
    for (const [key, resource] of this.visibleMetadata()) {
      if (resource.kind === "title") {
        snapshot.push([key, resource.kind, resource.value]);
      } else {
        snapshot.push([key, resource.kind, metadataAttributes(resource)]);
      }
    }
    return snapshot;
  }

  preloadHeaderEntries(): PreloadHeaderEntry[] {
    return createPreloadHeaderEntries(this.deliveryResources.values());
  }

  private visibleMetadata(): Map<string, MetadataResource> {
    const visible = new Map<string, MetadataResource>();
    for (const metadata of this.metadataByOwner.values()) {
      for (const resource of metadata) {
        visible.set(assetResourceKey(resource), resource);
      }
    }
    return visible;
  }

  private canonical(resource: DeliveryResource): {
    key: string;
    resource: DeliveryResource;
  } {
    const key = assetResourceKey(resource);
    const current = this.deliveryResources.get(key);

    if (current !== undefined) {
      if (assetSignature(current) !== assetSignature(resource)) {
        throw new AssetResourceConflictError(key, current, resource);
      }

      return { key, resource: current };
    }

    this.deliveryResources.set(key, resource);
    return { key, resource };
  }

  private revealBlockerId(
    key: string,
    resource: FigAssetResource,
  ): string | null {
    if (resource.kind !== "stylesheet") return null;
    if (resource.blocking === "none") return null;

    return this.stylesheetIdFor(key);
  }

  private stylesheetIdFor(key: string): string {
    const current = this.stylesheetIds.get(key);
    if (current !== undefined) return current;

    const id =
      this.identifierPrefix === ""
        ? `r-${this.nextStylesheetId}`
        : `${this.identifierPrefix}-r-${this.nextStylesheetId}`;
    this.nextStylesheetId += 1;
    this.stylesheetIds.set(key, id);
    return id;
  }
}

export class AssetResourceConflictError extends Error {
  constructor(
    key: string,
    current: FigAssetResource,
    incoming: FigAssetResource,
  ) {
    super(
      `Conflicting Fig resource for key "${key}". Existing: ${JSON.stringify(
        current,
      )}. Incoming: ${JSON.stringify(incoming)}.`,
    );
  }
}

interface AssetSink {
  nonce?: string;
  streamMetadata?: boolean;
  write(chunk: string): void;
}

function writeAssetTag(
  sink: AssetSink,
  resource: FigAssetResource,
  id: string | null,
): void {
  switch (resource.kind) {
    case "title":
      writeElementStart(
        "title",
        {
          [HYDRATION_SKIP_ATTRIBUTE]: true,
          [STREAMED_METADATA_ATTRIBUTE]: sink.streamMetadata
            ? assetResourceKey(resource)
            : undefined,
        },
        sink,
      );
      writeText(resource.value, sink);
      writeElementEnd("title", sink);
      return;
    case "meta":
      writeElementStart(
        "meta",
        {
          charset: resource.charset,
          name: resource.name,
          property: resource.property,
          "http-equiv": resource["http-equiv"],
          content: resource.content,
          [HYDRATION_SKIP_ATTRIBUTE]: true,
          [STREAMED_METADATA_ATTRIBUTE]: sink.streamMetadata
            ? assetResourceKey(resource)
            : undefined,
          "data-fig-resource-key": resource.key,
        },
        sink,
      );
      return;
    default: {
      // The attribute set is shared with the client's head insertion; only
      // the server-side reveal-blocker id and nonce are appended here.
      const props: Props = {
        [HYDRATION_SKIP_ATTRIBUTE]: true,
        ...Object.fromEntries(assetResourceHostAttributes(resource)),
      };
      if (resource.kind === "stylesheet" && id !== null) props.id = id;

      const tag = resource.kind === "script" ? "script" : "link";
      writeElementStart(tag, withNonce(sink, props), sink);
      if (tag === "script") writeElementEnd("script", sink);
    }
  }
}

function isMetadataResource(
  resource: FigAssetResource,
): resource is MetadataResource {
  return resource.kind === "title" || resource.kind === "meta";
}

type MetadataPhase = "charset" | "parser" | "viewport" | "metadata";

function metadataPhase(resource: MetadataResource): MetadataPhase {
  if (resource.kind === "title") return "metadata";
  if (resource.charset !== undefined) return "charset";
  if (
    normalizedMetadataName(resource["http-equiv"]) === "content-security-policy"
  ) {
    return "parser";
  }
  if (normalizedMetadataName(resource.name) === "viewport") return "viewport";
  return "metadata";
}

function normalizedMetadataName(value: string | undefined): string | undefined {
  return value?.trim().toLowerCase();
}

function metadataAttributes(
  resource: Extract<FigAssetResource, { kind: "meta" }>,
): Array<readonly [string, string]> {
  const attributes: Array<readonly [string, string | undefined]> = [
    ["charset", resource.charset],
    ["name", resource.name],
    ["property", resource.property],
    ["http-equiv", resource["http-equiv"]],
    ["content", resource.content],
    ["data-fig-resource-key", resource.key],
  ];
  return attributes.filter(
    (entry): entry is readonly [string, string] => entry[1] !== undefined,
  );
}

function withNonce(sink: AssetSink, props: Props): Props {
  return sink.nonce === undefined ? props : { ...props, nonce: sink.nonce };
}

function assetSignature(resource: FigAssetResource): string {
  switch (resource.kind) {
    case "stylesheet":
      return signature(
        resource.kind,
        resource.href,
        resource.media ?? "",
        resource.precedence ?? "",
        resource.crossorigin ?? "",
        resource.blocking ?? "reveal",
      );
    case "preload":
      return signature(
        resource.kind,
        resource.href,
        resource.as,
        resource.type ?? "",
        resource.crossorigin ?? "",
        resource.fetchpriority ?? "",
      );
    case "modulepreload":
      return signature(
        resource.kind,
        resource.href,
        resource.crossorigin ?? "",
        resource.fetchpriority ?? "",
      );
    case "font":
      // Mirror the preload-as-font signature: a font shares the preload-font key
      // space (see assetResourceKey), so an equivalent preload(href, "font") must
      // produce the same signature and dedupe rather than raising a conflict.
      return signature(
        "preload",
        resource.href,
        "font",
        resource.type,
        resource.crossorigin ?? "anonymous",
        resource.fetchpriority ?? "",
      );
    case "preconnect":
      return signature(
        resource.kind,
        resource.href,
        resource.crossorigin ?? "",
      );
    case "script":
      return signature(
        resource.kind,
        resource.src,
        resource.module === true,
        resource.async !== false,
        resource.defer === true,
        resource.crossorigin ?? "",
      );
    case "title":
      return signature(resource.kind, resource.value);
    case "meta":
      return signature(
        resource.kind,
        resource.charset ?? "",
        resource.name ?? "",
        resource.property ?? "",
        resource["http-equiv"] ?? "",
        resource.content ?? "",
      );
  }

  return unsupportedAssetResource(resource);
}

function unsupportedAssetResource(resource: FigAssetResource): never {
  throw new Error(`Unsupported asset resource kind: ${resource.kind}`);
}

function signature(...values: Array<string | boolean>): string {
  return JSON.stringify(values);
}
