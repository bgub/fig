import { describe, expect, it } from "vitest";
import { serverRuntimeCode } from "./protocol.ts";

const elementNode = 1;
const commentNode = 8;

class TestNode {
  childNodes: TestNode[] = [];
  parentNode: TestNode | null = null;
  dataset: Record<string, string> = {};

  constructor(
    readonly nodeType: number,
    readonly id: string | null = null,
    readonly data: string = "",
  ) {}

  get firstChild(): TestNode | null {
    return this.childNodes[0] ?? null;
  }

  get nextSibling(): TestNode | null {
    if (this.parentNode === null) return null;
    const index = this.parentNode.childNodes.indexOf(this);
    return this.parentNode.childNodes[index + 1] ?? null;
  }

  get previousSibling(): TestNode | null {
    if (this.parentNode === null) return null;
    const index = this.parentNode.childNodes.indexOf(this);
    return index <= 0 ? null : this.parentNode.childNodes[index - 1];
  }

  appendChild(node: TestNode): void {
    node.remove();
    node.parentNode = this;
    this.childNodes.push(node);
  }

  insertBefore(node: TestNode, reference: TestNode): void {
    node.remove();
    const index = this.childNodes.indexOf(reference);
    if (index === -1) throw new Error("Reference node is not a child.");
    node.parentNode = this;
    this.childNodes.splice(index, 0, node);
  }

  remove(): void {
    if (this.parentNode === null) return;
    const siblings = this.parentNode.childNodes;
    const index = siblings.indexOf(this);
    if (index !== -1) siblings.splice(index, 1);
    this.parentNode = null;
  }
}

class TestDocument {
  private readonly nodesById = new Map<string, TestNode>();

  getElementById(id: string): TestNode | null {
    return this.nodesById.get(id) ?? null;
  }

  register(node: TestNode): TestNode {
    if (node.id !== null) this.nodesById.set(node.id, node);
    return node;
  }
}

interface TestRuntime {
  c(boundaryId: string, segmentId: string): void;
  x(boundaryId: string, digest: string, message: string): void;
}

type RetriableTestNode = TestNode & { __figRetry?: () => void };

function installRuntime(document: TestDocument): TestRuntime {
  const globalScope: { __figSSR?: TestRuntime } = {};

  new Function("document", "globalThis", serverRuntimeCode)(
    document,
    globalScope,
  );

  if (globalScope.__figSSR === undefined) {
    throw new Error("Expected server runtime.");
  }

  return globalScope.__figSSR;
}

function createPendingBoundary(document: TestDocument): {
  boundaryPlaceholder: TestNode;
  calls: string[];
  end: TestNode;
  fallback: TestNode;
  root: TestNode;
  start: RetriableTestNode;
} {
  const calls: string[] = [];
  const root = new TestNode(elementNode, "root");
  const start = new TestNode(
    commentNode,
    null,
    "fig:suspense:pending:0",
  ) as RetriableTestNode;
  const boundaryPlaceholder = document.register(new TestNode(elementNode, "b"));
  const fallback = new TestNode(elementNode, "fallback");
  const end = new TestNode(commentNode, null, "/fig:suspense");

  start.__figRetry = () => calls.push("retry");
  root.appendChild(start);
  root.appendChild(boundaryPlaceholder);
  root.appendChild(fallback);
  root.appendChild(end);

  return { boundaryPlaceholder, calls, end, fallback, root, start };
}

function appendCompletedSegment(
  document: TestDocument,
  root: TestNode,
): { after: TestNode; completed: TestNode; segment: TestNode } {
  const after = new TestNode(elementNode, "after");
  const segment = document.register(new TestNode(elementNode, "s"));
  const completed = new TestNode(elementNode, "completed");

  root.appendChild(after);
  root.appendChild(segment);
  segment.appendChild(completed);

  return { after, completed, segment };
}

describe("server streaming protocol", () => {
  it("replaces fallback content and preserves Suspense markers when completing a boundary", () => {
    const document = new TestDocument();
    const { boundaryPlaceholder, calls, end, fallback, root, start } =
      createPendingBoundary(document);
    const { after, completed, segment } = appendCompletedSegment(
      document,
      root,
    );

    installRuntime(document).c("b", "s");

    expect(root.childNodes).toEqual([start, completed, end, after]);
    expect(segment.parentNode).toBeNull();
    expect(start.data).toBe("fig:suspense:completed");
    expect(start.parentNode).toBe(root);
    expect(boundaryPlaceholder.parentNode).toBeNull();
    expect(fallback.parentNode).toBeNull();
    expect(end.parentNode).toBe(root);
    expect(calls).toEqual(["retry"]);
  });

  it("removes nested fallback Suspense ranges when completing a boundary", () => {
    const document = new TestDocument();
    const { boundaryPlaceholder, calls, end, fallback, root, start } =
      createPendingBoundary(document);
    const innerStart = new TestNode(
      commentNode,
      null,
      "fig:suspense:pending:1",
    );
    const innerEnd = new TestNode(commentNode, null, "/fig:suspense");
    const innerPlaceholder = document.register(new TestNode(elementNode, "ib"));

    root.insertBefore(innerStart, fallback);
    root.insertBefore(innerPlaceholder, fallback);
    root.insertBefore(innerEnd, end);
    const { after, completed, segment } = appendCompletedSegment(
      document,
      root,
    );

    installRuntime(document).c("b", "s");

    expect(root.childNodes).toEqual([start, completed, end, after]);
    expect(segment.parentNode).toBeNull();
    expect(boundaryPlaceholder.parentNode).toBeNull();
    expect(start.data).toBe("fig:suspense:completed");
    expect(calls).toEqual(["retry"]);
  });

  it("marks client-rendered boundaries and retries hydrated parents", () => {
    const document = new TestDocument();
    const { boundaryPlaceholder, calls, start } =
      createPendingBoundary(document);

    installRuntime(document).x("b", "digest-1", "Server failed");

    expect(start.data).toBe("fig:suspense:client");
    expect(boundaryPlaceholder.dataset).toEqual({
      dgst: "digest-1",
      msg: "Server failed",
    });
    expect(calls).toEqual(["retry"]);
  });
});
