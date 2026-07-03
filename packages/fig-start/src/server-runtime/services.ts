import { Context, Effect, Layer, type Scope } from "effect";
import type { Server } from "node:http";
import type { ClientAssetResolver } from "../server-assets.ts";
import type { StartHandler, StartHandlerOptions } from "../server.ts";
import { createRequestHandler } from "../server.ts";
import { createClientAssetResolver } from "../server-assets.ts";
import {
  type StartRuntimeConfig,
  type StartRuntimeConfigInput,
  normalizeStartRuntimeConfig,
} from "./config.ts";
import type { StartConfigError, StartListenError } from "./errors.ts";
import { listenNodeHttpServer } from "./node-http.ts";
import {
  type StartNodeRequestListener,
  createStartNodeRequestListener,
} from "./request-listener.ts";

export class StartConfig extends Context.Service<
  StartConfig,
  StartRuntimeConfig
>()("StartConfig") {}

export class StartLogger extends Context.Service<
  StartLogger,
  {
    readonly info: (message: string) => Effect.Effect<void>;
  }
>()("StartLogger") {}

export class StartHandlerService extends Context.Service<
  StartHandlerService,
  StartHandler
>()("StartHandler") {}

export class ClientAssetStore extends Context.Service<
  ClientAssetStore,
  ClientAssetResolver
>()("ClientAssetStore") {}

export class StartRequestListener extends Context.Service<
  StartRequestListener,
  StartNodeRequestListener
>()("StartRequestListener") {}

export class NodeHttpServer extends Context.Service<
  NodeHttpServer,
  {
    // Scoped: the listening socket is released (graceful close) when the
    // enclosing scope closes.
    readonly listen: () => Effect.Effect<Server, StartListenError, Scope.Scope>;
  }
>()("NodeHttpServer") {}

export function startConfigLayer(
  input: StartRuntimeConfigInput,
): Layer.Layer<StartConfig, StartConfigError> {
  return Layer.effect(StartConfig, normalizeStartRuntimeConfig(input));
}

export function startLoggerLayer(
  log: (message: string) => void,
): Layer.Layer<StartLogger> {
  return Layer.succeed(StartLogger, {
    info: Effect.fn("StartLogger.info")((message: string) =>
      Effect.sync(() => log(message)),
    ),
  });
}

export function startHandlerLayer(
  options: Omit<StartHandlerOptions, "clientEntry">,
): Layer.Layer<StartHandlerService, never, StartConfig> {
  return Layer.effect(
    StartHandlerService,
    Effect.gen(function* () {
      const config = yield* StartConfig;
      return createRequestHandler({
        ...options,
        clientEntry: config.clientEntry,
      });
    }),
  );
}

export const clientAssetStoreLayer: Layer.Layer<
  ClientAssetStore,
  never,
  StartConfig
> = Layer.effect(
  ClientAssetStore,
  Effect.gen(function* () {
    const config = yield* StartConfig;
    return createClientAssetResolver({
      appUrl: config.appUrl.href,
      cache: config.cacheClientAssets,
      clientEntry: config.clientEntry,
    });
  }),
);

export const startRequestListenerLayer: Layer.Layer<
  StartRequestListener,
  never,
  ClientAssetStore | StartConfig | StartHandlerService
> = Layer.effect(
  StartRequestListener,
  Effect.gen(function* () {
    const clientAssets = yield* ClientAssetStore;
    const config = yield* StartConfig;
    const handler = yield* StartHandlerService;
    return createStartNodeRequestListener({
      cacheClientAssets: config.cacheClientAssets,
      clientAssets,
      handler,
    });
  }),
);

export const nodeHttpServerLayer: Layer.Layer<
  NodeHttpServer,
  never,
  StartConfig | StartRequestListener
> = Layer.effect(
  NodeHttpServer,
  Effect.gen(function* () {
    const config = yield* StartConfig;
    const listener = yield* StartRequestListener;
    return {
      listen: Effect.fn("NodeHttpServer.listen")(function* () {
        return yield* listenNodeHttpServer({
          listener,
          port: config.port,
        });
      }),
    };
  }),
);
