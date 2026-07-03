// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vite-plus/test";
import { serverRuntimeCodeFor } from "./protocol.ts";

interface TestRuntime {
  ac(activityId: string, boundaryId: string, segmentId: string): void;
  ax(
    activityId: string,
    boundaryId: string,
    digest: string,
    message: string,
  ): void;
  c(boundaryId: string, segmentId: string): void;
  x(boundaryId: string, digest: string, message: string): void;
}

type RetriableComment = Comment & { __figRetry?: () => void };

// Evaluate the inline runtime against the real (happy-dom) document, exactly
// as a browser would; template content is a real inert DocumentFragment, so
// the `e.content || e` branches in the ops are exercised for real.
function installRuntime(): TestRuntime {
  const globalScope: { __figSSR?: TestRuntime } = {};

  // oxlint-disable-next-line typescript-eslint/no-implied-eval
  new Function("document", "globalThis", serverRuntimeCodeFor("__figSSR"))(
    document,
    globalScope,
  );

  if (globalScope.__figSSR === undefined) {
    throw new Error("Expected server runtime.");
  }

  return globalScope.__figSSR;
}

function createPendingBoundary(parent: ParentNode): {
  boundaryPlaceholder: HTMLTemplateElement;
  calls: string[];
  end: Comment;
  fallback: HTMLElement;
  start: RetriableComment;
} {
  const calls: string[] = [];
  const start = document.createComment(
    "fig:suspense:pending:0",
  ) as RetriableComment;
  const boundaryPlaceholder = document.createElement("template");
  boundaryPlaceholder.id = "b";
  const fallback = document.createElement("div");
  fallback.textContent = "fallback";
  const end = document.createComment("/fig:suspense");

  start.__figRetry = () => calls.push("retry");
  parent.append(start, boundaryPlaceholder, fallback, end);

  return { boundaryPlaceholder, calls, end, fallback, start };
}

function appendCompletedSegment(root: HTMLElement): {
  after: HTMLElement;
  completed: HTMLElement;
  segment: HTMLElement;
} {
  const after = document.createElement("div");
  after.id = "after";
  const segment = document.createElement("div");
  segment.id = "s";
  const completed = document.createElement("div");
  completed.id = "completed";

  root.append(after, segment);
  segment.append(completed);

  return { after, completed, segment };
}

describe("server streaming protocol", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it("replaces fallback content and preserves Suspense markers when completing a boundary", () => {
    const root = document.createElement("div");
    document.body.append(root);
    const { boundaryPlaceholder, calls, end, fallback, start } =
      createPendingBoundary(root);
    const { after, completed, segment } = appendCompletedSegment(root);

    installRuntime().c("b", "s");

    expect(Array.from(root.childNodes)).toEqual([start, completed, end, after]);
    expect(segment.parentNode).toBeNull();
    expect(start.data).toBe("fig:suspense:completed");
    expect(start.parentNode).toBe(root);
    expect(boundaryPlaceholder.parentNode).toBeNull();
    expect(fallback.parentNode).toBeNull();
    expect(end.parentNode).toBe(root);
    expect(calls).toEqual(["retry"]);
  });

  it("removes nested fallback Suspense ranges when completing a boundary", () => {
    const root = document.createElement("div");
    document.body.append(root);
    const { boundaryPlaceholder, calls, end, fallback, start } =
      createPendingBoundary(root);
    const innerStart = document.createComment("fig:suspense:pending:1");
    const innerEnd = document.createComment("/fig:suspense");
    const innerPlaceholder = document.createElement("template");
    innerPlaceholder.id = "ib";

    root.insertBefore(innerStart, fallback);
    root.insertBefore(innerPlaceholder, fallback);
    root.insertBefore(innerEnd, end);
    const { after, completed, segment } = appendCompletedSegment(root);

    installRuntime().c("b", "s");

    expect(Array.from(root.childNodes)).toEqual([start, completed, end, after]);
    expect(segment.parentNode).toBeNull();
    expect(boundaryPlaceholder.parentNode).toBeNull();
    expect(start.data).toBe("fig:suspense:completed");
    expect(calls).toEqual(["retry"]);
  });

  it("marks client-rendered boundaries and retries hydrated parents", () => {
    const root = document.createElement("div");
    document.body.append(root);
    const { boundaryPlaceholder, calls, start } = createPendingBoundary(root);

    installRuntime().x("b", "digest-1", "Server failed");

    expect(start.data).toBe("fig:suspense:client");
    expect(boundaryPlaceholder.dataset.dgst).toBe("digest-1");
    expect(boundaryPlaceholder.dataset.msg).toBe("Server failed");
    expect(calls).toEqual(["retry"]);
  });

  it("completes Activity-hidden boundaries inside real template content", () => {
    // The boundary markers live inside a real <template>'s content fragment,
    // which getElementById cannot reach — the `ac` op must resolve them
    // through the template's inert content.
    const activity = document.createElement("template");
    activity.id = "a";
    document.body.append(activity);
    const { boundaryPlaceholder, calls, end, fallback, start } =
      createPendingBoundary(activity.content);

    const segment = document.createElement("div");
    segment.id = "s";
    const completed = document.createElement("div");
    completed.id = "completed";
    segment.append(completed);
    document.body.append(segment);

    installRuntime().ac("a", "b", "s");

    expect(Array.from(activity.content.childNodes)).toEqual([
      start,
      completed,
      end,
    ]);
    expect(segment.parentNode).toBeNull();
    expect(boundaryPlaceholder.parentNode).toBeNull();
    expect(fallback.parentNode).toBeNull();
    expect(start.data).toBe("fig:suspense:completed");
    expect(calls).toEqual(["retry"]);
  });

  it("completes Activity-hidden boundaries from light DOM after Activity reveal", () => {
    const root = document.createElement("div");
    document.body.append(root);
    const { boundaryPlaceholder, calls, end, fallback, start } =
      createPendingBoundary(root);
    const { after, completed, segment } = appendCompletedSegment(root);

    installRuntime().ac("already-revealed", "b", "s");

    expect(Array.from(root.childNodes)).toEqual([start, completed, end, after]);
    expect(segment.parentNode).toBeNull();
    expect(boundaryPlaceholder.parentNode).toBeNull();
    expect(fallback.parentNode).toBeNull();
    expect(start.data).toBe("fig:suspense:completed");
    expect(calls).toEqual(["retry"]);
  });

  it("marks Activity-hidden client-rendered boundaries inside real template content", () => {
    const activity = document.createElement("template");
    activity.id = "a";
    document.body.append(activity);
    const { boundaryPlaceholder, calls, start } = createPendingBoundary(
      activity.content,
    );

    installRuntime().ax("a", "b", "digest-1", "Server failed");

    expect(start.data).toBe("fig:suspense:client");
    expect(boundaryPlaceholder.dataset.dgst).toBe("digest-1");
    expect(boundaryPlaceholder.dataset.msg).toBe("Server failed");
    expect(calls).toEqual(["retry"]);
  });
});
