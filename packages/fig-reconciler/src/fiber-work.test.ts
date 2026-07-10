import { describe, expect, it } from "vite-plus/test";
import {
  childSubtreeFlags,
  clearTransientFlags,
  CommitIndexedFlag,
  EffectFlag,
  NoFlags,
  PlacementFlag,
  TextContentFlag,
  UpdateFlag,
  ViewTransitionStaticFlag,
} from "./fiber-work.ts";

describe("fiber work", () => {
  it("folds subtree-visible work while excluding sparse-index work", () => {
    const flags = childSubtreeFlags({
      flags:
        PlacementFlag |
        UpdateFlag |
        TextContentFlag |
        CommitIndexedFlag |
        ViewTransitionStaticFlag,
      subtreeFlags: EffectFlag,
    });

    expect(flags).toBe(PlacementFlag | ViewTransitionStaticFlag | EffectFlag);
  });

  it("clears transient work while retaining static capabilities", () => {
    const node = {
      flags: PlacementFlag | ViewTransitionStaticFlag,
      subtreeFlags: EffectFlag | ViewTransitionStaticFlag,
    };

    clearTransientFlags(node);

    expect(node).toEqual({
      flags: ViewTransitionStaticFlag,
      subtreeFlags: ViewTransitionStaticFlag,
    });
  });

  it("represents an empty child summary as no flags", () => {
    expect(childSubtreeFlags({ flags: NoFlags, subtreeFlags: NoFlags })).toBe(
      NoFlags,
    );
  });
});
