import { Deferred, Effect, Layer } from "effect";
import type { Server } from "node:http";
import type { StartHandlerOptions } from "../server.ts";
import type { StartRuntimeConfigInput } from "./config.ts";
import type { StartConfigError, StartListenError } from "./errors.ts";
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
} from "./services.ts";

export type StartRuntimeError = StartConfigError | StartListenError;

export interface StartRuntimeLayerInput {
  config: StartRuntimeConfigInput;
  handlerOptions: Omit<StartHandlerOptions, "clientEntry">;
  log: (message: string) => void;
}

export type StartRuntimeLayer = Layer.Layer<
  NodeHttpServer | StartConfig | StartLogger,
  StartConfigError
>;

// The one wiring path for both dev and prod servers: config and logger feed
// the handler, which feeds the asset store, listener, and http server.
export function startRuntimeLayer(
  input: StartRuntimeLayerInput,
): StartRuntimeLayer {
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

// The server's whole lifetime is one scoped program: the listening socket is
// acquired into the scope, and leaving it — a shutdown signal or the server
// being closed out from under us — releases it with a graceful close.
const serveUntilShutdown = Effect.fn("serveUntilShutdown")(function* (
  started: Deferred.Deferred<Server, StartRuntimeError>,
) {
  const config = yield* StartConfig;
  const logger = yield* StartLogger;
  const nodeServer = yield* NodeHttpServer;
  const server = yield* nodeServer.listen();

  const name =
    config.mode === "development" ? "Fig Start dev server" : "Fig Start";
  yield* logger.info(`${name}: ${config.publicUrl.href}`);
  yield* Deferred.succeed(started, server);

  const shutdown = yield* Effect.race(
    awaitShutdownSignal,
    Effect.as(awaitServerClose(server), "closed" as const),
  );
  if (shutdown !== "closed") {
    yield* logger.info(`Received ${shutdown}; shutting down.`);
  }
  return shutdown;
});

// Runtime boundary: forks the server program as a daemon fiber and hands the
// caller a Promise for the listening server. Failures reject with the typed
// error instance (StartConfigError / StartListenError): runPromise squashes
// the Cause down to its first failure.
export function runStartRuntime(layer: StartRuntimeLayer): Promise<Server> {
  const started = Deferred.makeUnsafe<Server, StartRuntimeError>();

  Effect.runFork(
    Effect.scoped(serveUntilShutdown(started)).pipe(
      // The scope has closed (socket released); re-raise the signal so the
      // default handler terminates the process as if we never intercepted it.
      // Deferred a tick so piped stdout (the shutdown log) can flush first.
      Effect.tap((shutdown) =>
        shutdown === "closed"
          ? Effect.void
          : Effect.sync(() => {
              setImmediate(() => process.kill(process.pid, shutdown));
            }),
      ),
      Effect.provide(layer),
      Effect.onError((cause) => Deferred.failCause(started, cause)),
    ),
  );

  return Effect.runPromise(Deferred.await(started));
}

const shutdownSignals: readonly NodeJS.Signals[] = ["SIGINT", "SIGTERM"];

const awaitShutdownSignal: Effect.Effect<NodeJS.Signals> = Effect.callback(
  (resume) => {
    const listeners = shutdownSignals.map((signal) => {
      const listener = (): void => resume(Effect.succeed(signal));
      process.once(signal, listener);
      return [signal, listener] as const;
    });
    return Effect.sync(() => {
      for (const [signal, listener] of listeners) {
        process.off(signal, listener);
      }
    });
  },
);

function awaitServerClose(server: Server): Effect.Effect<void> {
  return Effect.callback((resume) => {
    const onClose = (): void => resume(Effect.void);
    server.once("close", onClose);
    return Effect.sync(() => {
      server.off("close", onClose);
    });
  });
}
