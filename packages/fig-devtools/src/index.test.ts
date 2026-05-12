import { describe, expect, it } from "vite-plus/test";
import {
  createFigDevtoolsGlobalHook,
  ensureFigDevtoolsGlobalHook,
  FIG_DEVTOOLS_HOOK_KEY,
} from "./index.ts";

describe("@bgub/fig-devtools", () => {
  it("stores renderer and root snapshots and notifies subscribers", () => {
    const hook = createFigDevtoolsGlobalHook();
    let notifications = 0;
    const unsubscribe = hook.subscribe(() => {
      notifications += 1;
    });

    const rendererId = hook.inject({
      name: "Fig",
      packageName: "@bgub/fig-reconciler",
    });

    hook.onCommitRoot(rendererId, {
      id: 1,
      rendererId,
      committedAt: 10,
      pendingLanes: 0,
      suspendedLanes: 0,
      pingedLanes: 0,
      expiredLanes: 0,
      tree: {
        id: 1,
        parentId: null,
        name: "Root",
        kind: "root",
        key: null,
        index: 0,
        props: {},
        lanes: 0,
        childLanes: 0,
        hooks: [],
        contextDependencies: [],
        children: [],
      },
    });

    unsubscribe();
    hook.inject({ name: "Other", packageName: "other" });

    expect(rendererId).toBe(1);
    expect(hook.renderers.get(rendererId)?.name).toBe("Fig");
    expect(hook.roots.get(1)?.tree.name).toBe("Root");
    expect(notifications).toBe(2);
  });

  it("reuses an existing Fig DevTools hook on a target global", () => {
    const target = {} as typeof globalThis & {
      [FIG_DEVTOOLS_HOOK_KEY]?: unknown;
    };
    const hook = ensureFigDevtoolsGlobalHook(target);

    expect(ensureFigDevtoolsGlobalHook(target)).toBe(hook);
  });
});
