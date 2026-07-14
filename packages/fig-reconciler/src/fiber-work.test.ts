import { describe, expect, it } from "vitest";
import {
  childSubtreeFlags,
  clearTransientFlags,
  CommitIndexedFlag,
  EffectFlag,
  HoistedStaticFlag,
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
        HoistedStaticFlag |
        ViewTransitionStaticFlag,
      subtreeFlags: EffectFlag,
    });

    expect(flags).toBe(PlacementFlag | ViewTransitionStaticFlag | EffectFlag);
  });

  it("clears transient work while retaining static capabilities", () => {
    const node = {
      flags: PlacementFlag | HoistedStaticFlag | ViewTransitionStaticFlag,
      subtreeFlags: EffectFlag | HoistedStaticFlag | ViewTransitionStaticFlag,
    };

    clearTransientFlags(node);

    expect(node).toEqual({
      flags: HoistedStaticFlag | ViewTransitionStaticFlag,
      subtreeFlags: HoistedStaticFlag | ViewTransitionStaticFlag,
    });
  });

  it("represents an empty child summary as no flags", () => {
    expect(childSubtreeFlags({ flags: NoFlags, subtreeFlags: NoFlags })).toBe(
      NoFlags,
    );
  });
});
