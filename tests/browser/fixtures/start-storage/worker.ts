/// <reference lib="webworker" />
import {
  getStartContext,
  runWithStartContext,
} from "../../../../packages/fig-tanstack-start/src/storage-context.ts";

declare const self: ServiceWorkerGlobalScope;
self.addEventListener("install", (event) =>
  event.waitUntil(self.skipWaiting()),
);
self.addEventListener("activate", (event) =>
  event.waitUntil(self.clients.claim()),
);
// Like Todos-2, hold the single-slot adapter through consumption of the body.
let rendering = Promise.resolve();
self.addEventListener("fetch", (event) => {
  const id = new URL(event.request.url).searchParams.get("id");
  const run = () =>
    runWithStartContext({ id }, async () => {
      const response = new Response(
        new ReadableStream({
          async start(controller) {
            await new Promise((resolve) => setTimeout(resolve, 10));
            controller.enqueue(
              new TextEncoder().encode(JSON.stringify(getStartContext())),
            );
            controller.close();
          },
        }),
      );
      return new Response(await response.text());
    });
  const next = rendering.then(run, run);
  rendering = next.then(
    () => undefined,
    () => undefined,
  );
  event.respondWith(next);
});
