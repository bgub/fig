export const NoFlags = 0;

// Render emits transient work on individual fibers. Completion folds the
// subset in SubtreeVisibleFlags into subtreeFlags, and commit interprets the
// resulting tree summary in host order.
export const PlacementFlag = 1 << 0;
export const UpdateFlag = 1 << 1;
export const HydrationFlag = 1 << 2;
export const TextContentFlag = 1 << 3;
export const VisibilityFlag = 1 << 5;
export const DeletionFlag = 1 << 7;
export const EffectFlag = 1 << 9;
export const StoreConsistencyFlag = 1 << 11;

// The fiber reused its committed children without cloning; render skips the
// subtree and commit walks must not consume already-committed state below it.
export const AdoptedFlag = 1 << 4;
// A host fiber assembled its children at complete-time, so placement inserts
// the whole subtree once instead of placing each child independently.
export const AssembledFlag = 1 << 6;
// Membership in the root's sparse commit index. Recording is idempotent, and
// rollback clears this bit from every discarded index entry.
export const CommitIndexedFlag = 1 << 8;
// This render already propagated changed providers through the subtree.
export const ContextPropagationFlag = 1 << 10;
// Static capabilities survive commits and bailouts. A subtree capability is
// a durable fact about tree shape, unlike transient work owed by this commit.
export const ViewTransitionStaticFlag = 1 << 12;
// The host resolved this fiber to an out-of-band instance. Placement is fixed
// for the fiber's lifetime and survives updates without reclassifying props.
export const HoistedStaticFlag = 1 << 13;

export type Flag = number;

export const MutationMask =
  PlacementFlag | UpdateFlag | HydrationFlag | TextContentFlag | VisibilityFlag;
export const HostUpdateMask = UpdateFlag | TextContentFlag;

// These marks never enter subtreeFlags. Host updates are found through the
// sparse commit index; membership and cache marks are not descendant work.
const SubtreeMaskedFlags =
  CommitIndexedFlag | HostUpdateMask | HoistedStaticFlag;
// Static facts survive commits and bailouts so adopted and deleted subtrees
// remain searchable without rebuilding their summaries.
export const StaticFlagsMask = ViewTransitionStaticFlag | HoistedStaticFlag;

export function childSubtreeFlags(node: {
  flags: Flag;
  subtreeFlags: Flag;
}): Flag {
  return (node.flags & ~SubtreeMaskedFlags) | node.subtreeFlags;
}

export function clearTransientFlags(node: {
  flags: Flag;
  subtreeFlags: Flag;
}): void {
  node.flags &= StaticFlagsMask;
  node.subtreeFlags &= StaticFlagsMask;
}
