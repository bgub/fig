---
packages:
  "@bgub/fig":
    type: patch
  "@bgub/fig-reconciler":
    type: major
---

## Own speculative work by render attempt

Render attempts own data read sets, client external-store observations, boundary retries, and the sparse commit index. Checkpoints roll these back together, and terminal commit candidates release all speculative ownership. Data stores retain committed subscriptions without retaining values from abandoned fiber generations.

Commit candidates publish once and retain their identity across deferred host callbacks. Capture release is independent of mutation and cannot finish a newer candidate.

Custom commit coordinators must migrate `runMutation()` result handling from `Result | undefined` to `ReconcilerMutationResult<Result>`: `{ kind: "committed", value }`, `{ kind: "stale" }`, or `{ kind: "failed" }`. Stale candidates skip mutation and the post-mutation callback. Failed results indicate an error during publication or the callback; deferred failures are reported through the root, while synchronous failures still throw. Release prepared capture state and call `captureFinished()` for all returned outcomes. Successful callbacks returning `undefined` remain explicitly committed.
