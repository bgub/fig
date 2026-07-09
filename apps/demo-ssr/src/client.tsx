import "./dev-env.ts";
import { createRoot, hydrateRoot } from "@bgub/fig-dom";
import type { FigDataHydrationEntry } from "@bgub/fig";
import { ensureFigDevtoolsGlobalHook, FigDevtools } from "@bgub/fig-devtools";
import {
  App,
  type ClientData,
  createClientRequest,
  demoDataResourceScriptId,
  demoDataScriptId,
  demoRootId,
} from "./app.tsx";
import { installTemplateBrowserBenchmark } from "./template-benchmark.tsx";

const data = readClientData();
const initialData = readInitialData();
const root = document.getElementById(demoRootId);
if (root === null) {
  throw new Error("Missing streaming demo root.");
}

const devtoolsHook = ensureFigDevtoolsGlobalHook();
const devtoolsContainer = installDemoDevtoolsLayout(root);
createRoot(devtoolsContainer, { devtools: false }).render(
  <FigDevtools hook={devtoolsHook} placement="sidebar" />,
);

hydrateRoot(root, <App request={createClientRequest(data)} />, {
  initialData,
  onRecoverableError(error) {
    document.body.dataset.recoverableHydrationError =
      error instanceof Error ? error.message : String(error);
  },
});

document.body.dataset.figHydrated = "true";
installTemplateBrowserBenchmark();

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

function installDemoDevtoolsLayout(appRoot: HTMLElement): HTMLElement {
  const layout = document.createElement("div");
  const appPane = document.createElement("div");
  const devtoolsPane = document.createElement("aside");

  layout.className = "fig-demo-devtools-layout";
  appPane.className = "fig-demo-app-pane";
  devtoolsPane.className = "fig-demo-devtools-pane";
  appRoot.replaceWith(layout);
  appPane.appendChild(appRoot);
  layout.append(appPane, devtoolsPane);
  return devtoolsPane;
}
