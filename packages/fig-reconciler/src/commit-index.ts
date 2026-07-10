import { CommitIndexedFlag, type Flag, NoFlags } from "./fiber-work.ts";

interface CommitIndexNode {
  flags: Flag;
}

declare const CommitIndexCheckpointBrand: unique symbol;

export type CommitIndexCheckpoint = number & {
  readonly [CommitIndexCheckpointBrand]: true;
};

export type CommitIndex<Node extends CommitIndexNode> = Node[];

export function createCommitIndex<
  Node extends CommitIndexNode,
>(): CommitIndex<Node> {
  return [];
}

export function commitIndexCheckpoint<Node extends CommitIndexNode>(
  index: CommitIndex<Node>,
): CommitIndexCheckpoint {
  return index.length as CommitIndexCheckpoint;
}

export function recordCommitWork<Node extends CommitIndexNode>(
  index: CommitIndex<Node>,
  node: Node,
  flags: Flag = NoFlags,
): void {
  node.flags |= flags;
  if ((node.flags & CommitIndexedFlag) !== 0) return;
  node.flags |= CommitIndexedFlag;
  index.push(node);
}

export function rollbackCommitIndex<Node extends CommitIndexNode>(
  index: CommitIndex<Node>,
  checkpoint: CommitIndexCheckpoint | undefined,
): void {
  if (checkpoint === undefined || checkpoint >= index.length) return;
  const start: number = checkpoint;
  for (let offset = start; offset < index.length; offset += 1) {
    index[offset].flags &= ~CommitIndexedFlag;
  }
  index.length = checkpoint;
}

export function clearCommitIndex<Node extends CommitIndexNode>(
  index: CommitIndex<Node>,
): void {
  for (const node of index) node.flags &= ~CommitIndexedFlag;
  index.length = 0;
}
