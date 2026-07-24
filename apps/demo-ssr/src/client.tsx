import { hydrateRoot } from "@bgub/fig-dom";
import { enableViewTransitions } from "@bgub/fig-dom/view-transitions";
import type { FigDataHydrationEntry } from "@bgub/fig";
import { ensureFigDevtoolsGlobalHook } from "@bgub/fig-devtools";
import { hydrateDevtoolsPanel } from "@bgub/fig-devtools/client";
import {
  readDevtoolsOpen,
  storeDevtoolsOpen,
} from "../../demo-devtools-cookie.ts";
import {
  App,
  type ClientData,
  createClientRequest,
  demoDataResourceScriptId,
  demoDataScriptId,
  demoDevtoolsPaneId,
  demoRootId,
} from "./app.tsx";

enableViewTransitions();

const data = readClientData();
const initialData = readInitialData();
const root = document.getElementById(demoRootId);
if (root === null) {
  throw new Error("Missing streaming demo root.");
}
const devtoolsContainer = document.getElementById(demoDevtoolsPaneId);
if (devtoolsContainer === null) {
  throw new Error("Missing streaming demo devtools pane.");
}

const devtoolsHook = ensureFigDevtoolsGlobalHook();
hydrateDevtoolsPanel(devtoolsContainer, devtoolsHook, {
  defaultOpen: readDevtoolsOpen(document.cookie),
  onOpenChange: storeDevtoolsOpen,
  placement: "sidebar",
});

hydrateRoot(root, <App request={createClientRequest(data)} />, {
  initialData,
  onRecoverableError(error) {
    document.body.dataset.recoverableHydrationError =
      error instanceof Error ? error.message : String(error);
  },
});

document.body.dataset.figHydrated = "true";

function readClientData(): ClientData {
  const script = document.getElementById(demoDataScriptId);
  if (script === null) {
    throw new Error("Missing streaming demo hydration data.");
  }

  return JSON.parse(script.textContent ?? "{}") as ClientData;
}

function readInitialData(): FigDataHydrationEntry[] {
  const script = document.getElementById(demoDataResourceScriptId);
  if (script === null) return [];

  return JSON.parse(script.textContent ?? "[]") as FigDataHydrationEntry[];
}
