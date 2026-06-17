import {
  createFigDevtoolsGlobalHook,
  type FigDevtoolsHook,
  mountFigDevtoolsPanel,
} from "@bgub/fig-devtools";
import {
  applyHookMessage,
  type InitMessage,
  isWorkerMessage,
  PanelPortName,
} from "./messages.ts";

const root = document.getElementById("root");
if (root === null) throw new Error("Could not find #root.");

const hook = createFigDevtoolsGlobalHook();
mountFigDevtoolsPanel({
  hook,
  target: root,
  placement: "panel",
});

const port = chrome.runtime.connect({ name: PanelPortName });
port.postMessage({
  type: "fig-devtools:subscribe",
  tabId: chrome.devtools.inspectedWindow.tabId,
});
port.onMessage.addListener((message) => {
  if (!isWorkerMessage(message)) return;

  if (message.type === "fig-devtools:init") {
    applyInitMessage(hook, message);
    return;
  }

  applyHookMessage(hook, message);
});

function applyInitMessage(hook: FigDevtoolsHook, message: InitMessage): void {
  hook.renderers.clear();
  hook.roots.clear();
  hook.clear();

  for (const [rendererId, renderer] of message.renderers) {
    hook.renderers.set(rendererId, renderer);
  }

  for (const snapshot of message.roots) {
    hook.onCommitRoot(snapshot.rendererId, snapshot);
  }
}
