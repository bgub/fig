# Asset Resources

Status: stable

Render-discovered delivery assets: CSS, scripts, module preloads, fonts, preconnects, titles, and meta — discovered, deduped, loaded, retained, and sometimes gated before reveal. (Keyed async _values_ are data resources — see data.md.)

## Creators, Not Hoistable Magic

Assets are plain data made with explicit creators — `stylesheet`, `preload`, `modulepreload`, `script`, `font`, `preconnect`, `title`, `meta` — attached to a subtree with `assets([...], children)` or carried by client references (`clientReference({ assets })`, plus the render-level `clientReferenceAssets` resolver for bundler manifests). Host `<link>`/`<script>`/`<title>`/`<meta>` tags are _lowered_ into the same registry (`assetResourceFromHostProps`), so raw-tag authoring still participates in dedupe — this replaces React 19's implicit hoistable-element behavior with data plus one documented mechanism.

## Keys And Dedupe

Every asset has a deterministic dedupe key (`assetResourceKey`), shared across the SSR registry, the payload wire, and client insertion — a stylesheet discovered three ways renders once. Fonts and equivalent `preload-as-font` entries share a key space. `title` collapses to a single head slot (last writer wins).

## Destinations

Each kind has a destination: **head** (title, meta — document state, sealed with the shell in streaming mode, sealed at flush in prerender so late-discovered head assets still land) or **stream** (stylesheets, scripts, preloads, fonts, preconnects — emitted near the segment that needs them). Streamed kinds are the only ones that travel on the payload wire, serialized descriptor-only from a per-kind field table (the single source of truth for the wire type). Head-only kinds cannot serialize into the payload.

## Loading And Reveal Gating

On the client, `insertAssetResources` inserts descriptors idempotently (by key) and returns load tracking. Suspense reveal gates on blocking assets: streamed boundary completions wait for their stylesheets to load before the reveal op runs (the inline runtime's `r()` helper), so content never flashes unstyled. Payload boundary refreshes follow the same rule: refreshed content keeps the last revealed tree visible until newly required stylesheets load. If a later payload depends on a stylesheet Fig already inserted and that sheet is still loading, it joins the existing gate. Non-blocking kinds (preloads, preconnects, scripts, and fonts) never gate, and a stylesheet may opt out with `blocking: "none"` when inserted directly. Payload asset descriptors omit this authoring hint, so payload-delivered stylesheets conservatively gate.

## Diagnostics

`onAssetError` reports a head-destined asset discovered after the head was sealed in streaming mode; no handler means no automatic warning. Prerender mode avoids the class entirely by sealing late. The HTML server registry throws `AssetResourceConflictError` for conflicting same-key definitions, except `title`, whose singleton slot uses the latest value. Payload and DOM insertion instead treat the first live definition for a key as authoritative and dedupe later definitions without signature comparison.
