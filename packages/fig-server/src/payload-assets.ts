import type {
  FigAssetResource,
  FigAssetResourceList,
  FigClientReference,
} from "@bgub/fig";
import {
  assetResourceDestination,
  assetResourceKey,
  clientReferenceAssets,
  isFigAssetResource,
  type SerializedAssetResource,
} from "@bgub/fig/internal";

type ResolveClientReferenceAssets = (metadata: {
  id: string;
}) => FigAssetResourceList;

/** Owns request-wide delivery-asset dedupe and wire lowering. */
export class PayloadAssets {
  private readonly emittedKeys = new Set<string>();

  constructor(
    private readonly resolveClientReference?: ResolveClientReferenceAssets,
  ) {}

  serialize(value: unknown): SerializedAssetResource[] {
    const input = isFigAssetResource(value)
      ? [value]
      : Array.isArray(value)
        ? value
        : [];
    const serialized: SerializedAssetResource[] = [];

    for (const resource of input) {
      if (!isFigAssetResource(resource)) continue;
      // Delivery assets are request-global and persistent, so the first
      // definition wins. Metadata remains owner-scoped and may repeat.
      if (assetResourceDestination(resource) === "stream") {
        const key = assetResourceKey(resource);
        if (this.emittedKeys.has(key)) continue;
        this.emittedKeys.add(key);
      }
      serialized.push(serializeAssetResource(resource));
    }

    return serialized;
  }

  serializeClientReference(
    reference: FigClientReference,
  ): SerializedAssetResource[] {
    const declared = clientReferenceAssets(reference);
    const resolved = this.resolveClientReference?.({ id: reference.id });
    if (resolved === undefined) return this.serialize(declared);
    if (isFigAssetResource(resolved)) {
      return this.serialize([...declared, resolved]);
    }
    return this.serialize(
      Array.isArray(resolved) ? [...declared, ...resolved] : declared,
    );
  }
}

function serializeAssetResource(
  resource: FigAssetResource,
): SerializedAssetResource {
  // Delivery assets intentionally omit author-supplied `key` and dedupe by
  // concrete URL. JSON omits the optional fields that remain undefined.
  switch (resource.kind) {
    case "stylesheet":
      return {
        href: resource.href,
        kind: resource.kind,
        crossorigin: resource.crossorigin,
        media: resource.media,
        precedence: resource.precedence,
      };
    case "preload":
      return {
        as: resource.as,
        kind: resource.kind,
        crossorigin: resource.crossorigin,
        fetchpriority: resource.fetchpriority,
        href: resource.href,
        imagesizes: resource.imagesizes,
        imagesrcset: resource.imagesrcset,
        referrerpolicy: resource.referrerpolicy,
        type: resource.type,
      };
    case "modulepreload":
      return {
        href: resource.href,
        kind: resource.kind,
        crossorigin: resource.crossorigin,
        fetchpriority: resource.fetchpriority,
      };
    case "script":
      return {
        kind: resource.kind,
        src: resource.src,
        async: resource.async,
        crossorigin: resource.crossorigin,
        defer: resource.defer,
        module: resource.module,
      };
    case "font":
      return {
        href: resource.href,
        kind: resource.kind,
        type: resource.type,
        crossorigin: resource.crossorigin,
        fetchpriority: resource.fetchpriority,
      };
    case "preconnect":
      return {
        href: resource.href,
        kind: resource.kind,
        crossorigin: resource.crossorigin,
      };
    case "title":
      return { kind: resource.kind, value: resource.value };
    case "meta":
      return {
        kind: resource.kind,
        charset: resource.charset,
        content: resource.content,
        "http-equiv": resource["http-equiv"],
        key: resource.key,
        name: resource.name,
        property: resource.property,
      };
  }
}
