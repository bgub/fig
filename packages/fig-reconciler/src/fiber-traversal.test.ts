import { describe, expect, it } from "vitest";
import { walkFiberForest, walkFiberSubtree } from "./fiber-traversal.ts";

interface Node {
  child: Node | null;
  name: string;
  sibling: Node | null;
}

function node(name: string, child: Node | null = null): Node {
  return { child, name, sibling: null };
}

describe("fiber traversal", () => {
  it("walks a forest in depth-first order", () => {
    const nested = node("nested");
    const first = node("first", nested);
    const second = node("second");
    first.sibling = second;
    const visited: string[] = [];

    walkFiberForest(first, (current) => {
      visited.push(current.name);
    });

    expect(visited).toEqual(["first", "nested", "second"]);
  });

  it("keeps subtree walks inside the root", () => {
    const child = node("child");
    const root = node("root", child);
    root.sibling = node("outside");
    const visited: string[] = [];

    walkFiberSubtree(root, (current) => {
      visited.push(current.name);
    });

    expect(visited).toEqual(["root", "child"]);
  });

  it("prunes children when the visitor returns false", () => {
    const root = node("root", node("child"));
    const visited: string[] = [];

    walkFiberSubtree(root, (current) => {
      visited.push(current.name);
      return false;
    });

    expect(visited).toEqual(["root"]);
  });
});
