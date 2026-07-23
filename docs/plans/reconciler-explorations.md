# Reconciler Exploration Backlog

Status: **future exploration / not queued**. These directions remain worth exploring at some arbitrary point, but none is scheduled or ordered. When an idea ships, its contracts and rationale graduate to the owning file in `docs/concepts/`.

The reconciler is a single ~7.1k-LOC closure per renderer instance, Fig owns its Vite plugin and JSX runtime, and reads are explicit (`readContext`, `readData`, and `readPromise`). Those properties give Fig optimization and static-analysis options that are unavailable to a general React-compatible runtime.

## 1. Opt-in build-time requirement analysis

Fig's explicit read verbs make component dependencies statically visible. Extend `fig-vite` with an optional pass that computes which contexts and data resources a component subtree reads, subtracts providers in scope, and reports unmet requirements at route or root boundaries.

The first prototype handled direct `readContext`/`readData` calls, local JSX composition, and simple provider discharge. It added 645 B to the minified+gzipped `fig-vite` artifact, with no application runtime or bundle cost. A synthetic 1,000-component module took 21.46 ms median to analyze.

The next version needs import-graph traversal, lexical-scope correctness, and an explicit annotation story for dependencies hidden behind arbitrary helper calls. Keep it opt-in until its diagnostics and escape hatches are dependable. Besides validation, the resulting per-route dependency graph could let the server start independent data loads earlier.

## 2. Direct host binding with proven eligibility

When a store-backed value flows unmodified into one text node or host attribute, a direct subscription could patch that host instance without scheduling, rendering, or diffing the surrounding component. Structural changes and transformed values continue through normal reconciliation.

An intentionally unsafe external-store prototype added 198 B to `fig-dom` and 212 B to the reconciler. A sparse 1,000-row store update fell from 0.201 ms to 0.030 ms (85.2% faster), and component renders fell from 100 to zero. This is a useful upper bound, not a mergeable runtime heuristic: observing one render cannot prove that future control flow, attributes, or dependencies remain unchanged.

Explore this only through one of two sound eligibility mechanisms:

- compiler proof that a dependency feeds a stable host slot unchanged; or
- an explicit binding API whose contract declares that stable relationship.

Either design must specify batching, transitions, Activity visibility, hydration adoption, unmount cancellation, and error behavior before it can bypass the normal update path.

## 3. Compiler-extracted templates

**Status: archived experiment; not an active direction.** The implementation and its tests remain on [`experimental/compile-templates`](https://github.com/bgub/fig/tree/experimental/compile-templates) as research evidence, not maintained or mergeable product code.

The compiler splits eligible static JSX into a hoisted `<template>` and a list of dynamic slots. A template fiber mounts by cloning the template and binding the slots; updates diff only the slot values, so reconciler work no longer scales with the static portion of the subtree. Unsupported constructs fall back to ordinary fibers.

At 1,000 rows in headless Chromium, the experiment was 1.43–1.47× faster on mount, 2.74–2.92× faster on same-order updates, and 1.10–1.11× faster on reverse-keyed updates. Its size-limit deltas were +109 B for `@bgub/fig`, +13 B for the core subset, +1,025 B for `fig-dom`, and +265 B for the reconciler.

The best-case update result did not justify a second reconciliation model and its permanent compiler, events, hydration, server-rendering, Payload, and slot-identity contracts. Conservative eligibility also excluded many common JSX shapes, limiting how often applications would receive the benefit. Reconsider only if profiling real applications shows that large, compiler-eligible static host subtrees are a material bottleneck; use the archived branch as evidence rather than as a porting base.

## Measurement protocol

This machine is bimodal: confirm runtime changes with paired A/B runs of at least 15 samples at 1,000 rows. `fig-server` scenarios are useful drift controls because the reconciler does not run in them. `size-limit --json` reports sizes but does not enforce budgets, so also run the plain command.

```sh
pnpm test:reconciler && pnpm exec vp test
pnpm --filter @bgub/fig-reconciler build
pnpm exec size-limit
node benchmarks/reconciler.mjs --scenario=<name> --runtime=fig --rows=1000 --samples=15
```
