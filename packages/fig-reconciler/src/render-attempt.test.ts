import { expect, it, vi } from "vitest";
import {
  CommitIndexedFlag,
  EffectFlag,
  NoFlags,
  PlacementFlag,
} from "./fiber-work.ts";
import { RenderAttempt } from "./render-attempt.ts";

const owner = () => ({ flags: NoFlags });

it("accumulates work while indexing each owner once", () => {
  const attempt = new RenderAttempt();
  const fiber = owner();
  attempt.record(fiber, PlacementFlag);
  attempt.record(fiber, EffectFlag);
  expect(attempt.commitIndex).toEqual([fiber]);
  expect(fiber.flags).toBe(PlacementFlag | EffectFlag | CommitIndexedFlag);
});

it("releases discarded work for re-indexing without removing its other flags", () => {
  const attempt = new RenderAttempt();
  const kept = owner();
  const discarded = { flags: NoFlags, retryQueueReads: ["pending"] };
  attempt.record(kept);
  const checkpoint = attempt.checkpoint();
  attempt.record(discarded, EffectFlag);
  attempt.rollback(checkpoint);
  expect(attempt.commitIndex).toEqual([kept]);
  expect(kept.flags & CommitIndexedFlag).toBe(CommitIndexedFlag);
  expect(discarded.flags).toBe(EffectFlag);
  expect(discarded.retryQueueReads).toBeUndefined();
  attempt.record(discarded);
  expect(attempt.commitIndex).toEqual([kept, discarded]);
});

it("clears membership from every owner when disposing the attempt", () => {
  const attempt = new RenderAttempt();
  const first = owner();
  const second = owner();
  attempt.record(first);
  attempt.record(second);
  attempt.dispose();
  expect(attempt.commitIndex).toEqual([]);
  expect(first.flags & CommitIndexedFlag).toBe(NoFlags);
  expect(second.flags & CommitIndexedFlag).toBe(NoFlags);
});

it("rolls back reads and retries independently of commit-index membership", () => {
  const attempt = new RenderAttempt<ReturnType<typeof owner>, string>();
  const kept = owner();
  attempt.record(kept);
  const keptReads = attempt.dataReads(kept);
  keptReads.set("kept", { value: "committed later" });
  attempt.recordRetry("outer");
  const checkpoint = attempt.checkpoint();
  // Read ownership must not rely on inclusion in the mutation index.
  const discarded = owner();
  const discardedReads = attempt.dataReads(discarded);
  discardedReads.set("discarded", { value: {} });
  attempt.observeStore(discarded, () => 1, 0);
  attempt.recordRetry("inner");
  attempt.rollback(checkpoint);
  expect(discardedReads.size).toBe(0);
  expect(attempt.reads.has(discarded)).toBe(false);
  expect(keptReads.size).toBe(1);
  expect(attempt.retries).toEqual(["outer"]);
  expect(attempt.commitIndex).toEqual([kept]);
  attempt.dispose();
  expect(keptReads.size).toBe(0);
  expect(attempt.reads.size).toBe(0);
  expect(attempt.retries).toEqual([]);
  expect(attempt.commitIndex).toEqual([]);
});

it("isolates observations when attempts reuse the same fiber", () => {
  const reader = owner();
  const first = new RenderAttempt();
  const second = new RenderAttempt();
  const oldReads = first.dataReads(reader);
  const newReads = second.dataReads(reader);
  oldReads.set("key", { value: "old" });
  newReads.set("key", { value: "new" });
  first.dispose();
  expect(oldReads.size).toBe(0);
  expect(newReads.get("key")).toEqual({ value: "new" });
});

it("discards shadow observations before the real invocation", () => {
  const attempt = new RenderAttempt();
  const reader = owner();
  const reads = attempt.dataReads(reader);
  reads.set("key", { value: "shadow" });
  attempt.observeStore(reader, () => "shadow", "shadow");
  attempt.resetReads(reader);
  expect(reads.size).toBe(0);
  expect(attempt.reads.get(reader)?.stores).toEqual([]);
  attempt.observeStore(reader, () => "real", "real");
  expect(attempt.reads.get(reader)?.stores).toHaveLength(1);
});

it("revalidates deferred candidates without publishing or releasing capture early", () => {
  const attempt = new RenderAttempt();
  const reads = attempt.dataReads(owner());
  reads.set("key", { value: "old" });
  let snapshot = "old";
  const publish = vi.fn();
  const after = vi.fn();
  const candidate = attempt.finish(() => snapshot === "old", publish);
  candidate.defer();
  snapshot = "new";
  expect(candidate.runMutation(after)).toEqual({ kind: "stale" });
  expect(publish).not.toHaveBeenCalled();
  expect(after).not.toHaveBeenCalled();
  expect(reads.size).toBe(0);
  expect(candidate.captureReleased).toBe(false);
  candidate.releaseCapture();
  candidate.releaseCapture();
  expect(candidate.captureReleased).toBe(true);
  expect(() => candidate.runMutation(after)).toThrow("only once");
});

it("distinguishes a committed undefined result from a skipped mutation", () => {
  const attempt = new RenderAttempt();
  const reads = attempt.dataReads(owner());
  reads.set("key", { value: {} });
  const publish = vi.fn();
  const validate = vi.fn(() => false);
  const candidate = attempt.finish(validate, publish);
  expect(() => candidate.releaseCapture()).toThrow("before running");
  expect(candidate.runMutation(() => undefined)).toEqual({
    kind: "committed",
    value: undefined,
  });
  expect(publish).toHaveBeenCalledOnce();
  expect(validate).not.toHaveBeenCalled();
  expect(reads.size).toBe(0);
  expect(() => candidate.runMutation(() => undefined)).toThrow("only once");
  // Hosts may complete synchronously, then report deferred capture ownership.
  candidate.releaseCapture();
  candidate.defer();
  expect(candidate.captureReleased).toBe(true);
});

it("keeps failed publication terminal while allowing capture cleanup", () => {
  const attempt = new RenderAttempt();
  const reads = attempt.dataReads(owner());
  reads.set("key", { value: {} });
  const error = new Error("host mutation failed");
  const candidate = attempt.finish(
    () => true,
    () => {
      throw error;
    },
  );
  const after = vi.fn();
  expect(() => candidate.runMutation(after)).toThrow(error);
  expect(candidate.outcome).toBe("failed");
  expect(after).not.toHaveBeenCalled();
  expect(reads.size).toBe(0);
  candidate.releaseCapture();
  expect(candidate.captureReleased).toBe(true);
});

it("prevents a late host callback from publishing an abandoned attempt", () => {
  const first = new RenderAttempt();
  const stalePublish = vi.fn();
  const stale = first.finish(() => true, stalePublish);
  stale.defer();
  first.dispose();
  const second = new RenderAttempt();
  const freshPublish = vi.fn();
  const fresh = second.finish(() => true, freshPublish);
  expect(fresh.runMutation(() => "new")).toEqual({
    kind: "committed",
    value: "new",
  });
  expect(stale.runMutation(() => "old")).toEqual({ kind: "stale" });
  stale.releaseCapture();
  expect(stalePublish).not.toHaveBeenCalled();
  expect(freshPublish).toHaveBeenCalledOnce();
  expect(fresh.captureReleased).toBe(false);
});
