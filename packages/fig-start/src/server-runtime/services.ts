import { Context, Effect, Layer } from "effect";
import type { ClientAssetResolver } from "../server-assets.ts";
import type { StartHandler, StartHandlerOptions } from "../server.ts";
import { createRequestHandler } from "../server.ts";
import { createClientAssetResolver } from "../server-assets.ts";
import {
  type StartRuntimeConfig,
  type StartRuntimeConfigInput,
  normalizeStartRuntimeConfig,
} from "./config.ts";
import type { StartConfigError } from "./errors.ts";
import { createStartWebHandler } from "./web-handler.ts";

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

// The route handler wrapped with built-client-asset serving: the complete
// web-standard app that a server adapter hosts.
export class StartAppHandler extends Context.Service<
  StartAppHandler,
  StartHandler
>()("StartAppHandler") {}

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

export const startAppHandlerLayer: Layer.Layer<
  StartAppHandler,
  never,
  ClientAssetStore | StartConfig | StartHandlerService
> = Layer.effect(
  StartAppHandler,
  Effect.gen(function* () {
    const clientAssets = yield* ClientAssetStore;
    const config = yield* StartConfig;
    const handler = yield* StartHandlerService;
    return createStartWebHandler({
      cacheClientAssets: config.cacheClientAssets,
      clientAssets,
      handler,
    });
  }),
);
