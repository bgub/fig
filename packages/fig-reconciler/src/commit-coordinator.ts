/**
 * Commit coordination contracts shared by Fig renderers.
 *
 * @module
 */
/** Describes reconciler commit result. */
export type ReconcilerCommitResult =
  | false
  | "committed"
  | {
      /** Finish mutation and release capture synchronously, without animation. */
      interrupt(this: void): void;
    };
/** Mutation publication and callback results are distinct from capture release. */
export type ReconcilerMutationResult<Result> =
  | { readonly kind: "committed"; readonly value: Result }
  | { readonly kind: "stale" }
  | { readonly kind: "failed" };
/** Describes reconciler work priority. */
export type ReconcilerWorkPriority =
  | "blocking"
  | "transition"
  | "suspense"
  | "idle";

/** The reconciler commit coordinator host types. */
declare const ReconcilerCommitCoordinatorHostTypes: unique symbol;

/** Describes reconciler commit context. */
export interface ReconcilerCommitContext<Container> {
  readonly container: Container;
  readonly finishedWork: object;
  readonly priority: ReconcilerWorkPriority;
  readonly root: object;
  captureFinished(this: void): void;
  /**
   * Runs a still-consistent transaction and its post-mutation callback.
   * A deferred transaction may be abandoned if a store changed meanwhile;
   * then no host mutation runs, the callback is skipped, and stale is returned.
   * Deferred errors are reported through the root and return failed. Synchronous
   * errors still throw. For every outcome, release any prepared capture and call
   * captureFinished. A committed callback may itself return undefined.
   */
  runMutation<Result>(
    this: void,
    afterMutation: () => Result,
  ): ReconcilerMutationResult<Result>;
}

/** Describes reconciler commit coordinator. */
export interface ReconcilerCommitCoordinator<Container, Instance> {
  // Invariant, type-only host identity. A coordinator created for one
  // renderer's container/instance pair cannot be installed on another.
  readonly [ReconcilerCommitCoordinatorHostTypes]?: (
    container: Container,
    instance: Instance,
  ) => readonly [Container, Instance];
  readonly name: string;
  readonly viewTransitions?: true;
  // Returning false promises that no mutation was performed; the reconciler
  // then follows its ordinary commit path.
  commit(
    this: void,
    context: ReconcilerCommitContext<Container>,
  ): ReconcilerCommitResult;
  suspend?(this: void, root: object, onReady: () => void): boolean;
}
