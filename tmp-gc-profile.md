# Fig vs React SSR GC Profile

Date: 2026-07-29

This investigation compares production SSR for identical versions of
`bengubler.com`: Fig from the website's `main` branch and React from
`bg/react-rewrite`. Both builds served the same non-prerendered 404 route at
50 concurrent connections, after warmup.

This file is temporary investigation material, not product documentation.

## Executive summary

Fig's GC disadvantage is caused by framework and adapter work, not by the
application, Nitro, or Fig's isolated core renderer.

Over 10,000 requests, Fig allocated approximately 10.834 GB versus React's
9.068 GB: 1.766 GB more, or approximately 176.6 KB more per request (+19.5%).
The GC cost grows disproportionately because almost twice as much young data
survives each minor collection. Fig therefore copies and promotes more live
objects, has longer minor pauses, and reaches major collections more often.

The principal sources are:

1. Server HTML serialization and output buffering.
2. The server `Link` and generic mixin-resolution path.
3. Asset-resource and preload-header conversion.

Payload-marker scanning is a meaningful CPU hotspot, but it produces almost
no sampled allocation and is not a cause of the GC gap.

## Baseline application benchmark

Before profiling, three alternating 10-second production samples gave:

| Metric             |            Fig |          React |       Difference |
| ------------------ | -------------: | -------------: | ---------------: |
| Average throughput | 1,884.94 req/s | 2,150.37 req/s |       Fig -12.3% |
| Average latency    |       26.00 ms |       22.75 ms |       Fig +14.3% |
| Median p50 latency |          25 ms |          22 ms |       Fig +13.6% |
| Median p99 latency |          40 ms |          35 ms |       Fig +14.3% |
| Raw response       |   20,871 bytes |   19,668 bytes | Fig +1,203 bytes |
| Gzip response      |    3,907 bytes |    3,631 bytes |   Fig +276 bytes |
| Module preloads    |             12 |             11 |           Fig +1 |

The response-size difference matters less under production compression, but
the extra rendering, allocation, and GC work remains.

## Fixed-work GC results

The generation-level run measured exactly 40,000 requests after warmup,
without CPU or allocation profiler overhead:

| Metric              |         Fig |     React | Difference |
| ------------------- | ----------: | --------: | ---------: |
| Total GC time       | 1,043.97 ms | 506.74 ms |  Fig 2.06x |
| Total GC events     |         781 |       613 | Fig +27.4% |
| Minor GC time       |   941.75 ms | 434.22 ms |  Fig 2.17x |
| Minor collections   |         733 |       585 | Fig +25.3% |
| Average minor pause |    1.285 ms |  0.742 ms | Fig +73.2% |
| Major GC time       |    97.24 ms |  69.39 ms | Fig +40.1% |
| Major collections   |          24 |        14 | Fig +71.4% |
| Incremental GC time |     4.98 ms |   3.12 ms | Fig +59.5% |

Minor collection is the dominant problem. Fig both invokes it more often and
does substantially more work in each collection.

## Why 19.5% more allocation causes roughly twice the GC time

V8 `--trace-gc-nvp` measurements from the steady portion of the request run
showed:

| Per minor collection                |      Fig |    React | Difference |
| ----------------------------------- | -------: | -------: | ---------: |
| Average pause                       |   1.2 ms |   0.8 ms |   Fig +50% |
| Average young-generation survival   |    16.1% |     8.4% |  Fig 1.92x |
| Average promoted bytes              |  4.65 MB |  2.60 MB |   Fig +79% |
| Average new-space survivors         |  4.82 MB |  2.72 MB |   Fig +77% |
| Bytes allocated between collections | 54.96 MB | 64.23 MB |   Fig -14% |

Fig does not have a slower scavenger. Its measured scavenge throughput was
slightly higher. The pauses are longer because V8 must copy and promote almost
twice as much live young data.

This is consistent with request-lifetime data being retained across nursery
collections: serialized segment chunks, link and mixin objects, asset plans,
asset registries, and preload representations remain live until later render
or flush phases.

## Allocation profile

V8 allocation sampling included objects collected by both minor and major GC.
Each build handled exactly 10,000 requests at concurrency 50 after warmup.

| Metric                 |              Fig |    React |
| ---------------------- | ---------------: | -------: |
| Sampled allocation     |        10.834 GB | 9.068 GB |
| Allocation per request |       1,083.4 KB | 906.8 KB |
| Fig excess             | 176.6 KB/request |        — |

Shared application and internationalization work was similar. Node and native
runtime allocations were also similar, and sometimes higher for React. The
approximately 1.77 GB difference is concentrated in Fig framework and adapter
code.

### Largest Fig allocation sites

These are self-attributed samples, so related rows can belong to the same
larger call path and must not simply be added together.

| Allocation site               | Sampled allocation | Per request |
| ----------------------------- | -----------------: | ----------: |
| `writeElementStart`           |         1,599.2 MB |    159.9 KB |
| `join`                        |           322.1 MB |     32.2 KB |
| `resolveHostMix`              |           319.5 MB |     32.0 KB |
| `renderHostElement`           |           256.4 MB |     25.6 KB |
| `Object.keys`                 |           240.1 MB |     24.0 KB |
| `serializeLink`               |           205.5 MB |     20.6 KB |
| TanStack `build`              |           188.2 MB |     18.8 KB |
| `resolveLinkState`            |           159.9 MB |     16.0 KB |
| `ServerLink`                  |           142.1 MB |     14.2 KB |
| `assetResourceHostAttributes` |           125.4 MB |     12.5 KB |
| `collectRouteAssets`          |           104.9 MB |     10.5 KB |
| Fig JSX `jsx`                 |            97.0 MB |      9.7 KB |

Inclusive call-path allocation was:

| Call path                    |        Fig | Comparable React path |
| ---------------------------- | ---------: | --------------------: |
| `writeElementStart`          | 1,863.6 MB |                     — |
| `flushWriteBuffer`           |   258.1 MB |                     — |
| `pushStartInstance`          |          — |              535.3 MB |
| `writeChunk`                 |          — |              802.8 MB |
| `ServerLink`                 | 1,164.2 MB |                     — |
| `useLinkProps`               |          — |              816.4 MB |
| `resolveHostMix`             |   461.6 MB |                     — |
| `resolveLinkState`           |   705.3 MB |                     — |
| `createPreloadHeaderEntries` |   277.9 MB |                     — |
| Fig `collectRouteAssets`     |   147.3 MB |                     — |
| React `buildTagsFromMatches` |          — |              151.5 MB |

The renderer rows are not perfect one-to-one equivalents because React and Fig
partition their renderer work differently. They do, however, identify where
Fig's extra request allocations are created.

## Server HTML and output buffering

Relevant code:

- `packages/fig-server/src/html.ts`
- `packages/fig-server/src/renderer.ts`
- `packages/fig-server/src/renderer-flush.ts`

`writeElementStart` currently:

1. Calls `serializeAttributes`, which accumulates an attribute string.
2. Constructs another complete start-tag string.
3. Stores the tag in a segment's chunk array.
4. Copies the segment's chunks into the request write-buffer array during
   flushing.
5. Joins the complete write buffer into another response string.
6. Encodes that string into a new `Uint8Array`.

Some JavaScript strings may remain ropes internally, so this is not
necessarily a full byte-for-byte copy at every step. It still creates several
request-lifetime representations and requires flattening/materialization by
the time the response is encoded.

This explains both the large gross allocation attributed to
`writeElementStart` and the survivor pressure: serialized chunks must remain
reachable until their segment is eligible to flush.

## Server Link and mixin path

Relevant code:

- `packages/fig-tanstack-router/src/link.tsx`
- `packages/fig/src/mixin.ts`
- `packages/fig/src/jsx-runtime.ts`

The server-specialized `Link` avoids client hooks, but still performs several
allocation-heavy operations:

1. `resolveLinkState` destructures the full link-prop object and creates a rest
   `anchorProps` object.
2. It resolves state props and creates another rest `stateAnchorProps` object.
3. It returns a new result object containing all resolved fields.
4. `ServerLink` creates a new anchor-props object through JSX spreads.
5. `combineServerLinkMixins` always appends the client-behavior marker.
6. The marker causes the JSX runtime to clone props and invoke generic
   `resolveHostMix`, even when there is no user-provided mixin.
7. Generic mixin resolution creates context objects, slot strings, arrays, and
   prop patches and defines an internal client-behavior marker.

The hydration marker is necessary, but using a generic event-mixin descriptor
to install it during SSR is expensive. The ordinary no-user-mixin path should
be able to install the same internal marker directly while reserving generic
mixin resolution for actual user and state mixins.

## Controlled navigation experiment

The same `NavigationLinks` subtree was temporarily removed from both website
builds. This removed identical application markup and behavior rather than
changing only Fig.

### Allocation

| 10k requests |    Normal | Without navigation |
| ------------ | --------: | -----------------: |
| Fig          | 10.834 GB |           7.459 GB |
| React        |  9.068 GB |           6.367 GB |
| Fig excess   |  1.766 GB |           1.092 GB |

Removing navigation eliminated 674 MB, or 38.2%, of Fig's allocation
disadvantage. This is approximately 67.4 KB of excess allocation per request.

### GC

| 40k requests    | Normal gap | Without-navigation gap | Removed |
| --------------- | ---------: | ---------------------: | ------: |
| Total GC time   |  537.23 ms |              309.55 ms |   42.4% |
| Total GC events |        168 |                     58 |   65.5% |

Detailed no-navigation results:

| Metric            |       Fig |     React |
| ----------------- | --------: | --------: |
| Total GC time     | 736.10 ms | 426.55 ms |
| Total GC events   |       498 |       440 |
| Minor GC time     | 666.41 ms | 364.39 ms |
| Minor collections |       460 |       408 |

This experiment confirms that the link/mixin/host-render subtree materially
causes the GC gap. It is not merely prominent because of profiler attribution.
The subtree also contains ordinary host nodes and application work, but those
were removed from both frameworks; the differential improvement belongs to
the framework paths used to render it.

## Asset and preload conversion

Relevant code:

- `packages/fig-tanstack-router/src/route-assets.ts`
- `packages/fig/src/resource.ts`
- `packages/fig-server/src/asset-registry.ts`
- `packages/fig-server/src/preload-header.ts`

The current route-asset path can create several representations of one asset:

1. A TanStack router-managed tag.
2. A Fig asset-resource object.
3. Registry keys and signatures.
4. An attribute-pair array from `assetResourceHostAttributes`.
5. A props object produced with `Object.fromEntries`.
6. HTML attribute strings.
7. A separately serialized preload-header value.

The route-asset cache prevents repeated planning passes for one match, but the
plan and its representations still live for most of the request. The cache
therefore avoids recomputation without eliminating this survivor set.

A server-specific writer should serialize the canonical asset resource
directly. Shared ordering and normalization can remain centralized without
requiring an intermediate pair array and props object on the server.

Reducing unnecessary preloads would additionally improve response size, CPU,
allocation, and retained request state.

## CPU profile

The CPU profile handled exactly 20,000 requests at concurrency 50 after
warmup. Selected self/inclusive times were:

| Fig path                        |     Self | Inclusive |
| ------------------------------- | -------: | --------: |
| Garbage collector               | 708.3 ms |         — |
| `writeElementStart`             | 152.5 ms |  731.6 ms |
| `serializeAttributes`           |  97.0 ms |  521.1 ms |
| `ServerLink`                    | 251.3 ms |  907.4 ms |
| `resolveLinkState`              |  96.0 ms |  443.0 ms |
| `resolveHostMix`                | 122.7 ms |  258.1 ms |
| `writeAssetTag`                 | 120.5 ms |  283.8 ms |
| `flushWriteBuffer`              | 135.6 ms |  302.9 ms |
| `indexOfPayloadTransportMarker` | 543.5 ms |  543.5 ms |

Comparable React rows included:

| React path          |     Self |  Inclusive |
| ------------------- | -------: | ---------: |
| Garbage collector   | 342.6 ms |          — |
| `pushStartInstance` |  70.4 ms |   360.8 ms |
| `pushAttribute`     |  88.6 ms |   218.6 ms |
| `useLinkProps`      | 214.1 ms |   653.5 ms |
| `writeChunk`        | 642.9 ms | 1,139.1 ms |

Profiler overhead changes absolute throughput and GC timings, so the
non-profiled fixed-work run is authoritative for GC totals. The CPU profile is
used to locate work, not to report production throughput.

## Payload marker scanning

Relevant code:

- `packages/fig-tanstack-start/src/payload-internal.ts`

`indexOfPayloadTransportMarker` scans streamed response bytes for the payload
insertion marker. It was one of Fig's largest self-time CPU frames at 543.5 ms
over 20,000 requests, approximately 27 microseconds per request.

It accounted for essentially zero sampled allocation. Optimizing or replacing
it should improve throughput and latency, but it should not be expected to
close the GC gap. An explicit renderer insertion point remains preferable to
scanning the emitted byte stream.

## Rejected or deprioritized explanations

- **Application and i18n logic:** broadly similar allocation in both builds.
- **Nitro, Node, and native stream plumbing:** similar in both builds; some
  native and Node allocation buckets were higher for React.
- **Payload marker scanning as a GC cause:** CPU-heavy but allocation-light.
- **Fig's core renderer in isolation:** earlier isolated fixtures showed Fig
  rendering faster than React. The production disadvantage appears when the
  renderer is combined with server output, TanStack links, assets, and stream
  integration.

## Output-buffer optimization result

The first recommendation was implemented by replacing the request-level
`string[]` write buffer and final `join("")` with one incrementally accumulated
string. Segment chunk arrays remain unchanged because they encode Suspense
splice positions and logical ordering.

Two more aggressive alternatives were measured and rejected:

- Coalescing adjacent segment strings regressed representative server
  rendering by 5–21% because every segment write gained type and child-splice
  checks and created additional rope nodes.
- Writing attributes as separate sink fragments was approximately 6% slower,
  caused 5% more minor collections, and added roughly 12% minor-GC time in a
  fixed 20,000-render test.

The retained request-buffer change improved the production website as follows
over 40,000 requests:

| Metric            |   Original Fig |           Optimized Fig |              Change |
| ----------------- | -------------: | ----------------------: | ------------------: |
| Total GC time     |    1,014.44 ms |        580.80–592.76 ms |  approximately -42% |
| Minor GC time     |      888.83 ms |        491.61–499.69 ms |  approximately -44% |
| Major collections |             24 |                      14 |              -41.7% |
| Throughput        | 1,818.19 req/s | 1,904.77–1,904.81 req/s |               +4.8% |
| Average latency   |       26.13 ms |          24.91–25.07 ms | approximately -4.7% |

Fresh React controls measured 513.35 ms and 600.06 ms total GC across two
runs. Optimized Fig measured 580.80 ms and 592.76 ms. Fig therefore moved from
roughly twice React's GC time to approximately parity, with a two-run mean
about 5% higher than React.

After the change, Fig's individual minor collections are cheaper than React's
(approximately 0.62 ms versus 0.80 ms on the two-run means), but Fig still
collects about one-third more often. The output-retention problem is therefore
largely fixed; the remaining GC gap is now allocation frequency from the
later Link/mixin and asset-resource targets.

## Asset host-prop optimization result

The server asset writer previously built an attribute-pair array, filtered it,
converted it with `Object.fromEntries`, then sometimes cloned the resulting
props again to append a nonce. The client independently consumed the pair
array.

The replacement uses one canonical function that fills an owned props object
directly. The server seeds that object with its hydration marker and appends
the reveal-blocker id and nonce in place. Client insertion iterates the same
canonical props.

Production allocation sampling over 10,000 requests measured:

| Metric                    |    Baseline | Direct props | Change |
| ------------------------- | ----------: | -----------: | -----: |
| Total sampled allocation  | 10,446.6 MB |  10,396.2 MB |  -0.5% |
| `writeAssetTag` inclusive |    101.7 MB |      62.9 MB | -38.2% |
| Minor collections         |         228 |          210 |  -7.9% |

Two alternating fixed-work runs of 40,000 requests each measured:

| Metric              | Baseline mean | Direct-props mean | Change |
| ------------------- | ------------: | ----------------: | -----: |
| Minor collections   |           703 |               678 |  -3.6% |
| Minor GC time       |     435.29 ms |         433.62 ms |  -0.4% |
| Total GC time       |     524.02 ms |         520.45 ms |  -0.7% |
| Median request rate |   2,062 req/s |       2,090 req/s |  +1.4% |
| Average latency     |      23.87 ms |          23.71 ms |  -0.7% |

The change therefore reduces collection frequency and request allocation. Its
GC-time improvement is small because the remaining minor collections were
slightly longer in these runs.

## Recommended optimization order

### 1. Server HTML and output pipeline

Implemented with a rope-style request buffer. Segment coalescing and fragmented
start-tag writes were rejected by benchmarks. `TextEncoder.encodeInto` remains
a possible later experiment, but only if profiles continue to identify output
encoding after the higher-allocation Link/mixin and asset paths are fixed.

Success criteria must include allocation per request, young-generation
survival, minor-GC pause time, throughput, and output equivalence. A
microbenchmark of attribute serialization alone is insufficient.

### 2. Server Link hydration marker and state resolution

The server now installs the stable client-behavior marker directly, invokes
generic mixin resolution only for real mixins, and avoids empty state objects
and bind wrappers. Production allocation fell by approximately 13 KB per
request, with a small reduction in collection frequency and neutral throughput
and latency. A separate server-only state resolver remains deferred because it
would duplicate complex TanStack location and active-state logic for a smaller,
riskier gain.

### 3. Asset/preload SSR serialization

Canonical asset host props now fill the server writer's owned object directly,
removing the attribute-pair array, `Object.fromEntries`, and nonce clone. The
remaining work is:

- Avoid building both HTML props and preload-header parameter arrays when the
  same normalized values can be visited directly.
- Reassess which production module preloads are necessary.

### 4. Payload insertion

Replace byte scanning with an explicit renderer insertion point. This is a
throughput and latency improvement, not the first GC fix.

## Benchmark discipline for follow-up changes

For each optimization:

1. Build production Fig and React sites from fixed commits.
2. Use the same non-prerendered route and response semantics.
3. Warm both servers before measurement.
4. Alternate Fig and React samples to reduce environmental drift.
5. Measure fixed request counts for GC rather than only fixed time.
6. Record GC by generation, not only aggregate duration.
7. Run allocation sampling with collected minor and major objects included.
8. Confirm byte-for-byte or normalized output equivalence as appropriate.
9. Separate CPU-only improvements from allocation/retention improvements.

## Raw profile artifacts

At the time of writing, raw temporary artifacts are under:

`/private/tmp/fig-react-profile.xukcgp/`

Important files include:

- `fig-allocation.heapprofile`
- `react-allocation.heapprofile`
- `fig-cpu.cpuprofile`
- `react-cpu.cpuprofile`
- `fig-trace-gc.log`
- `react-trace-gc.log`
- `fig-no-nav-allocation.heapprofile`
- `react-no-nav-allocation.heapprofile`

The temporary website worktrees used to generate them were removed. The Fig
and `bengubler.com` primary worktrees were left unchanged.
