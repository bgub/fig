import { hydrateStart } from "@bgub/fig-tanstack-start/client";

if (import.meta.env.DEV) {
  const { ensureFigDevtoolsGlobalHook } = await import("@bgub/fig-devtools");
  ensureFigDevtoolsGlobalHook();
}
await hydrateStart();

if (import.meta.env.DEV) {
  await hydrationFinished();
  const [{ createFigDevtoolsPlugin }, { TanStackDevtoolsCore }] =
    await Promise.all([
      import("@bgub/fig-devtools/tanstack"),
      import("@tanstack/devtools"),
    ]);
  const figDevtoolsPlugin = createFigDevtoolsPlugin({
    banner: "Fig TanStack Start",
  });
  const tanstackDevtools = new TanStackDevtoolsCore({
    plugins: [figDevtoolsPlugin],
  });
  const tanstackDevtoolsHost = document.createElement("div");
  document.body.appendChild(tanstackDevtoolsHost);
  tanstackDevtools.mount(tanstackDevtoolsHost);
}

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
