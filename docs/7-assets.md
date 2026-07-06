# Asset resources

The last of doc 1's headlines without its own doc. Asset resources are render-discovered delivery assets — CSS, scripts, module preloads, fonts, preconnects, titles, meta — discovered during render, deduped, loaded, and sometimes gated before reveal. (Keyed async *values* are data resources, doc 5. The two share the "resource" word and nothing else.)

## Creators, not hoistable magic

Assets are plain data made with explicit creators and attached to the subtree that needs them:

```tsx
import { assets, stylesheet, preconnect } from "@bgub/fig";

function Chart({ points }: { points: Point[] }) {
  return assets(
    [
      stylesheet("/chart.css", { precedence: "components" }),
      preconnect("https://tiles.example.com"),
    ],
    <section class="chart">{/* ... */}</section>,
  );
}
```

The full creator set: `stylesheet`, `preload`, `modulepreload`, `script`, `font`, `preconnect`, `title`, `meta`. Each returns plain data — `stylesheet("/chart.css")` is just `{ kind: "stylesheet", href: "/chart.css" }`. Nothing registers or hoists at creation time; discovery happens when a render actually reaches the `assets(...)` element, which is what "render-discovered" means: an asset ships only if the UI that needs it ships.

Client references carry assets too: `clientReference({ assets })` declares what a client component needs, and the render-level `clientReferenceAssets` resolver exists for bundler manifests (the manifest integration itself is still planned — see `concepts/assets.md` for status).

Raw tags still work. Host `<link>`, `<script>`, `<title>`, and `<meta>` elements are lowered into the same registry (`assetResourceFromHostProps`), so raw-tag authoring participates in dedupe like everything else. This is what replaces React 19's implicit hoistable behavior: data plus one documented mechanism, as doc 1 promised.

## Keys and dedupe

Every asset has a deterministic dedupe key (`assetResourceKey`), shared across the SSR registry, the payload wire, and client insertion. A stylesheet discovered three ways — an `assets(...)` wrapper, a client reference, a raw `<link>` — renders once. Fonts and equivalent `preload`-as-font entries share a key space, so those dedupe against each other too. `title` collapses to a single head slot, last writer wins.

Same-key entries with different definitions throw (`AssetResourceConflictError`): a shared key is a claim that two descriptors are the same asset, so disagreement is an error, not a merge.

## Destinations

Each kind has a destination:

| Destination | Kinds                                                          | Where it lands                              |
| ----------- | -------------------------------------------------------------- | ------------------------------------------- |
| head        | `title`, `meta`                                                | document state, sealed with the shell        |
| stream      | `stylesheet`, `script`, `preload`, `modulepreload`, `font`, `preconnect` | emitted near the segment that needs them |

The sealing rules differ by mode. In streaming SSR the head is sealed when the shell flushes, so a head-destined asset discovered inside suspended content arrives too late (dev warns; see diagnostics). `prerender` holds every flush until all tasks settle (doc 4), so it seals the head at flush and late-discovered head assets still land.

Only streamed kinds travel on the payload wire — doc 6's `assets` rows — serialized descriptor-only from a per-kind field table, which is the single source of truth for the wire type. Head-only kinds can't serialize into the payload.

## Loading and reveal gating

On the client, `insertAssetResources` (from `@bgub/fig-dom`) inserts descriptors idempotently by key and returns load tracking.

The reveal gate is the part you've already seen from the other side: doc 4's inline runtime has an `r` op that delays a boundary completion until its stylesheets load. That's this system. A streamed boundary's content waits for its blocking stylesheets before the swap runs, so streamed content never flashes unstyled. Non-blocking kinds (preloads, preconnects) never gate, and a stylesheet can opt out with `blocking: "none"`.

## Diagnostics

- Dev warns when a head-destined asset is discovered after the head was sealed in streaming mode; `onAssetError` reports late assets and conflicts. Prerender avoids the class entirely by sealing late.
- Conflicting same-key definitions throw `AssetResourceConflictError`, in keeping with the doc 1 stance: diagnostics fail loudly in dev rather than warning after the fact.

---

The full contract lives in `concepts/assets.md`. That's the end of the numbered series for now — `concepts/` (starting at `concepts/README.md`) is the spec for everything the guides didn't cover.
