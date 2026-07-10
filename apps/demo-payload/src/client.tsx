import { createRoot } from "@bgub/fig-dom";
import { ensureFigDevtoolsGlobalHook, FigDevtools } from "@bgub/fig-devtools";
import {
  createPayloadResponse,
  fetchPayload,
  isPayloadRequestCancelled,
} from "@bgub/fig-server/payload";
import {
  AppRefreshButton,
  RefreshButton,
  setAppRefreshHandler,
  setRefreshHandler,
} from "./client-components.tsx";
import {
  appRefreshButtonReferenceId,
  appRootId,
  feedBoundaryId,
  noteBoundaryId,
  refreshButtonReferenceId,
} from "./shared.ts";
import { ErrorShell } from "./shell.tsx";

const rootElement = document.getElementById(appRootId);
if (rootElement === null) {
  throw new Error("Missing payload demo root.");
}
const appRootElement = rootElement;

const devtoolsHook = ensureFigDevtoolsGlobalHook();
const devtoolsContainer = installDemoDevtoolsLayout(appRootElement);
createRoot(devtoolsContainer, { devtools: false }).render(
  <FigDevtools hook={devtoolsHook} placement="sidebar" />,
);

const response = createPayloadResponse({
  resolveClientReference(metadata) {
    if (metadata.id === appRefreshButtonReferenceId) return AppRefreshButton;
    if (metadata.id === refreshButtonReferenceId) return RefreshButton;
    throw new Error(`Unknown client reference "${metadata.id}".`);
  },
});
const root = createRoot(appRootElement);
const initialRequest = new AbortController();
let shellCleared = false;

window.addEventListener("pagehide", () => initialRequest.abort(), {
  once: true,
});
window.addEventListener("beforeunload", () => initialRequest.abort(), {
  once: true,
});

function render(node = response.getRoot()): void {
  if (!shellCleared) {
    appRootElement.textContent = "";
    shellCleared = true;
  }

  root.render(node);
}

function refreshBoundary(boundary: string, seed: number): Promise<void> {
  return fetchPayload(response, `/payload?seed=${seed}`, {
    refreshBoundary: boundary,
  }).then(() => undefined);
}

setRefreshHandler(refreshBoundary);

setAppRefreshHandler(async (seed) => {
  for (const boundary of [feedBoundaryId, noteBoundaryId]) {
    await refreshBoundary(boundary, seed);
  }
});

response.subscribe(() => render());

void fetchPayload(response, "/payload", {
  signal: initialRequest.signal,
}).catch((error: unknown) => {
  if (isPayloadRequestCancelled(error)) return;
  render(<ErrorShell error={error} />);
});

document.body.dataset.figPayloadDemo = "ready";

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
