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
  devtoolsOpenKey,
  devtoolsPaneId,
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
const devtoolsContainer = document.getElementById(devtoolsPaneId);
if (devtoolsContainer === null) {
  throw new Error("Missing payload demo devtools pane.");
}

const devtoolsHook = ensureFigDevtoolsGlobalHook();
createRoot(devtoolsContainer, { devtools: false }).render(
  <FigDevtools
    hook={devtoolsHook}
    placement="sidebar"
    defaultOpen={readStoredDevtoolsOpen()}
    onOpenChange={storeDevtoolsOpen}
  />,
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

function readStoredDevtoolsOpen(): boolean {
  try {
    return localStorage.getItem(devtoolsOpenKey) !== "false";
  } catch {
    return true;
  }
}

function storeDevtoolsOpen(open: boolean): void {
  try {
    localStorage.setItem(devtoolsOpenKey, String(open));
  } catch {
    // Private mode: the panel still toggles, it just isn't remembered.
  }
  document.documentElement.toggleAttribute("data-fig-devtools-closed", !open);
}
