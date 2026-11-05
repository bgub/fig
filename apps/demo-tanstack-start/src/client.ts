import { hydrateStart } from "@bgub/fig-tanstack-start/client";
import {
  figDevtoolsPaneId,
  followDocumentTheme,
  waitForFirstFigCommit,
} from "./devtools.ts";

if (import.meta.env.DEV) {
  const { ensureFigDevtoolsGlobalHook } = await import("@bgub/fig-devtools");
  ensureFigDevtoolsGlobalHook();
}
await hydrateStart();
if (import.meta.env.DEV) {
  const { ensureFigDevtoolsGlobalHook, mountFigDevtoolsPanel } =
    await import("@bgub/fig-devtools");
  const hook = ensureFigDevtoolsGlobalHook();
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
}
