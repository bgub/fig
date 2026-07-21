import { CommitIndexedFlag, type Flag, NoFlags } from "./fiber-work.ts";

interface CommitIndexNode {
  flags: Flag;
}

export type CommitIndex<Node extends CommitIndexNode> = Node[];

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
  checkpoint: number | undefined,
): void {
  if (checkpoint === undefined || checkpoint >= index.length) return;
  for (let offset = checkpoint; offset < index.length; offset += 1) {
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
