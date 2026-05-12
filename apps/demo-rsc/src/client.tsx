import { createRoot } from "@bgub/fig-dom";
import {
  createRscResponse,
  fetchRsc,
  isRscRequestCancelled,
} from "@bgub/fig-server/rsc";
import { RefreshButton, setRefreshHandler } from "./client-components.tsx";
import { appRootId, refreshButtonReferenceId } from "./shared.ts";
import { ErrorShell } from "./shell.tsx";

const rootElement = document.getElementById(appRootId);
if (rootElement === null) {
  throw new Error("Missing RSC demo root.");
}
const appRootElement = rootElement;

const response = createRscResponse({
  resolveClientReference(metadata) {
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

setRefreshHandler((boundary, seed) =>
  fetchRsc(response, `/rsc?seed=${seed}`, { refreshBoundary: boundary }).then(
    () => undefined,
  ),
);

response.subscribe(() => render());

void fetchRsc(response, "/rsc", { signal: initialRequest.signal }).catch(
  (error: unknown) => {
    if (isRscRequestCancelled(error)) return;
    render(<ErrorShell error={error} />);
  },
);

document.body.dataset.figRscDemo = "ready";
