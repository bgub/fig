import { hydrateRoot } from "@bgub/fig-dom";
import { ensureFigDevtoolsGlobalHook } from "@bgub/fig-devtools";
import { createPayloadResponse, fetchPayload } from "@bgub/fig-server/payload";
import { hydrateDevtoolsPanel } from "../../demo-devtools-client.ts";
import {
  AppRefreshButton,
  RefreshButton,
  setAppRefreshHandler,
  setRefreshHandler,
} from "./client-components.tsx";
import {
  appRefreshButtonReferenceId,
  appRootId,
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

hydrateDevtoolsPanel(devtoolsContainer, devtoolsHook);
