import {
  ensureFigDevtoolsGlobalHook,
  installFigDevtools,
} from "@bgub/fig-devtools";
import { hydrateStart } from "@bgub/fig-tanstack-start/client";

ensureFigDevtoolsGlobalHook();
await hydrateStart();
await hydrationFinished();
installFigDevtools({ banner: "Fig TanStack Start", open: false });

function hydrationFinished(): Promise<void> {
  if (document.querySelector("[data-fig-tanstack-start-hydrated]") !== null) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const observer = new MutationObserver(() => {
      if (
        document.querySelector("[data-fig-tanstack-start-hydrated]") === null
      ) {
        return;
      }
      observer.disconnect();
      resolve();
    });
    observer.observe(document.documentElement, {
      attributes: true,
      childList: true,
      subtree: true,
    });
  });
}
