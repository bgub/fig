import type { FigDataReads } from "@bgub/fig/internal";
import type { ReconcilerMutationResult } from "./commit-coordinator.ts";
import { CommitIndexedFlag, type Flag, NoFlags } from "./fiber-work.ts";

interface WorkOwner {
  flags: Flag;
  retryQueueReads?: unknown;
}

interface StoreRead {
  getSnapshot: () => unknown;
  value: unknown;
}

interface OwnerReads {
  data?: FigDataReads;
  stores?: StoreRead[];
}

export interface RenderCheckpoint {
  readonly work: number;
  readonly readers: number;
  readonly retries: number;
}

// The index accelerates commit traversal; the read journal owns observations.
// Their lifetimes meet here, so discarding work cannot strand data in a store
// or mistake a reused fiber's previous attempt for the current one.
export class RenderAttempt<Owner extends WorkOwner, Retry> {
  private readonly work: Owner[] = [];
  private readonly retryRecords: Retry[] = [];
  private readonly observations = new Map<Owner, OwnerReads>();
  private readonly readers: Owner[] = [];
  private phase: "rendering" | "prepared" | "disposed" = "rendering";

  get disposed(): boolean {
    return this.phase === "disposed";
  }
  get commitIndex(): readonly Owner[] {
    return this.work;
  }
  get retries(): readonly Retry[] {
    return this.retryRecords;
  }
  get reads(): ReadonlyMap<Owner, OwnerReads> {
    return this.observations;
  }

  record(owner: Owner, flags: Flag = NoFlags): void {
    if (this.disposed)
      throw new Error("Cannot record work in a disposed render attempt.");
    owner.flags |= flags;
    if ((owner.flags & CommitIndexedFlag) !== 0) return;
    owner.flags |= CommitIndexedFlag;
    this.work.push(owner);
  }

  recordRetry(retry: Retry): void {
    this.retryRecords.push(retry);
  }

  checkpoint(): RenderCheckpoint {
    return {
      work: this.work.length,
      readers: this.readers.length,
      retries: this.retryRecords.length,
    };
  }

  dataReads(owner: Owner): FigDataReads {
    return (this.ownerReads(owner).data ??= new Map());
  }

  observeStore(owner: Owner, getSnapshot: () => unknown, value: unknown): void {
    (this.ownerReads(owner).stores ??= []).push({ getSnapshot, value });
  }

  // A strict shadow pass shares a fiber identity, but none of its observations.
  resetReads(owner: Owner): void {
    const reads = this.observations.get(owner);
    reads?.data?.clear();
    if (reads?.stores !== undefined) reads.stores.length = 0;
  }

  rollback(checkpoint: RenderCheckpoint): void {
    for (let i = checkpoint.readers; i < this.readers.length; i += 1) {
      const owner = this.readers[i];
      this.resetReads(owner);
      this.observations.delete(owner);
    }
    this.readers.length = checkpoint.readers;
    this.retryRecords.length = checkpoint.retries;
    for (let i = checkpoint.work; i < this.work.length; i += 1) {
      const owner = this.work[i];
      owner.retryQueueReads = undefined;
      owner.flags &= ~CommitIndexedFlag;
    }
    this.work.length = checkpoint.work;
  }

  finish(validate: () => boolean, publish: () => void): CommitCandidate {
    if (this.phase !== "rendering")
      throw new Error(
        "A render attempt can prepare only one commit candidate.",
      );
    this.phase = "prepared";
    return new CommitCandidate(this, validate, publish);
  }

  dispose(): void {
    if (this.disposed) return;
    this.rollback({ work: 0, readers: 0, retries: 0 });
    this.phase = "disposed";
  }

  private ownerReads(owner: Owner): OwnerReads {
    if (this.phase !== "rendering")
      throw new Error(
        "Cannot observe reads after preparing a commit candidate.",
      );
    let reads = this.observations.get(owner);
    if (reads === undefined) {
      reads = {};
      this.observations.set(owner, reads);
      this.readers.push(owner);
    }
    return reads;
  }
}

type MutationState = "pending" | "running" | "committed" | "stale" | "failed";

// A candidate keeps the identity of its attempt across host callbacks. Mutation
// is one-shot; capture release is a separate, idempotent transition, including
// when validation skips the mutation entirely.
export class CommitCandidate {
  private mutation: MutationState = "pending";
  private released = false;
  private isDeferred = false;

  constructor(
    private readonly attempt: { readonly disposed: boolean; dispose(): void },
    private readonly validate: () => boolean,
    private readonly publish: () => void,
  ) {}

  get outcome(): MutationState {
    return this.mutation;
  }
  get captureReleased(): boolean {
    return this.released;
  }
  get deferred(): boolean {
    return this.isDeferred;
  }

  defer(): void {
    this.isDeferred = true;
  }

  runMutation<Result>(
    afterMutation: () => Result,
  ): ReconcilerMutationResult<Result> {
    if (this.mutation !== "pending")
      throw new Error(
        "A commit coordinator may run its mutation transaction only once.",
      );
    this.mutation = "running";
    try {
      if (this.attempt.disposed || (this.isDeferred && !this.validate())) {
        this.mutation = "stale";
        this.attempt.dispose();
        return { kind: "stale" };
      }
      this.publish();
      this.attempt.dispose();
      this.mutation = "committed";
      return { kind: "committed", value: afterMutation() };
    } catch (error) {
      this.mutation = "failed";
      this.attempt.dispose();
      throw error;
    }
  }

  releaseCapture(): void {
    if (this.mutation === "pending" || this.mutation === "running")
      throw new Error(
        "A commit coordinator cannot finish capture before running the mutation transaction.",
      );
    this.released = true;
  }
}
