import type { AssetResourceOwner } from "@bgub/fig-reconciler";
import { expect, it } from "vitest";
import { MetadataClaims } from "./metadata-claims.ts";
import { FakeElement } from "./test-utils.ts";

it("throws when releasing an owner without a live metadata claim", () => {
  const owner = {} as AssetResourceOwner;
  const claims = new MetadataClaims(
    new FakeElement("meta") as unknown as Element,
    "meta",
    owner,
    { content: "Current", name: "description" },
  );

  expect(() => claims.release({} as AssetResourceOwner)).toThrow(
    "Expected a live metadata claim.",
  );
});
