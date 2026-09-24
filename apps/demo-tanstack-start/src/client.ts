import {
  ensureFigDevtoolsGlobalHook,
  mountFigDevtoolsPanel,
} from "@bgub/fig-devtools";
import { hydrateStart } from "@bgub/fig-tanstack-start/client";
import {
  figDevtoolsPaneId,
  followDocumentTheme,
  waitForFirstFigCommit,
} from "./devtools.ts";

const hook = ensureFigDevtoolsGlobalHook();
await hydrateStart();
await waitForFirstFigCommit(hook);

const target = document.getElementById(figDevtoolsPaneId);
if (!(target instanceof HTMLElement)) {
  throw new Error("Missing Fig DevTools sidebar.");
}

const devtools = mountFigDevtoolsPanel({
  banner: "Fig TanStack Start",
  hook,
  overlayTarget: document.body,
  placement: "sidebar",
  target,
});
const stopFollowingTheme = followDocumentTheme(devtools);

import.meta.hot?.dispose(() => {
  stopFollowingTheme();
  devtools.uninstall();
});
