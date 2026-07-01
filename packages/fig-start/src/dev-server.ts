import { Effect, Layer } from "effect";
import type { Server } from "node:http";
import type { StartHandlerOptions } from "./server.ts";
import {
  NodeHttpServer,
  StartConfig,
  StartLogger,
  clientAssetStoreLayer,
  nodeHttpServerLayer,
  startConfigLayer,
  startHandlerLayer,
  startLoggerLayer,
  startRequestListenerLayer,
} from "./server-runtime/services.ts";

export interface StartDevServerOptions extends Omit<
  StartHandlerOptions,
  "clientEntry"
> {
  appUrl: string;
  clientEntry?: string;
  env?: Record<string, string | undefined>;
  log?: (message: string) => void;
  port?: number;
  publicUrl?: string;
  root?: string;
}

export function startDevServer(
  options: StartDevServerOptions,
): Promise<Server> {
  const {
    appUrl,
    clientEntry,
    env,
    log = console.log,
    port,
    publicUrl,
    root,
    ...handlerOptions
  } = options;
  const layer = devServerLayer({
    config: {
      appUrl,
      cacheClientAssets: false,
      clientEntry,
      env,
      mode: "development",
      port,
      publicUrl,
      root,
    },
    handlerOptions,
    log,
  });

  return Effect.runPromise(startDevServerEffect().pipe(Effect.provide(layer)));
}

const startDevServerEffect = Effect.fn("startDevServer")(function* () {
  const config = yield* StartConfig;
  const logger = yield* StartLogger;
  const nodeServer = yield* NodeHttpServer;
  const server = yield* nodeServer.start();

  yield* logger.info(`Fig Start dev server: ${config.publicUrl.href}`);
  return server;
});

interface DevServerLayerInput {
  config: Parameters<typeof startConfigLayer>[0];
  handlerOptions: Omit<StartHandlerOptions, "clientEntry">;
  log: (message: string) => void;
}

function devServerLayer(input: DevServerLayerInput) {
  const baseLayer = Layer.mergeAll(
    startConfigLayer(input.config),
    startLoggerLayer(input.log),
  );
  const handlerLayer = startHandlerLayer(input.handlerOptions).pipe(
    Layer.provideMerge(baseLayer),
  );
  const assetLayer = clientAssetStoreLayer.pipe(
    Layer.provideMerge(handlerLayer),
  );
  const listenerLayer = startRequestListenerLayer.pipe(
    Layer.provideMerge(assetLayer),
  );

  return nodeHttpServerLayer.pipe(Layer.provideMerge(listenerLayer));
}
