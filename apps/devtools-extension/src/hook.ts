import type {
  FigDevtoolsGlobalHook,
  FigDevtoolsRendererInfo,
  FigDevtoolsRootSnapshot,
} from "@bgub/fig-reconciler";
import type { CommitMessage, RendererMessage } from "./messages.ts";

const HookKey = "__FIG_DEVTOOLS_GLOBAL_HOOK__";
const PatchedKey = "__FIG_DEVTOOLS_EXTENSION_PATCHED__";
const MessageSource = "fig-devtools-extension";

type WindowWithHook = Window &
  typeof globalThis & {
    [HookKey]?: unknown;
    [PatchedKey]?: boolean;
  };

interface HookWithState extends FigDevtoolsGlobalHook {
  renderers?: Map<number, FigDevtoolsRendererInfo>;
  roots?: Map<number, FigDevtoolsRootSnapshot>;
}

type PageMessagePayload =
  | Omit<RendererMessage, "source">
  | Omit<CommitMessage, "source">;

const target = window as WindowWithHook;
installHook(target);

function installHook(global: WindowWithHook): void {
  const existing = global[HookKey];

  if (isHook(existing)) {
    patchHook(global, existing);
    flushExistingState(existing);
    return;
  }

  const hook = createHook();
  global[HookKey] = hook;
}

function createHook(): HookWithState {
  const renderers = new Map<number, FigDevtoolsRendererInfo>();
  const roots = new Map<number, FigDevtoolsRootSnapshot>();
  let nextRendererId = 1;

  return {
    renderers,
    roots,
    inject(renderer) {
      const rendererId = nextRendererId;
      nextRendererId += 1;
      renderers.set(rendererId, renderer);
      postRenderer(rendererId, renderer);
      return rendererId;
    },
    onCommitRoot(rendererId, snapshot) {
      roots.set(snapshot.id, snapshot);
      postCommit(rendererId, snapshot);
    },
  };
}

function patchHook(global: WindowWithHook, hook: FigDevtoolsGlobalHook): void {
  if (global[PatchedKey] === true) return;
  global[PatchedKey] = true;

  const inject = hook.inject.bind(hook);
  const onCommitRoot = hook.onCommitRoot.bind(hook);

  hook.inject = (renderer) => {
    const rendererId = inject(renderer);
    postRenderer(rendererId, renderer);
    return rendererId;
  };

  hook.onCommitRoot = (rendererId, snapshot) => {
    onCommitRoot(rendererId, snapshot);
    postCommit(rendererId, snapshot);
  };
}

function flushExistingState(hook: HookWithState): void {
  if (hook.renderers instanceof Map) {
    for (const [rendererId, renderer] of hook.renderers) {
      postRenderer(rendererId, renderer);
    }
  }

  if (hook.roots instanceof Map) {
    for (const snapshot of hook.roots.values()) {
      postCommit(snapshot.rendererId, snapshot);
    }
  }
}

function postRenderer(
  rendererId: number,
  renderer: FigDevtoolsRendererInfo,
): void {
  post({ type: "fig-devtools:renderer", rendererId, renderer });
}

function postCommit(
  rendererId: number,
  snapshot: FigDevtoolsRootSnapshot,
): void {
  post({
    type: "fig-devtools:commit",
    rendererId,
    snapshot: sanitizeSnapshot(snapshot),
  });
}

function post(payload: PageMessagePayload): void {
  window.postMessage({ source: MessageSource, ...payload }, "*");
}

function sanitizeSnapshot(
  snapshot: FigDevtoolsRootSnapshot,
): FigDevtoolsRootSnapshot {
  const seen = new WeakSet<object>();
  return JSON.parse(
    JSON.stringify(snapshot, (_key, value) => sanitizeValue(value, seen)),
  );
}

function sanitizeValue(value: unknown, seen: WeakSet<object>): unknown {
  if (typeof value === "function")
    return `[Function ${value.name || "anonymous"}]`;
  if (typeof value === "symbol") return String(value);
  if (typeof value === "bigint") return `${String(value)}n`;
  if (value instanceof Node) return `<${value.nodeName.toLowerCase()}>`;
  if (typeof value === "object" && value !== null) {
    if (seen.has(value)) return "[Circular]";
    seen.add(value);
  }
  return value;
}

function isHook(value: unknown): value is HookWithState {
  if (typeof value !== "object" || value === null) return false;

  const candidate = value as Partial<FigDevtoolsGlobalHook>;
  return (
    typeof candidate.inject === "function" &&
    typeof candidate.onCommitRoot === "function"
  );
}
