// Builds a Fig DevTools snapshot from the payload WIRE model — the documented
// public contract (concepts/payload.md) — so the server can prerender the
// panel with the actual component tree instead of empty chrome. Hooks, lanes,
// and fiber ids are client-runtime facts the server cannot know; the client
// replaces this snapshot with the live one after the first real commit.
import type { FigDevtoolsGlobalHook } from "@bgub/fig-reconciler/devtools";
import type {
  FigDevtoolsFiberSnapshot,
  FigDevtoolsRootSnapshot,
} from "@bgub/fig-reconciler/devtools";

interface WireRow {
  id: number;
  tag: string;
  value: unknown;
}

interface WireElement {
  $fig: "element";
  key: string | number | null;
  props: { $fig: "object"; value: Record<string, unknown> } | null;
  type: unknown;
}

type SeedableHook = Pick<FigDevtoolsGlobalHook, "inject" | "onCommitRoot">;

// Reads the stream until the root model row lands, collecting client-reference
// rows for component names along the way, then cancels the tail.
export async function collectPrerenderRows(
  stream: ReadableStream<Uint8Array>,
): Promise<{ clientNames: Map<number, string>; rootModel: unknown } | null> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const clientNames = new Map<number, string>();
  let buffered = "";

  try {
    for (;;) {
      const { done, value } = await reader.read();
      buffered +=
        done && value === undefined
          ? decoder.decode()
          : decoder.decode(value, { stream: !done });

      let newline = buffered.indexOf("\n");
      while (newline !== -1) {
        const line = buffered.slice(0, newline);
        buffered = buffered.slice(newline + 1);
        newline = buffered.indexOf("\n");
        if (line.trim() === "") continue;

        let row: WireRow;
        try {
          row = JSON.parse(line) as WireRow;
        } catch {
          continue;
        }

        if (row.tag === "client") {
          const metadata = row.value as { exportName?: string };
          if (typeof metadata.exportName === "string") {
            clientNames.set(row.id, metadata.exportName);
          }
        }
        if (row.tag === "model" && row.id === 0) {
          return { clientNames, rootModel: row.value };
        }
      }

      if (done) return null;
    }
  } finally {
    // Cancelling a tee branch can settle only when the source closes; do not
    // hold up the caller on it.
    void reader.cancel().catch(() => undefined);
  }
}

export function seedPrerenderedSnapshot(
  hook: SeedableHook,
  rootModel: unknown,
  clientNames: Map<number, string>,
): void {
  let nextId = 2;
  const fiberId = (): number => nextId++;

  const snapshotNode = (
    node: unknown,
    parentId: number,
  ): FigDevtoolsFiberSnapshot[] => {
    if (node === null || node === undefined || typeof node === "boolean") {
      return [];
    }
    if (typeof node === "string" || typeof node === "number") {
      const id = fiberId();
      return [
        fiber(id, parentId, "#text", "text", null, {
          nodeValue: String(node),
        }),
      ];
    }
    if (Array.isArray(node)) {
      return node.flatMap((child) => snapshotNode(child, parentId));
    }
    if (typeof node !== "object") return [];

    const tagged = node as { $fig?: string };
    if (tagged.$fig === "element") {
      const element = node as WireElement;
      const id = fiberId();
      const props = element.props?.value ?? {};
      const { children, ...ownProps } = props;
      const [name, kind] = elementNameAndKind(element.type, clientNames);
      const snapshot = fiber(id, parentId, name, kind, element.key, ownProps);
      snapshot.children = snapshotNode(children, id);
      return [snapshot];
    }
    if (tagged.$fig === "boundary") {
      const boundary = node as { child?: unknown };
      return snapshotNode(boundary.child, parentId);
    }
    // Pending chunks, promises, references: structure below them is not
    // decoded yet — the live client commit fills them in.
    return [];
  };

  const children = snapshotNode(rootModel, 1);
  const tree: FigDevtoolsFiberSnapshot = {
    ...fiber(1, null, "Root", "root", null, {}),
    children,
  };
  const rendererId = hook.inject({
    name: "Fig",
    packageName: "@bgub/fig-reconciler",
  });
  const snapshot: FigDevtoolsRootSnapshot = {
    id: 1,
    rendererId,
    committedAt: 0,
    dataResources: [],
    pendingWork: [],
    suspendedWork: [],
    pingedWork: [],
    expiredWork: [],
    tree,
  };
  hook.onCommitRoot(rendererId, snapshot);
}

function elementNameAndKind(
  type: unknown,
  clientNames: Map<number, string>,
): [string, FigDevtoolsFiberSnapshot["kind"]] {
  if (typeof type === "string") return [type, "host"];
  if (type !== null && typeof type === "object") {
    const tagged = type as { $fig?: string; id?: number };
    if (tagged.$fig === "fragment") return ["Fragment", "fragment"];
    if (tagged.$fig === "suspense") return ["Suspense", "suspense"];
    if (tagged.$fig === "client") {
      return [
        clientNames.get(tagged.id ?? -1) ?? "ClientReference",
        "function",
      ];
    }
    if (typeof tagged.$fig === "string") return [tagged.$fig, "function"];
  }
  return ["Anonymous", "function"];
}

function fiber(
  id: number,
  parentId: number | null,
  name: string,
  kind: FigDevtoolsFiberSnapshot["kind"],
  key: string | number | null,
  props: Record<string, unknown>,
): FigDevtoolsFiberSnapshot {
  return {
    id,
    parentId,
    name,
    kind,
    key,
    index: 0,
    props,
    pendingWork: [],
    childWork: [],
    hooks: [],
    contextDependencies: [],
    children: [],
  };
}
