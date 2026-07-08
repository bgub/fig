import type { RefreshUpdate } from "@bgub/fig-reconciler/refresh";
import { describe, expect, it, vi } from "vite-plus/test";
import {
  injectScheduleRefresh,
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
  // Named "Component" so tests exercise component-like function identities.
  return { Component: () => label }.Component;
}

describe("@bgub/fig-refresh runtime", () => {
  it("groups versions of the same id into one family", () => {
    const v1 = component("v1");
    const v2 = component("v2");
    register(v1, "mod#A");
    register(v2, "mod#A");

    const update = performRefresh();
    expect(update?.updatedFamilies.size).toBe(1);
    expect([...update!.updatedFamilies][0]?.current).toBe(v2);
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
    const family = [...update!.updatedFamilies][0];
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
    const family = [...update!.staleFamilies][0];
    expect(family?.current).toBe(v2);
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
    const family = [...update!.staleFamilies][0];
    expect(family?.current).toBe(v2);
    expect(update?.staleFamilies.has(family!)).toBe(true);
  });

  it("replays refreshes performed before a scheduler is injected", async () => {
    vi.resetModules();
    const runtime = await import("./index.ts");
    let delivered: RefreshUpdate | null = null;
    const v1 = component("e1");
    const v2 = component("e2");

    runtime.register(v1, "mod#E");
    runtime.setSignature(v1, "useState");
    runtime.register(v2, "mod#E");
    runtime.setSignature(v2, "useState");

    const update = runtime.performRefresh();
    expect(update?.updatedFamilies.size).toBe(1);
    expect(delivered).toBeNull();

    runtime.injectScheduleRefresh((nextUpdate) => {
      delivered = nextUpdate;
    });

    expect(delivered).toBe(update);
  });
});
