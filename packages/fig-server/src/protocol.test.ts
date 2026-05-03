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

describe("server streaming protocol", () => {
  it("replaces the full Suspense marker range when completing a boundary", () => {
    const document = new TestDocument();
    const globalScope: {
      __figSSR?: { c(boundaryId: string, segmentId: string): void };
    } = {};

    const root = new TestNode(elementNode, "root");
    const start = new TestNode(commentNode, null, "fig:suspense:pending:0");
    const boundaryPlaceholder = document.register(
      new TestNode(elementNode, "b"),
    );
    const fallback = new TestNode(elementNode, "fallback");
    const end = new TestNode(commentNode, null, "/fig:suspense");
    const after = new TestNode(elementNode, "after");
    const segment = document.register(new TestNode(elementNode, "s"));
    const completed = new TestNode(elementNode, "completed");

    root.appendChild(start);
    root.appendChild(boundaryPlaceholder);
    root.appendChild(fallback);
    root.appendChild(end);
    root.appendChild(after);
    root.appendChild(segment);
    segment.appendChild(completed);

    new Function("document", "globalThis", serverRuntimeCode)(
      document,
      globalScope,
    );
    globalScope.__figSSR?.c("b", "s");

    expect(root.childNodes).toEqual([completed, after]);
    expect(segment.parentNode).toBeNull();
    expect(start.parentNode).toBeNull();
    expect(boundaryPlaceholder.parentNode).toBeNull();
    expect(fallback.parentNode).toBeNull();
    expect(end.parentNode).toBeNull();
  });
});
