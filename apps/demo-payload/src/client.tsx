import { ensureFigDevtoolsGlobalHook, FigDevtools } from "@bgub/fig-devtools";
import { createRoot } from "@bgub/fig-dom";
import {
  readDevtoolsOpen,
  storeDevtoolsOpen,
} from "../../demo-devtools-cookie.ts";
import { mountResourceApp } from "./resource-client.tsx";
import { resourceRootId } from "./resource-shared.ts";

const rootElement = document.getElementById(resourceRootId);
if (rootElement === null) {
  throw new Error("Missing serialized-components demo root.");
}

const devtoolsHook = ensureFigDevtoolsGlobalHook();
const devtoolsContainer = installDemoDevtoolsLayout(rootElement);

createRoot(devtoolsContainer, { devtools: false }).render(
  <FigDevtools
    hook={devtoolsHook}
    placement="sidebar"
    defaultOpen={readDevtoolsOpen(document.cookie)}
    onOpenChange={storeDevtoolsOpen}
  />,
);
mountResourceApp(rootElement);

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
