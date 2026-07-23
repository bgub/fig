// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import type { MetadataSnapshotEntry } from "./asset-registry.ts";
import {
  earlyEventCaptureMarkup,
  serverRuntimeCodeFor,
  writeRuntime,
} from "./protocol.ts";

interface TestRuntime {
  ac(
    activityId: string,
    boundaryId: string,
    segmentId: string,
    metadata?: MetadataSnapshotEntry[],
  ): void;
  ax(
    activityId: string,
    boundaryId: string,
    digest: string,
    message: string,
  ): void;
  c(
    boundaryId: string,
    segmentId: string,
    metadata?: MetadataSnapshotEntry[],
  ): void;
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
    document.head.replaceChildren();
    document.body.replaceChildren();
    delete (document as unknown as { startViewTransition?: unknown })
      .startViewTransition;
    delete (document as unknown as { __figViewTransition?: unknown })
      .__figViewTransition;
  });

  it("marks the server-only early-event bootstrap for hydration", () => {
    expect(earlyEventCaptureMarkup({ nonce: "nonce-1" })).toMatch(
      /^<script data-fig-hydration-skip="" nonce="nonce-1">/,
    );
  });

  it("marks the server-only streaming runtime for hydration", () => {
    let html = "";

    writeRuntime(
      {
        identifierPrefix: "",
        nonce: "nonce-1",
        runtimeName: "__figSSR",
        runtimeWritten: false,
      },
      (chunk) => {
        html += chunk;
      },
    );

    expect(html).toMatch(
      /^<script data-fig-hydration-skip="" nonce="nonce-1">/,
    );
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

  it("updates streamed metadata in the same unhydrated boundary reveal", () => {
    const root = document.createElement("div");
    document.body.append(root);
    const { start } = createPendingBoundary(root);
    delete start.__figRetry;
    appendCompletedSegment(root);
    const stale = document.createElement("meta");
    stale.setAttribute("name", "obsolete");
    stale.setAttribute("data-fig-streamed-metadata", "meta:name:obsolete");
    document.head.append(stale);

    installRuntime().c("b", "s", [
      ["title", "title", "Invoices"],
      [
        "meta:name:description",
        "meta",
        [
          ["name", "description"],
          ["content", "Invoice list"],
        ],
      ],
    ]);

    expect(document.head.querySelector("title")?.textContent).toBe("Invoices");
    expect(
      document.head
        .querySelector('meta[name="description"]')
        ?.getAttribute("content"),
    ).toBe("Invoice list");
    expect(document.head.querySelector('meta[name="obsolete"]')).toBeNull();
  });

  it("leaves metadata to the renderer when the boundary is hydrated", () => {
    const root = document.createElement("div");
    document.body.append(root);
    const { calls } = createPendingBoundary(root);
    appendCompletedSegment(root);
    const titleElement = document.createElement("title");
    titleElement.setAttribute("data-fig-streamed-metadata", "title");
    titleElement.textContent = "Current client title";
    document.head.append(titleElement);

    installRuntime().c("b", "s", [["title", "title", "Server title"]]);

    expect(titleElement.textContent).toBe("Current client title");
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

  it("wraps annotated boundary completions in a view transition", async () => {
    const root = document.createElement("div");
    document.body.append(root);
    const { fallback } = createPendingBoundary(root);
    fallback.setAttribute("data-fig-vt-name", "card");
    fallback.setAttribute("data-fig-vt-class", "fade");
    const { completed, segment } = appendCompletedSegment(root);
    completed.setAttribute("data-fig-vt-name", "card");
    completed.setAttribute("data-fig-vt-class", "fade");
    const snapshots: string[] = [];
    const viewTransitionDocument = document as unknown as {
      startViewTransition?: (update: () => void) => {
        finished: Promise<unknown>;
        ready: Promise<unknown>;
      };
    };

    viewTransitionDocument.startViewTransition = (update) => {
      snapshots.push(viewTransitionStyle(fallback).viewTransitionName ?? "");
      snapshots.push(viewTransitionStyle(fallback).viewTransitionClass ?? "");
      update();
      snapshots.push(viewTransitionStyle(completed).viewTransitionName ?? "");
      snapshots.push(viewTransitionStyle(completed).viewTransitionClass ?? "");
      return { finished: Promise.resolve(), ready: Promise.resolve() };
    };

    installRuntime().c("b", "s");

    expect(segment.parentNode).toBeNull();
    expect(snapshots).toEqual(["card", "fade", "card", "fade"]);
    await Promise.resolve();
    expect(viewTransitionStyle(fallback).viewTransitionName).toBe("");
    expect(viewTransitionStyle(completed).viewTransitionName).toBe("");
  });

  it("chains annotated reveals on a pending view transition", async () => {
    const root = document.createElement("div");
    document.body.append(root);
    const { fallback } = createPendingBoundary(root);
    fallback.setAttribute("data-fig-vt-name", "card");
    const { completed, segment } = appendCompletedSegment(root);
    completed.setAttribute("data-fig-vt-name", "card");
    let started = 0;
    let releasePending: () => void = () => undefined;
    const pendingFinished = new Promise<void>((resolve) => {
      releasePending = resolve;
    });
    const viewTransitionDocument = document as unknown as {
      __figViewTransition?: unknown;
      startViewTransition?: (update: () => void) => {
        finished: Promise<unknown>;
        ready: Promise<unknown>;
      };
    };

    viewTransitionDocument.startViewTransition = (update) => {
      started += 1;
      update();
      return { finished: Promise.resolve(), ready: Promise.resolve() };
    };
    // A transition is already running (e.g. a client commit): the reveal must
    // wait for it instead of starting a transition that would skip it. The
    // owner releases the mutex on finished, like fig-dom's host does.
    viewTransitionDocument.__figViewTransition = { finished: pendingFinished };
    void pendingFinished.then(() => {
      viewTransitionDocument.__figViewTransition = null;
    });

    installRuntime().c("b", "s");

    expect(started).toBe(0);
    expect(segment.parentNode).not.toBeNull();

    releasePending();
    await pendingFinished;
    await Promise.resolve();

    expect(started).toBe(1);
    expect(segment.parentNode).toBeNull();
  });

  it("registers the reveal transition as the document mutex", async () => {
    const root = document.createElement("div");
    document.body.append(root);
    const { fallback } = createPendingBoundary(root);
    fallback.setAttribute("data-fig-vt-name", "card");
    const { completed } = appendCompletedSegment(root);
    completed.setAttribute("data-fig-vt-name", "card");
    let releaseFinished: () => void = () => undefined;
    const finished = new Promise<void>((resolve) => {
      releaseFinished = resolve;
    });
    const transition = { finished, ready: Promise.resolve() };
    const viewTransitionDocument = document as unknown as {
      __figViewTransition?: unknown;
      startViewTransition?: (update: () => void) => typeof transition;
    };

    viewTransitionDocument.startViewTransition = (update) => {
      update();
      return transition;
    };

    installRuntime().c("b", "s");

    expect(viewTransitionDocument.__figViewTransition).toBe(transition);

    releaseFinished();
    await finished;
    await Promise.resolve();

    expect(viewTransitionDocument.__figViewTransition).toBeNull();
  });

  it("retries hydration after async view transition cleanup", async () => {
    const root = document.createElement("div");
    document.body.append(root);
    const { calls, fallback } = createPendingBoundary(root);
    fallback.setAttribute("data-fig-vt-name", "card");
    fallback.setAttribute("data-fig-vt-class", "fade");
    const { completed } = appendCompletedSegment(root);
    completed.setAttribute("data-fig-vt-name", "card");
    completed.setAttribute("data-fig-vt-class", "fade");
    let resolveReady!: () => void;
    const ready = new Promise<void>((resolve) => {
      resolveReady = resolve;
    });
    const viewTransitionDocument = document as unknown as {
      startViewTransition?: (update: () => void) => {
        finished: Promise<unknown>;
        ready: Promise<unknown>;
      };
    };

    calls.length = 0;
    (root.firstChild as RetriableComment).__figRetry = () => {
      queueMicrotask(() => {
        calls.push(viewTransitionStyle(completed).viewTransitionName ?? "");
      });
    };

    viewTransitionDocument.startViewTransition = (update) => {
      queueMicrotask(update);
      return { finished: ready, ready };
    };

    installRuntime().c("b", "s");
    expect(calls).toEqual([]);

    await Promise.resolve();
    expect(viewTransitionStyle(completed).viewTransitionName).toBe("card");
    await Promise.resolve();
    expect(calls).toEqual([]);

    resolveReady();
    await ready;
    await Promise.resolve();
    await Promise.resolve();
    expect(viewTransitionStyle(completed).viewTransitionName).toBe("");
    expect(completed.hasAttribute("style")).toBe(false);
    expect(calls).toEqual([""]);
  });

  it("waits for finished when ready rejects before the update callback", async () => {
    const root = document.createElement("div");
    document.body.append(root);
    const { calls, fallback } = createPendingBoundary(root);
    fallback.setAttribute("data-fig-vt-name", "card");
    fallback.setAttribute("data-fig-vt-class", "fade");
    const { completed } = appendCompletedSegment(root);
    completed.setAttribute("data-fig-vt-name", "card");
    completed.setAttribute("data-fig-vt-class", "fade");
    let resolveFinished!: () => void;
    const finished = new Promise<void>((resolve) => {
      resolveFinished = resolve;
    });
    const viewTransitionDocument = document as unknown as {
      startViewTransition?: (update: () => void) => {
        finished: Promise<unknown>;
        ready: Promise<unknown>;
      };
    };

    calls.length = 0;
    (root.firstChild as RetriableComment).__figRetry = () => {
      queueMicrotask(() => {
        calls.push(viewTransitionStyle(completed).viewTransitionName ?? "");
      });
    };

    viewTransitionDocument.startViewTransition = (update) => {
      setTimeout(update, 0);
      return {
        finished,
        ready: Promise.reject(new Error("Transition was skipped")),
      };
    };

    installRuntime().c("b", "s");
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(viewTransitionStyle(completed).viewTransitionName).toBe("card");
    await Promise.resolve();
    expect(calls).toEqual([]);

    resolveFinished();
    await finished;
    await Promise.resolve();
    await Promise.resolve();
    expect(viewTransitionStyle(completed).viewTransitionName).toBe("");
    expect(completed.hasAttribute("style")).toBe(false);
    expect(calls).toEqual([""]);
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

function viewTransitionStyle(element: HTMLElement): CSSStyleDeclaration & {
  viewTransitionClass?: string;
  viewTransitionName?: string;
} {
  return element.style;
}
