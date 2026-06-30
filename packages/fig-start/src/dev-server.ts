import { Effect } from "effect";
import type { Server } from "node:http";
import type { StartHandlerOptions } from "./server.ts";
import { createRequestHandler } from "./server.ts";
import { createClientAssetResolver } from "./server-assets.ts";
import { normalizeStartRuntimeConfig } from "./server-runtime/config.ts";
import { startNodeHttpServer } from "./server-runtime/node-http.ts";
import { createStartNodeRequestListener } from "./server-runtime/request-listener.ts";

export interface StartDevServerOptions
  extends Omit<StartHandlerOptions, "clientEntry"> {
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
  return Effect.runPromise(startDevServerEffect(options));
}

const startDevServerEffect = Effect.fn("startDevServer")(function*(
  options: StartDevServerOptions,
) {
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
  const config = yield* normalizeStartRuntimeConfig({
    appUrl,
    cacheClientAssets: false,
    clientEntry,
    env,
    mode: "development",
    port,
    publicUrl,
    root,
  });
  const clientAssets = createClientAssetResolver({
    appUrl: config.appUrl.href,
    cache: config.cacheClientAssets,
    clientEntry: config.clientEntry,
  });
  const handler = createRequestHandler({
    ...handlerOptions,
    clientEntry: config.clientEntry,
  });
  const listener = createStartNodeRequestListener({
    cacheClientAssets: config.cacheClientAssets,
    clientAssets,
    handler,
  });
  const server = yield* startNodeHttpServer({
    listener,
    port: config.port,
  });

  log(`Fig Start dev server: ${config.publicUrl.href}`);
  return server;
});
