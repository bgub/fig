import { describe, expect, it } from "vite-plus/test";
import {
  clearCommitIndex,
  commitIndexCheckpoint,
  createCommitIndex,
  recordCommitWork,
  rollbackCommitIndex,
} from "./commit-index.ts";
import {
  CommitIndexedFlag,
  EffectFlag,
  NoFlags,
  PlacementFlag,
} from "./fiber-work.ts";

interface Node {
  flags: number;
  name: string;
}

function node(name: string): Node {
  return { flags: NoFlags, name };
}

describe("commit index", () => {
  it("records accumulating work while indexing each fiber once", () => {
    const index = createCommitIndex<Node>();
    const fiber = node("fiber");

    recordCommitWork(index, fiber, PlacementFlag);
    recordCommitWork(index, fiber, EffectFlag);

    expect(index).toEqual([fiber]);
    expect(fiber.flags).toBe(PlacementFlag | EffectFlag | CommitIndexedFlag);
  });

  it("rolls back entries recorded after a checkpoint", () => {
    const index = createCommitIndex<Node>();
    const kept = node("kept");
    const discarded = node("discarded");
    recordCommitWork(index, kept);
    const checkpoint = commitIndexCheckpoint(index);
    recordCommitWork(index, discarded);

    rollbackCommitIndex(index, checkpoint);

    expect(index).toEqual([kept]);
    expect(kept.flags & CommitIndexedFlag).toBe(CommitIndexedFlag);
    expect(discarded.flags & CommitIndexedFlag).toBe(NoFlags);
  });

  it("clears membership from every indexed fiber", () => {
    const index = createCommitIndex<Node>();
    const first = node("first");
    const second = node("second");
    recordCommitWork(index, first);
    recordCommitWork(index, second);

    clearCommitIndex(index);

    expect(index).toEqual([]);
    expect(first.flags & CommitIndexedFlag).toBe(NoFlags);
    expect(second.flags & CommitIndexedFlag).toBe(NoFlags);
  });
});
