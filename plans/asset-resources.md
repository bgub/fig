# Asset Resources Proposal

## Summary

Asset resources are render-discovered assets such as stylesheets, scripts,
module preloads, fonts, preconnects, and metadata. They are discovered while
rendering, deduped by stable keys, loaded or inserted into the document, and
sometimes gated before dependent content is revealed.

This proposal intentionally separates asset resources from data resources.
Asset resources are not refreshed or invalidated like cache entries. They are
discovered, deduped, loaded, retained, and associated with rendered output.

Fig already has a strong asset-resource foundation in streaming SSR. The main
missing area is RSC/Flight: client component references currently identify only
the client module, not the CSS/script/preload assets required by that module.
Fig should extend client references and the RSC protocol so only rendered client
components contribute their asset resources.

## Goals

- Keep asset-resource terminology distinct from data-resource terminology.
- Preserve and extend Fig's existing SSR asset-resource registry.
- Send asset resources for only the components and segments that actually
  render.
- Deduplicate asset resources across the document, stream, RSC payloads, and
  refresh payloads.
- Gate dependent content on critical stylesheets when needed.
- Let bundlers attach CSS/script/preload metadata to client references.
- Support incremental asset discovery for later RSC chunks and refreshes.
- Avoid route-global client-component CSS when more precise delivery is
  possible.

## Non-Goals

- Define data fetching, cache invalidation, or data-resource refresh semantics.
- Build a bundler inside Fig core.
- Guarantee automatic unloading of stylesheets or scripts when components
  unmount.
- Replace application-level CSS architecture.
- Require every host renderer to support browser document assets.

## Existing Fig Model

Fig already exposes asset-resource helpers:

```ts
stylesheet("/app.css")
preload("/route.js", { as: "script" })
script("/client.js", { type: "module" })
font("/font.woff2", { type: "font/woff2" })
preconnect("https://example.com")
title("Page title")
meta({ name: "description", content: "..." })
resources([...], children)
```

In document-mode server rendering, Fig also lowers host `<title>`, `<meta>`,
`<link>`, and `<script>` elements into the same asset-resource system.

The SSR renderer already supports:

- asset-resource keying and dedupe
- head metadata insertion
- stream-safe asset hoisting
- segment-level asset-resource collection
- manifest-discovered component asset resources
- stylesheet gating for Suspense reveals
- nonce-compatible inline scripts

This means the SSR path has the right conceptual model: asset resources follow
the rendered tree and can be emitted near dependent segments.

## Current Gap In RSC

RSC client references currently serialize only module identity. Conceptually,
the payload says:

```ts
{
  id: "./Counter.tsx";
}
```

It does not say:

```ts
{
  id: "./Counter.tsx",
  resources: [
    stylesheet("/assets/Counter.css"),
    preload("/assets/Counter.js", { as: "script" })
  ]
}
```

That prevents Fig from solving a known problem in route-based RSC frameworks:
the server knows which client components actually rendered, but the asset layer
may still send route-global CSS for all possible client components up front.

Fig should not repeat that limitation. Client component serialization should be
able to carry asset-resource metadata for exactly the client references that
appear in the rendered RSC output.

## Proposed Public API

Client references should be able to declare asset resources.

```ts
import { clientReference, stylesheet, preload } from "@bgub/fig";

export const Counter = clientReference({
  id: "./Counter.tsx",
  load: () => import("./Counter.tsx"),
  resources: [
    stylesheet("/assets/Counter.css"),
    preload("/assets/Counter.js", { as: "script" }),
  ],
});
```

For bundler-driven use cases, the asset-resource list should usually be
generated from a manifest rather than hand-written:

```ts
export const Counter = clientReference({
  id: "./Counter.tsx",
  load: () => import("./Counter.tsx"),
  resources: manifest.resourcesFor("./Counter.tsx"),
});
```

The `resources` value could be either eager or lazy:

```ts
resources?: FigResourceList | (() => FigResourceList)
```

Lazy asset-resource resolution is useful when a bundler manifest is loaded
separately or when server and client builds need different path mapping.

## RSC Protocol Shape

The simplest protocol extension is to include asset resources on client
reference rows:

```ts
type ClientReferenceRow = {
  tag: "client";
  id: number;
  value: {
    id: string;
    resources?: SerializedAssetResource[];
  };
};
```

An alternative is a separate asset-resource row:

```ts
{ tag: "assetResources", owner: clientReferenceRowId, value: [...] }
```

Embedding asset resources directly on the client reference row is simpler and
keeps the dependency local. Separate rows may be better if asset resources are
shared by many client references or need to arrive before the model row.

Recommended first version: embed asset resources on client reference rows. Add
separate rows only if streaming order or payload size requires it.

## Serialization

Asset resources need a stable, explicit wire format. It should be derived from
Fig's existing `FigResource` model, but the RSC wire format should not expose
implementation details such as functions or host-specific objects.

Example:

```ts
type SerializedAssetResource =
  | { kind: "stylesheet"; href: string; precedence?: string; media?: string }
  | {
      kind: "preload";
      href: string;
      as: string;
      type?: string;
      crossOrigin?: string;
    }
  | { kind: "script"; src: string; type?: string; async?: boolean }
  | { kind: "font"; href: string; type?: string; crossOrigin?: string }
  | { kind: "preconnect"; href: string; crossOrigin?: string };
```

Metadata resources such as `title` and `meta` are more subtle for RSC. They are
document state, not client component assets. The first RSC asset-resource pass
should focus on stream-safe assets: stylesheets, preloads, scripts, fonts, and
preconnects.

## Deduping

All asset-resource insertion should use stable keys. Fig already has
asset-resource keying for SSR; RSC should reuse the same semantics where
possible.

Deduping should happen at multiple levels:

- per RSC payload
- per refresh payload
- per client document lifetime
- across SSR initial asset resources and later RSC asset resources

Once a stylesheet or script has been loaded, later references should not insert
duplicates. A later preload for an already loaded asset may be skipped. A later
asset resource with the same key but conflicting attributes should produce a
development diagnostic.

## Loading And Reveal Gating

Critical stylesheets should gate reveal of dependent content.

For SSR, Fig already has stylesheet reveal gating. RSC should apply the same
idea when a client reference introduces a stylesheet:

1. Discover asset resources while decoding the RSC payload.
2. Insert or preload deduped assets.
3. Wait for critical stylesheet load/error before revealing dependent client
   content or committing a refreshed boundary.
4. Do not block on non-critical preloads, preconnects, or async scripts unless
   explicitly marked critical.

This avoids a client component appearing before its CSS is available.

Open question: should all client-reference stylesheets be critical by default?
The likely answer is yes for first implementation. Later, precedence or
`blocking` metadata can refine this.

## Visibility And Retention

Asset resources should be associated with rendered output for diagnostics and
gating, but most browser asset resources should be retained after insertion.

Retaining by default is pragmatic:

- removing stylesheets can cause expensive style recalculation and flicker
- scripts cannot be meaningfully unloaded
- preloads and preconnects are inherently one-way hints
- route and tab back/forward behavior benefits from retained CSS

However, Fig should still track ownership:

- which root or RSC payload introduced the asset
- which segment or client reference depended on it
- whether the dependent content has been revealed
- whether an asset resource was inserted by SSR, hydration, RSC decode, or
  refresh

Ownership is useful for DevTools, diagnostics, and potential future memory
policy. It does not need to imply automatic removal.

## Interaction With Activity

Hidden Activity trees can pre-render work. Asset resources discovered while
pre-rendering hidden content should be allowed to load in the background when
that improves reveal latency.

This matches the direction of hidden UI: prepare work without forcing visible
updates. For asset resources:

- preload and preconnect hints are safe to emit for hidden work
- stylesheets may be loaded early, but hidden content should not become visible
  until normal reveal
- scripts for client components should follow the bundler/runtime policy

Activity should not change asset-resource identity. It only changes when
dependent UI is revealed.

## Interaction With Data Resources

Asset resources and data resources may appear in the same RSC refresh payload,
but they have different lifecycles.

When an action invalidates a data resource and triggers RSC refresh:

1. Data resources decide what server output needs to be recomputed.
2. The refreshed RSC render may discover new client references.
3. Those client references may introduce new asset resources.
4. The client loads/dedupes/gates asset resources before revealing refreshed
   content.

The data-resource invalidation caused the refresh. The asset-resource discovery
made the refreshed UI safe to display.

## Bundler Integration

Manual `resources` arrays are useful for tests and demos, but real apps need
bundler support.

A bundler manifest should map module ids to assets:

```json
{
  "./Counter.tsx": {
    "module": "/assets/Counter.abcd.js",
    "css": ["/assets/Counter.1234.css"],
    "imports": ["/assets/vendor.9999.js"]
  }
}
```

Fig server integration can resolve this into asset resources:

```ts
clientReference({
  id: "./Counter.tsx",
  load: () => import("./Counter.tsx"),
  resources: () => resourcesForClientReference("./Counter.tsx"),
});
```

The bundler/framework layer owns:

- module id mapping
- hashed asset URLs
- chunk graph traversal
- CSS extraction metadata
- development-server asset paths
- production manifest loading

Fig core owns:

- asset-resource representation
- serialization
- dedupe
- insertion
- reveal gating
- diagnostics

## Development Diagnostics

Fig should provide development diagnostics for:

- duplicate asset resource keys with conflicting attributes
- client reference rows missing required script/preload metadata when a manifest
  resolver is configured
- stylesheet load failures that block reveal
- asset resources discovered too late to gate already revealed content
- asset-resource values that are not serializable in RSC

Diagnostics should be dev-only and stripped by bundlers through the existing
inline `process.env.NODE_ENV !== "production"` convention.

## DevTools

Fig DevTools should eventually show asset resources separately from data
resources:

- asset-resource kind
- URL/key
- status: discovered, inserted, loading, loaded, failed, skipped duplicate
- owner: root, segment, client reference, Suspense boundary, Activity boundary
- source: SSR, hydration, RSC payload, refresh payload
- gating status for stylesheets

This will make client-component CSS issues inspectable without conflating them
with data cache behavior.

## Implementation Phases

### Phase 1: Client Reference Metadata — implemented

- `ClientReferenceOptions.resources?: ClientReferenceResources` where
  `ClientReferenceResources = FigResourceList | (() => FigResourceList)`. The
  value is retained verbatim on the `FigClientReference`.
- `clientReferenceResources(reference)` resolves it to a flat
  `readonly FigResource[]` — calling the lazy thunk on each read (not memoized,
  so a manifest loaded after definition is still picked up) and normalizing a
  single resource to a one-element list. Exported publicly and via
  `@bgub/fig/internal` for the server to consume in Phase 2.
- The existing SSR asset-resource APIs are unchanged.
- Tests cover eager list, single-resource normalization, lazy resolution
  (deferred + re-resolved per call), and the empty default.

### Phase 2: RSC Serialization

- Serialize client-reference asset resources in RSC client rows.
- Decode asset resources in `createRscResponse`.
- Dedupe asset resources within one payload.
- Add RSC tests proving unrendered client references do not emit resources.

### Phase 3: Client Insertion And Gating

- Add client-side asset-resource insertion and document-level dedupe.
- Gate dependent content on stylesheet load.
- Reuse or mirror SSR asset-resource key semantics.
- Add tests for duplicate resources and stylesheet failures.

### Phase 4: Refresh Integration

- Carry newly discovered asset resources in RSC refresh payloads.
- Gate refreshed boundaries before commit/reveal.
- Dedupe against SSR initial asset resources and earlier RSC payloads.

### Phase 5: Bundler Manifest Integration

- Add a manifest resolver hook for client reference asset resources.
- Update demos to avoid route-global CSS where possible.
- Document Vite or demo-server integration.

## Open Questions

- Should RSC client rows embed asset resources directly, or should they use
  separate rows?
- Should all client-reference stylesheets block reveal by default?
- How should stylesheet precedence interact with segment-level streaming order?
- Should `title` and `meta` ever travel through the RSC asset-resource path, or
  should document metadata remain SSR/framework-owned?
- How should the client reconcile asset resources already present in
  server-rendered HTML with asset resources discovered during RSC hydration?
- What is the minimal bundler manifest shape Fig should require?
