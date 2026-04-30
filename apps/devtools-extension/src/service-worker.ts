import type {
  FigDevtoolsRendererInfo,
  FigDevtoolsRootSnapshot,
} from "@bgub/fig-reconciler";
import {
  applyPageMessage,
  isPageMessage,
  isPanelMessage,
  PanelPortName,
  type WorkerMessage,
} from "./messages.ts";

interface TabState {
  renderers: Map<number, FigDevtoolsRendererInfo>;
  roots: Map<number, FigDevtoolsRootSnapshot>;
}

const tabStates = new Map<number, TabState>();
const tabPorts = new Map<number, Set<chrome.runtime.Port>>();
const portTabs = new WeakMap<chrome.runtime.Port, number>();

chrome.runtime.onMessage.addListener((message, sender) => {
  if (!isPageMessage(message)) return;

  const tabId = sender.tab?.id;
  if (tabId === undefined) return;

  const { renderers, roots } = stateFor(tabId);
  applyPageMessage(renderers, roots, message);
  broadcast(tabId, message);
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== PanelPortName) return;

  port.onMessage.addListener((message) => {
    if (!isPanelMessage(message)) return;

    portTabs.set(port, message.tabId);
    portsFor(message.tabId).add(port);
    port.postMessage(initMessage(stateFor(message.tabId)));
  });

  port.onDisconnect.addListener(() => {
    const tabId = portTabs.get(port);
    if (tabId === undefined) return;

    const ports = tabPorts.get(tabId);
    ports?.delete(port);
    if (ports?.size === 0) tabPorts.delete(tabId);
  });
});

function stateFor(tabId: number): TabState {
  const existing = tabStates.get(tabId);
  if (existing !== undefined) return existing;

  const state: TabState = {
    renderers: new Map(),
    roots: new Map(),
  };
  tabStates.set(tabId, state);
  return state;
}

function portsFor(tabId: number): Set<chrome.runtime.Port> {
  const existing = tabPorts.get(tabId);
  if (existing !== undefined) return existing;

  const ports = new Set<chrome.runtime.Port>();
  tabPorts.set(tabId, ports);
  return ports;
}

function broadcast(tabId: number, message: WorkerMessage): void {
  for (const port of tabPorts.get(tabId) ?? []) {
    port.postMessage(message);
  }
}

function initMessage(state: TabState): WorkerMessage {
  return {
    type: "fig-devtools:init",
    renderers: [...state.renderers],
    roots: [...state.roots.values()],
  };
}
