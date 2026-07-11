import { createRoot, hydrateRoot } from "@bgub/fig-dom";
import { ensureFigDevtoolsGlobalHook, FigDevtools } from "@bgub/fig-devtools";
import { createPayloadResponse, fetchPayload } from "@bgub/fig-server/payload";
import {
  AppRefreshButton,
  RefreshButton,
  setAppRefreshHandler,
  setRefreshHandler,
} from "./client-components.tsx";
import {
  appRefreshButtonReferenceId,
  appRootId,
  devtoolsOpenCookie,
  devtoolsPaneId,
  feedBoundaryId,
  noteBoundaryId,
  payloadFramesGlobal,
  type PayloadFramesGlobal,
  refreshButtonReferenceId,
} from "./shared.ts";

const rootElement = document.getElementById(appRootId);
if (rootElement === null) {
  throw new Error("Missing payload demo root.");
}
const devtoolsContainer = document.getElementById(devtoolsPaneId);
if (devtoolsContainer === null) {
  throw new Error("Missing payload demo devtools pane.");
}

const response = createPayloadResponse({
  resolveClientReference(metadata) {
    if (metadata.id === appRefreshButtonReferenceId) return AppRefreshButton;
    if (metadata.id === refreshButtonReferenceId) return RefreshButton;
    throw new Error(`Unknown client reference "${metadata.id}".`);
  },
});

// The document inlined the payload rows it was rendered from as frame
// scripts; replaying them into the response reconstructs the exact tree the
// server turned into HTML, so hydration adopts the streamed markup.
const frames = (globalThis as Record<string, unknown>)[
  payloadFramesGlobal
] as PayloadFramesGlobal;
frames.s((frame) => response.processStringChunk(frame));

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

const devtoolsHook = ensureFigDevtoolsGlobalHook();

void response.rootReady.then(() => {
  const root = hydrateRoot(rootElement, response.getRoot());
  response.subscribe(() => root.render(response.getRoot()));
  document.body.dataset.figPayloadDemo = "ready";
});

// The server prerendered the panel from the payload model (structure only —
// no hooks or fiber ids). Swap in the live panel once the first real commit
// gives the hook actual data; the replacement paints near-identical pixels.
const unsubscribeDevtoolsSwap = devtoolsHook.subscribe(() => {
  if (devtoolsHook.commits.length === 0) return;
  unsubscribeDevtoolsSwap();
  devtoolsContainer.textContent = "";
  createRoot(devtoolsContainer, { devtools: false }).render(
    <FigDevtools
      defaultOpen={readDevtoolsOpenCookie()}
      hook={devtoolsHook}
      onOpenChange={storeDevtoolsOpenCookie}
      placement="sidebar"
    />,
  );
});

function readDevtoolsOpenCookie(): boolean {
  return !document.cookie
    .split(";")
    .some((entry) => entry.trim() === `${devtoolsOpenCookie}=false`);
}

function storeDevtoolsOpenCookie(open: boolean): void {
  document.cookie = `${devtoolsOpenCookie}=${String(open)};path=/;max-age=31536000;samesite=lax`;
}
