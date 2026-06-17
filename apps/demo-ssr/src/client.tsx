import "./dev-env.ts";
import { createRoot, hydrateRoot } from "@bgub/fig-dom";
import { ensureFigDevtoolsGlobalHook, FigDevtools } from "@bgub/fig-devtools";
import {
  App,
  type ClientData,
  createClientRequest,
  demoDataScriptId,
  demoRootId,
} from "./app.tsx";

const data = readClientData();
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
