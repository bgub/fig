# Asset Resources

Status: stable

Asset resources are CSS, scripts, module preloads, fonts, preconnects, titles, and metadata discovered while Fig renders. Fig deduplicates them, sends them to the right place, and sometimes waits for them before revealing UI.

They are different from [data resources](./data.md), which represent keyed async values.

## Declaring Assets

Assets are plain data created with `stylesheet`, `preload`, `modulepreload`, `script`, `font`, `preconnect`, `title`, or `meta`:

```tsx
return assets(
  [
    stylesheet("/chart.css", { precedence: "components" }),
    preconnect("https://tiles.example.com"),
  ],
  <Chart />,
);
```

`assets(list, children)` attaches the descriptors to a subtree. Client references may carry them too, and framework compilers may derive the same descriptors from static imports. TanStack Start does this for components reached by `payloadResource` and for explicit `Isomorphic` boundaries.

There is still only one runtime mechanism: every source becomes the same descriptor and enters the same registry.

Descriptor options use native HTML names such as `crossorigin`, `fetchpriority`, and `http-equiv`.

## Raw Host Tags

HTML `<link>`, `<title>`, and `<meta>` elements, plus explicitly async `<script>` elements, enter the same registry. This lets raw tags and descriptor APIs deduplicate against each other.

There are deliberate exceptions:

- SVG and MathML tags remain ordinary elements.
- `<title itemprop>` and `<meta itemprop>` remain in place.
- A non-async `<script>` stays where it was authored because its position affects execution.

Frameworks that already positioned a tag may apply the private `preventAssetResourceHoist` marker. The symbol-backed marker never reaches the DOM; it only tells Fig not to reinterpret or move that element.

Registry-owned server elements carry `data-fig-hydration-skip` because they have no client fiber. Explicitly positioned elements hydrate normally and do not receive the marker.

## Ownership

On the client, every `Assets` fiber owns its descriptor list. Commit calls the renderer's optional `commitAssetResources(previous, next, owner)` hook. The owner token stays stable across updates and moves and is unique to that live fiber. Deleted fibers pass `null` as the next list.

Raw hoisted tags use the same ownership model through acquire, update, and release callbacks. Work from a suspended, failed, or abandoned render never reaches commit and therefore never changes the live registry.

Delivery assets and metadata have different lifetimes:

- **Delivery assets**—stylesheets, scripts, hints, and fonts—are reference-counted, but remain after their last owner leaves. Removing the element cannot undo a fetch or script execution.
- **Metadata**—title and meta—uses live claims. Each key has one shared DOM element. The most recently acquired visible owner wins; when it leaves, Fig restores the latest remaining claim. The element disappears when no claims remain.

Updating a shadowed metadata claim changes its fallback value without moving it ahead of the current winner. Suspended and discarded work cannot publish metadata. A visible Suspense fallback owns its metadata until primary content reveals, at which point Fig swaps both the UI and metadata together.

`meta(options)` accepts exactly one identity shape: `{ charset }`, `{ name, content }`, `{ property, content }`, or `{ "http-equiv", content }`, with an optional explicit key. Contradictory shapes are type errors. Raw `<meta>` tags enter the registry only when they satisfy the same rule.

## Keys And Deduplication

Every descriptor has a deterministic key shared by server rendering, Payload, and the browser registry. If a stylesheet is discovered through a route, an `assets()` call, and a client reference, it still renders once.

Fonts share a key space with equivalent `preload(..., "font")` descriptors. `title` has one document slot. Metadata follows the claim rules above rather than ordinary delivery-asset conflict handling.

## Where Assets Go

Assets have two destinations:

- **Head:** title and meta, because they are committed document state.
- **Stream:** stylesheets, scripts, preloads, fonts, and preconnects, because they should arrive near the content that needs them.

Payload carries both groups as descriptors. Browser decoding prepares stream assets as soon as their row arrives, but keeps metadata attached to its owner until a renderer commit publishes it.

Streaming HTML seals an initial head snapshot with the shell. Metadata discovered in late primary content travels with that Suspense boundary's completion operation.

Full-document shell output keeps positioned head children such as `<base>` in source order, then writes collected assets in browser-critical phases: charset and CSP metadata, viewport metadata, preconnects, font and high-priority image preloads, stylesheets, ordinary metadata, and finally remaining hints and scripts. Order within each phase remains discovery order. Assets discovered after the shell continue to stream beside the content that declared them.

The reveal swaps fallback, content, and the complete visible metadata snapshot atomically. Partial segments never publish metadata. Prerender waits for all content, so its single static head is already final.

## Loading Before Reveal

Blocking stylesheets must load before dependent streamed content appears. The inline `r()` operation holds a Suspense reveal until those stylesheets settle, preventing a flash of unstyled content.

Payload refreshes use the same rule: the old tree and metadata stay visible until the replacement's blocking stylesheets load. If the stylesheet already exists but is still loading, the new reveal joins that existing gate.

Preloads, preconnects, scripts, and fonts never gate. A directly inserted stylesheet may opt out with `blocking: "none"`. Payload omits that authoring hint and therefore gates conservatively.

## Stylesheet Precedence

Each `precedence` string names a bucket. Buckets appear in the order their names are first discovered, and stylesheets keep discovery order within a bucket. A missing value uses the default bucket.

When a later render discovers a stylesheet for an existing bucket, Fig inserts it before the next bucket. Server-streamed segments preserve their own discovery order; the bundler is responsible for stronger ordering relationships between separately discovered chunks.

## Conflicts And Invalid Updates

The HTML server registry throws `AssetResourceConflictError` when two delivery assets use one key with incompatible definitions. Payload insertion and persistent browser delivery assets keep the first live definition and deduplicate later ones. Metadata uses claims instead.

Once a raw host fiber is classified as hoisted, it stays hoisted for its lifetime. If an update would make it ordinary, development throws and production ignores the invalid update. Use a different Fig key when changing the element's placement contract.
