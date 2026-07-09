interface TreeNode<Node> {
  child: Node | null;
  sibling: Node | null;
}

export function walkFiberForest<Node extends TreeNode<Node>>(
  node: Node | null,
  visitor: (node: Node) => boolean | void,
): void {
  walkFiberTree(node, true, visitor);
}

export function walkFiberSubtree<Node extends TreeNode<Node>>(
  node: Node,
  visitor: (node: Node) => boolean | void,
): void {
  walkFiberTree(node, false, visitor);
}

// The explicit sibling stack bounds a subtree walk even when a detached
// deletion still points at kept siblings through its old fiber links.
function walkFiberTree<Node extends TreeNode<Node>>(
  node: Node | null,
  includeRootSiblings: boolean,
  visitor: (node: Node) => boolean | void,
): void {
  const stack: Node[] = [];
  let cursor = node;

  while (cursor !== null) {
    const shouldDescend = visitor(cursor) !== false && cursor.child !== null;

    if ((includeRootSiblings || cursor !== node) && cursor.sibling !== null) {
      stack.push(cursor.sibling);
    }

    cursor = shouldDescend ? cursor.child : (stack.pop() ?? null);
  }
}
