import { hydrateRoot } from "@bgub/fig-dom";
import { ensureFigDevtoolsGlobalHook } from "@bgub/fig-devtools";
import {
  createPayloadConsumer,
  getPayloadFrameStream,
} from "@bgub/fig-server/payload";
import { hydrateDevtoolsPanel } from "@bgub/fig-devtools/client";
import {
  readDevtoolsOpen,
  storeDevtoolsOpen,
} from "../../demo-devtools-cookie.ts";
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

const consumer = createPayloadConsumer({
  resolveClientReference(metadata) {
    if (metadata.id === appRefreshButtonReferenceId) return AppRefreshButton;
    if (metadata.id === refreshButtonReferenceId) return RefreshButton;
    throw new Error(`Unknown client reference "${metadata.id}".`);
  },
});

// The document inlined the payload rows it was rendered from as frame
// scripts; replaying them into the consumer reconstructs the exact tree the
// server turned into HTML, so hydration adopts the streamed markup.
getPayloadFrameStream<string>().s((frame) =>
  consumer.processStringChunk(frame),
);

function refreshBoundary(boundary: string, seed: number): Promise<void> {
  return consumer
    .fetch(`/payload?seed=${seed}`, { refreshBoundary: boundary })
    .then(() => undefined);
}

setRefreshHandler(refreshBoundary);

setAppRefreshHandler(async (seed) => {
  for (const boundary of [feedBoundaryId, noteBoundaryId]) {
    await refreshBoundary(boundary, seed);
  }
});

const devtoolsHook = ensureFigDevtoolsGlobalHook();

void consumer.rootReady.then(() => {
  const root = hydrateRoot(rootElement, consumer.getRoot());
  consumer.subscribe(() => root.render(consumer.getRoot()));
  document.body.dataset.figPayloadDemo = "ready";
});

hydrateDevtoolsPanel(devtoolsContainer, devtoolsHook, {
  defaultOpen: readDevtoolsOpen(document.cookie),
  onOpenChange: storeDevtoolsOpen,
  placement: "sidebar",
});
