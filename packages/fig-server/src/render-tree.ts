// Optional render-tree collection: a caller-owned collector the renderer
// fills with the component structure as it renders, one node per element or
// text child. The collector is readable at any point — a subtree rendered
// later in document order (a DevTools panel in an aside, for example) sees
// everything rendered before it, so prerendering introspection UI needs no
// second pass. Suspended content attaches under its boundary when the task
// resumes; content still pending when the collector is read simply is not
// there yet.
export type RenderTreeKind =
  | "activity"
  | "assets"
  | "client-reference"
  | "context-provider"
  | "error-boundary"
  | "fragment"
  | "function"
  | "host"
  | "root"
  | "suspense"
  | "text"
  | "view-transition";

export interface RenderTreeNode {
  children: RenderTreeNode[];
  key: string | number | null;
  kind: RenderTreeKind;
  name: string;
  props: Record<string, unknown>;
}

export interface RenderTreeCollector {
  readonly tree: RenderTreeNode;
}

export function createRenderTreeCollector(): RenderTreeCollector {
  return {
    tree: {
      children: [],
      key: null,
      kind: "root",
      name: "Root",
      props: {},
    },
  };
}
