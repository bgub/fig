import { ensureFigDevtoolsGlobalHook } from "@bgub/fig-devtools";
import { createFigDevtoolsPlugin } from "@bgub/fig-devtools/tanstack";
import { hydrateStart } from "@bgub/fig-tanstack-start/client";
import { TanStackDevtoolsCore } from "@tanstack/devtools";

ensureFigDevtoolsGlobalHook();
await hydrateStart();
await hydrationFinished();

const figDevtoolsPlugin = createFigDevtoolsPlugin({
  banner: "Fig TanStack Start",
});
const tanstackDevtools = new TanStackDevtoolsCore({
  plugins: [figDevtoolsPlugin],
});
const tanstackDevtoolsHost = document.createElement("div");
document.body.appendChild(tanstackDevtoolsHost);
tanstackDevtools.mount(tanstackDevtoolsHost);

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
