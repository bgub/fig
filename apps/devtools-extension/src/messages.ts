import type {
  FigDevtoolsRendererInfo,
  FigDevtoolsRootSnapshot,
} from "@bgub/fig-reconciler";

export const MessageSource = "fig-devtools-extension";
export const PanelPortName = "fig-devtools-panel";

export interface RendererMessage {
  source: typeof MessageSource;
  type: "fig-devtools:renderer";
  rendererId: number;
  renderer: FigDevtoolsRendererInfo;
}

export interface CommitMessage {
  source: typeof MessageSource;
  type: "fig-devtools:commit";
  rendererId: number;
  snapshot: FigDevtoolsRootSnapshot;
}

export interface SubscribeMessage {
  type: "fig-devtools:subscribe";
  tabId: number;
}

export interface InitMessage {
  type: "fig-devtools:init";
  renderers: Array<[number, FigDevtoolsRendererInfo]>;
  roots: FigDevtoolsRootSnapshot[];
}

export interface HookSink {
  renderers: Map<number, FigDevtoolsRendererInfo>;
  onCommitRoot(rendererId: number, snapshot: FigDevtoolsRootSnapshot): void;
}

export type PageMessage = RendererMessage | CommitMessage;
export type PanelMessage = SubscribeMessage;
export type WorkerMessage = InitMessage | RendererMessage | CommitMessage;

export function applyPageMessage(
  renderers: Map<number, FigDevtoolsRendererInfo>,
  roots: Map<number, FigDevtoolsRootSnapshot>,
  message: PageMessage,
): void {
  if (message.type === "fig-devtools:renderer") {
    renderers.set(message.rendererId, message.renderer);
    return;
  }

  roots.set(message.snapshot.id, message.snapshot);
}

export function applyHookMessage(hook: HookSink, message: PageMessage): void {
  if (message.type === "fig-devtools:renderer") {
    hook.renderers.set(message.rendererId, message.renderer);
    return;
  }

  hook.onCommitRoot(message.rendererId, message.snapshot);
}

export function isPageMessage(value: unknown): value is PageMessage {
  if (typeof value !== "object" || value === null) return false;

  const message = value as Partial<PageMessage>;
  return (
    message.source === MessageSource &&
    (message.type === "fig-devtools:renderer" ||
      message.type === "fig-devtools:commit")
  );
}

export function isPanelMessage(value: unknown): value is PanelMessage {
  if (typeof value !== "object" || value === null) return false;

  const message = value as Partial<PanelMessage>;
  return (
    message.type === "fig-devtools:subscribe" &&
    typeof message.tabId === "number"
  );
}

export function isWorkerMessage(value: unknown): value is WorkerMessage {
  if (typeof value !== "object" || value === null) return false;

  const message = value as Partial<WorkerMessage>;
  return message.type === "fig-devtools:init" || isPageMessage(value);
}
