import { describe, expect, it } from "vite-plus/test";
import type { RefreshUpdate } from "@bgub/fig-reconciler/refresh";
import {
  getFamilyByType,
  injectScheduleRefresh,
  isLikelyComponentType,
  performRefresh,
  register,
  setSignature,
} from "./index.ts";

// Families are module-global, so each test uses unique ids and fresh functions.
let lastUpdate: RefreshUpdate | null = null;
injectScheduleRefresh((update) => {
  lastUpdate = update;
});

function component(label: string): () => string {
  // Named "Component" so isLikelyComponentType accepts it; distinct identity.
  return { Component: () => label }.Component;
}

describe("@bgub/fig-refresh runtime", () => {
  it("groups versions of the same id into one family", () => {
    const v1 = component("v1");
    const v2 = component("v2");
    register(v1, "mod#A");
    register(v2, "mod#A");

    expect(getFamilyByType(v1)).toBe(getFamilyByType(v2));
    expect(getFamilyByType(v1)).toBeDefined();
  });

  it("returns null and calls no renderer when nothing is pending", () => {
    performRefresh(); // drain anything queued by earlier tests
    lastUpdate = null;
    expect(performRefresh()).toBeNull();
    expect(lastUpdate).toBeNull();
  });

  it("buckets a same-signature edit as updated (re-render in place)", () => {
    const v1 = component("b1");
    const v2 = component("b2");
    register(v1, "mod#B");
    setSignature(v1, "useState");
    register(v2, "mod#B");
    setSignature(v2, "useState");

    const update = performRefresh();
    const family = getFamilyByType(v1);
    expect(family?.current).toBe(v2);
    expect(update?.updatedFamilies.has(family!)).toBe(true);
    expect(update?.staleFamilies.size).toBe(0);
  });

  it("buckets a changed-signature edit as stale (remount)", () => {
    const v1 = component("c1");
    const v2 = component("c2");
    register(v1, "mod#C");
    setSignature(v1, "useState");
    register(v2, "mod#C");
    setSignature(v2, "useState\nuseRef");

    const update = performRefresh();
    const family = getFamilyByType(v1);
    expect(update?.staleFamilies.has(family!)).toBe(true);
    expect(update?.updatedFamilies.size).toBe(0);
  });

  it("treats forceReset as stale", () => {
    const v1 = component("d1");
    const v2 = component("d2");
    register(v1, "mod#D");
    setSignature(v1, "useState");
    register(v2, "mod#D");
    setSignature(v2, "useState", true);

    const update = performRefresh();
    expect(update?.staleFamilies.has(getFamilyByType(v1)!)).toBe(true);
  });

  it("classifies likely component types by name", () => {
    expect(isLikelyComponentType(function App() {})).toBe(true);
    expect(isLikelyComponentType(function helper() {})).toBe(false);
    expect(isLikelyComponentType(42)).toBe(false);
  });
});
