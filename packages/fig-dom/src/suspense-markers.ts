import {
  SUSPENSE_CLIENT_MARKER,
  SUSPENSE_COMPLETED_MARKER,
  SUSPENSE_END_MARKER,
  SUSPENSE_PENDING_PREFIX,
} from "@bgub/fig/internal";
import type {
  DehydratedSuspenseBoundary,
  DehydratedSuspenseError,
} from "@bgub/fig-reconciler";

// Parsing of the server's Suspense streaming markers (see
// @bgub/fig/internal suspense-protocol) into dehydrated boundaries, plus the
// DOM-range helpers that consume them.

type TextLike = Text | Comment;

interface SuspenseMarker {
  id: string | null;
  status: DehydratedSuspenseBoundary<Element, TextLike>["status"];
}

export function suspenseBoundaryFor(
  node: Element | TextLike,
): DehydratedSuspenseBoundary<Element, TextLike> | null {
  if (!isComment(node)) return null;

  const marker = suspenseMarker(node);
  return marker === null ? null : suspenseBoundary(node, marker);
}

function suspenseBoundary(
  start: TextLike,
  initialMarker: SuspenseMarker,
): DehydratedSuspenseBoundary<Element, TextLike> | null {
  const end = suspenseBoundaryEnd(start);
  if (end === null) return null;
  return {
    end,
    forceClientRender: false,
    id: initialMarker.id,
    start,
    get error() {
      return suspenseBoundaryError(start);
    },
    get status() {
      return suspenseMarker(start)?.status ?? initialMarker.status;
    },
  };
}

function suspenseMarker(node: unknown): SuspenseMarker | null {
  if (!isComment(node)) return null;

  if (node.data === SUSPENSE_COMPLETED_MARKER) {
    return { id: null, status: "completed" };
  }

  if (node.data === SUSPENSE_CLIENT_MARKER) {
    return { id: null, status: "client-rendered" };
  }

  const pending = node.data.startsWith(SUSPENSE_PENDING_PREFIX)
    ? node.data.slice(SUSPENSE_PENDING_PREFIX.length)
    : null;
  if (pending !== null && pending !== "") {
    return { id: pending, status: "pending" };
  }
  return null;
}

function suspenseBoundaryEnd(start: TextLike): TextLike | null {
  let depth = 0;

  for (
    let node = start.nextSibling as Element | TextLike | null;
    node !== null;
    node = node.nextSibling as Element | TextLike | null
  ) {
    if (!isComment(node)) continue;

    if (suspenseMarker(node) !== null) {
      depth += 1;
      continue;
    }

    if (node.data !== SUSPENSE_END_MARKER) continue;
    if (depth === 0) return node;
    depth -= 1;
  }

  return null;
}

function suspenseBoundaryError(
  start: TextLike,
): DehydratedSuspenseError | null {
  const placeholder = start.nextSibling;
  if (!hasDataset(placeholder)) return null;

  return {
    digest: placeholder.dataset.dgst,
    message: placeholder.dataset.msg,
  };
}

// Event-target boundary discovery walks outward from the target instead of
// searching the tree: at each ancestor level, scanning the preceding siblings
// right-to-left, an end marker closes over a boundary that sits entirely
// before the target, so a start marker reached at depth zero is unmatched and
// its range encloses the target. Passing a returned start marker back in
// resumes the search at the next enclosing boundary (needed when a marker has
// no live fiber because it is nested inside an outer dehydrated boundary).
export function enclosingSuspenseBoundaryStart(
  target: unknown,
): TextLike | null {
  if (!isNode(target)) return null;

  for (let node: Node | null = target; node !== null; node = node.parentNode) {
    let depth = 0;

    for (
      let sibling = node.previousSibling;
      sibling !== null;
      sibling = sibling.previousSibling
    ) {
      if (!isComment(sibling)) continue;

      if (sibling.data === SUSPENSE_END_MARKER) {
        depth += 1;
        continue;
      }

      if (suspenseMarker(sibling) === null) continue;
      if (depth === 0) return sibling;
      depth -= 1;
    }
  }

  return null;
}

export function isWithinSuspenseBoundary(
  target: unknown,
  boundary: DehydratedSuspenseBoundary<Element, TextLike>,
): boolean {
  if (!isNode(target)) return false;

  for (
    let node = boundary.start.nextSibling as Element | TextLike | null;
    node !== null && node !== boundary.end;
    node = node.nextSibling as Element | TextLike | null
  ) {
    if (node === target || containsNode(node, target)) return true;
  }

  return false;
}

function containsNode(parent: Element | TextLike, target: Node): boolean {
  // Test hosts lack Node.contains; real DOM nodes get the native check.
  if (typeof parent.contains === "function") return parent.contains(target);

  for (const child of Array.from(parent.childNodes ?? [])) {
    if (child === target || containsNode(child as Element | TextLike, target)) {
      return true;
    }
  }

  return false;
}

export function removeSuspenseBoundaryRange(
  boundary: DehydratedSuspenseBoundary<Element, TextLike>,
): void {
  for (let node: Element | TextLike | null = boundary.start; node !== null; ) {
    const next = node.nextSibling as Element | TextLike | null;
    removeNode(node);
    if (node === boundary.end) return;
    node = next;
  }
}

export function removeNode(node: Element | TextLike): void {
  node.parentNode?.removeChild(node);
}

function isComment(node: unknown): node is Comment {
  return (
    typeof node === "object" &&
    node !== null &&
    "data" in node &&
    "nodeType" in node &&
    node.nodeType === 8
  );
}

function hasDataset(
  node: unknown,
): node is Element & { dataset: DOMStringMap } {
  return typeof node === "object" && node !== null && "dataset" in node;
}

function isNode(value: unknown): value is Node {
  return typeof value === "object" && value !== null && "parentNode" in value;
}
