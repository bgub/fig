# Reconciler Placement Performance Plan

## Context

The demo benchmark page now compares Fig and React on the same DOM workloads. A 1,000-row run produced this baseline:

| Scenario | Fig median | React median | Gap |
| --- | ---: | ---: | ---: |
| Initial mount | 10 ms | 2 ms | +8 ms |
| Same-order update | 3 ms | 1 ms | +2 ms |
| Append 10% | 2 ms | 1 ms | +1 ms |
| Prepend 10% | 3 ms | 1 ms | +2 ms |
| Reverse keyed rows | 17 ms | 4 ms | +13 ms |

The biggest immediate opportunity is keyed reordering, especially reverse order. The current commit path calls `hostSibling(node)` separately for each placed fiber:

```ts
function commitPlacement(node: F): void {
  if (isHost(node)) {
    commitUpdate(node);
    host.insertBefore(hostParent(node), hostNode(node), hostSibling(node));
  } else if (node.alternate !== null) {
    insertHostSubtree(node, hostParent(node), hostSibling(node));
  }
}
```

For a large reverse reorder, many siblings are marked with `PlacementFlag`, and each placement scans forward through sibling fibers to find the next stable host sibling. That can repeat the same search work many times.

After Phases 1-3, a 1,000-row browser run produced these medians:

| Scenario | Fig median | React median | Gap |
| --- | ---: | ---: | ---: |
| Initial mount | 3.500 ms | 2.286 ms | Fig 53% slower |
| Same-order update | 2.357 ms | 1.450 ms | Fig 63% slower |
| Append 10% | 1.571 ms | 2.100 ms | Fig 25% faster |
| Prepend 10% | 1.500 ms | 2.150 ms | Fig 30% faster |
| Reverse keyed rows | 3.786 ms | 4.643 ms | Fig 18% faster |

The placement work closed the reverse-keyed reorder gap and made append/prepend faster than React on this benchmark. Remaining gaps are initial mount and same-order updates.

## Goals

- Improve worst-case keyed reorder performance without changing public APIs.
- Keep the reconciler renderer-agnostic and host-config-driven.
- Preserve current correctness around host nodes, text nodes, function components, fragments, Suspense, hydration, binds, and delegated events.
- Add focused correctness tests before/with the optimization.
- Re-run the benchmark page after each phase and record before/after numbers.

## Non-goals for this pass

- Do not clone React's full commit/effect list implementation.
- Do not add benchmark-specific shortcuts.
- Do not change Fig's public component/event/bind APIs.
- Do not add a separate benchmark runner yet; keep using the demo page for measurements.

## Phase 1: Batch contiguous placement runs

### Idea

When siblings are committed and several adjacent fibers have `PlacementFlag`, compute the host insertion anchor once for the whole run instead of once per fiber.

Example new order after a reverse:

```text
D stable, C placed, B placed, A placed
```

Current behavior:

```text
place C -> find anchor by scanning siblings
place B -> find anchor by scanning siblings again
place A -> find anchor by scanning siblings again
```

Planned behavior:

```text
run = [C, B, A]
anchor = first stable host sibling after run, found once
insert C before anchor
insert B before anchor
insert A before anchor
```

Using the same stable anchor for the whole run preserves final DOM order because `insertBefore` moves/appends each node before that anchor in left-to-right fiber order.

### Implementation steps

- [x] Refactor `commitMutationEffects(node)` into a sibling-list walker, e.g. `commitMutationEffectsInList(firstChild)`.
- [x] Detect contiguous sibling runs where `(fiber.flags & PlacementFlag) !== 0`.
- [x] Add `commitPlacementRun(firstPlaced, afterRun)` or equivalent helper.
- [x] Compute the anchor once with a helper that starts after the run, e.g. `hostSiblingAfter(runTail)`.
- [x] Change `commitPlacement(node)` to accept an optional precomputed `before` anchor.
- [x] For each fiber in the run, call `commitPlacement(fiber, before)`.
- [x] Still recurse into each placed fiber's children after placement so existing update semantics are preserved.
- [x] Keep non-placement update behavior unchanged: host `UpdateFlag` still calls `commitUpdate(node)`.
- [x] Keep deletion ordering unchanged: `commitDeletions(finishedWork)` still runs before mutation placement/update effects.

### Correctness details

- A placement run is only contiguous siblings at the current parent level. Do not group across a stable sibling.
- Siblings at a given fiber level share the same nearest host parent, so a single anchor is safe for the run.
- The anchor must be the first non-placement host node after the run, including host nodes nested under non-host siblings.
- New function/component fibers with `PlacementFlag` may not insert anything themselves when `alternate === null`; their children still need normal processing.
- Moved non-host fibers with `alternate !== null` may insert their host subtree; descendants still need update traversal.
- Hydration recovery already clears/retries at the root; placement batching should not special-case hydration.

### Tests

Add reconciler-level tests in `packages/fig-reconciler/src/index.test.ts` using the existing `TestElement` host:

- [x] Reverse keyed host children and assert final text/order.
- [x] Move a contiguous run before a stable anchor and assert final order.
- [x] Move keyed children wrapped in function components and assert final order.
- [x] Mix moved children with text updates and assert both movement and text update are committed.

These tests mainly protect behavior. The performance win is measured with the demo benchmark because `hostSibling` scanning is internal.

### Expected benchmark impact

Primary target:

- `Reverse keyed rows`: should improve substantially because repeated anchor scans are reduced.

Possible smaller impact:

- `Prepend 10%`: may improve if a contiguous inserted/moved run shares an anchor.
- `Append 10%`: little to no impact because anchor is usually `null` and scans are cheap.
- `Same-order update`: no expected impact.
- `Initial mount`: little impact until Phase 2.

## Phase 2: Build initial host subtrees before insertion

### Idea

Initial mount is also far behind React. Fig currently creates host instances during render but commits many individual insertions. React-style renderers assemble detached host subtrees during complete work, then insert the completed subtree once at the nearest host parent.

For Fig, this should be a separate follow-up because it touches host config semantics and initial prop application.

### Proposed host config additions

- [x] Add optional `appendInitialChild?(parent: Instance, child: HostNode<Instance, TextInstance>): void`.
- [x] Add optional `finalizeInitialInstance?(instance: Instance, props: Props): void` or reuse/rename existing update logic carefully.
- [x] For fig-dom, `appendInitialChild` should do a raw DOM append/insert without attaching bind/event subtrees yet.
- [x] Keep `insertBefore` as the commit-time operation that attaches bind/event subtrees when a completed subtree enters the live tree.

### Reconciler work

- [x] During `complete(node)`, when `node` is a newly-created host instance, append all direct host children from the fiber subtree to that detached instance.
- [x] Use an `appendAllChildren(parentInstance, fiber)` traversal that appends host/text descendants but does not descend into a host child after appending it.
- [x] Apply initial props before the subtree is inserted, either via `finalizeInitialInstance` or an equivalent initial commit path.
- [x] During mutation commit, when a newly-created host subtree is placed, skip descendant placement operations that are already represented by the completed subtree insertion.
- [x] Still traverse descendants for non-placement mutation updates if needed.

### Risks

- `bind` callbacks should continue to run when nodes enter the live tree, not while a detached subtree is assembled.
- Event delegation bookkeeping should continue to attach once per inserted subtree.
- Initial props must still be applied for every host node before user-observable bind callbacks run.
- Text nodes and host nodes need consistent behavior across DOM and test renderers.

### Expected benchmark impact

Primary target:

- `Initial mount`: should improve significantly.

Secondary targets:

- `Append 10%`: appending newly-created row subtrees should improve.
- `Prepend 10%`: inserting newly-created head row subtrees should improve.

## Phase 3: Add a React-style child reconciliation fast path

### Idea

Fig currently builds a `Map` of all existing children for every reconciliation, even when children are in the same order:

```ts
const existing = new Map<string, F>();
for (let old = currentFirstChild; old !== null; old = old.sibling) {
  existing.set(fiberChildKey(old), old);
}
```

React first scans old/new children sequentially and only falls back to a map after the first mismatch. Fig can adopt the same broad strategy without copying the full implementation.

### Implementation sketch

- [x] Convert/collect new children into a flat `FigChild[]` with duplicate-key validation.
- [x] Walk `oldFiber` and `newChildren[index]` in lockstep while key and type match.
- [x] Reuse matching fibers without building a map.
- [x] If new children are exhausted, delete remaining old fibers.
- [x] If old fibers are exhausted, create remaining new fibers.
- [x] Only after the first mismatch, build a map for the remaining old fibers and use the existing keyed lookup behavior.
- [x] Preserve current duplicate key diagnostics and invalid child diagnostics.

### Tests

- [x] Same-order keyed update preserves identity and final order.
- [x] Append keyed children preserves old identity and inserts new tail nodes.
- [x] Prepend keyed children inserts new head nodes and preserves old identity.
- [x] Reorder keyed children still produces the correct order.
- [x] Duplicate keys still throw before commit.

### Expected benchmark impact

Primary targets:

- `Same-order update`
- `Append 10%`

Secondary target:

- `Prepend 10%`, depending on where the first mismatch occurs.

## Validation checklist

After each phase:

- [x] `pnpm lint`
- [x] `pnpm test`
- [x] `pnpm --filter @bgub/fig-demo build`
- [x] Run demo benchmark page at 1,000 rows and record medians.
- [ ] Optionally run 5,000 rows to expose scaling behavior. (pending browser measurement)

## Suggested order

1. Phase 1 first: lowest API risk and directly targets the largest measured gap.
2. Re-run benchmarks and decide whether reverse reorder is sufficiently improved.
3. Phase 2 next: more invasive, but likely the biggest initial mount win.
4. Phase 3 after that: improves common updates and likely reduces allocation pressure.
