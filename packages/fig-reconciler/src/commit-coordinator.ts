export type ReconcilerCommitResult = false | "committed" | "deferred";
export type ReconcilerWorkPriority =
  | "blocking"
  | "transition"
  | "suspense"
  | "idle";

declare const ReconcilerCommitCoordinatorHostTypes: unique symbol;

export interface ReconcilerCommitContext<Container> {
  readonly container: Container;
  readonly finishedWork: object;
  readonly priority: ReconcilerWorkPriority;
  readonly root: object;
  captureFinished(this: void): void;
  runMutation<Result>(
    this: void,
    afterMutation: () => Result,
  ): Result | undefined;
}

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
