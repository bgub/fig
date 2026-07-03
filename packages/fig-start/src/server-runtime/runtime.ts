import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import { Deferred, Effect, Layer } from "effect";
import {
  HttpServer,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/unstable/http";
import { createServer, type Server } from "node:http";
import type { StartHandlerOptions } from "../server.ts";
import type { StartRuntimeConfigInput } from "./config.ts";
import { type StartConfigError, StartListenError } from "./errors.ts";
import {
  StartAppHandler,
  StartConfig,
  StartLogger,
  clientAssetStoreLayer,
  startAppHandlerLayer,
  startConfigLayer,
  startHandlerLayer,
  startLoggerLayer,
} from "./services.ts";

export type StartRuntimeError = StartConfigError | StartListenError;

export interface StartRuntimeLayerInput {
  config: StartRuntimeConfigInput;
  handlerOptions: Omit<StartHandlerOptions, "clientEntry">;
  log: (message: string) => void;
}

export type StartRuntimeLayer = Layer.Layer<
  StartAppHandler | StartConfig | StartLogger,
  StartConfigError
>;

// The one wiring path for both dev and prod servers. Each provideMerge feeds
// everything above it, so config and logger reach every layer in the stack.
export function startRuntimeLayer(
  input: StartRuntimeLayerInput,
): StartRuntimeLayer {
  return startAppHandlerLayer.pipe(
    Layer.provideMerge(clientAssetStoreLayer),
    Layer.provideMerge(startHandlerLayer(input.handlerOptions)),
    Layer.provideMerge(startConfigLayer(input.config)),
    Layer.provideMerge(startLoggerLayer(input.log)),
  );
}

// Bridges each platform request to the web-standard app handler. Handler
// rejections become defects, which the platform converts to 500 responses.
const app = Effect.gen(function* () {
  const handler = yield* StartAppHandler;
  const request = yield* HttpServerRequest.HttpServerRequest;
  const response = yield* Effect.promise(() =>
    handler(webRequestFrom(request)),
  );
  return HttpServerResponse.fromWeb(response);
});

// Bodies are not forwarded (parity with the previous Node adapter); the
// framework's routes only serve GET/HEAD today.
function webRequestFrom(request: HttpServerRequest.HttpServerRequest): Request {
  const host = request.headers.host ?? "localhost";
  return new Request(`http://${host}${request.url}`, {
    headers: request.headers,
    method: request.method,
  });
}

// The platform server owns listen and close: the socket is acquired into the
// layer's scope and released with a graceful, connection-draining shutdown.
// Listen failures are mapped to the public StartListenError.
function nodeServerLayer(
  server: Server,
): Layer.Layer<HttpServer.HttpServer, StartListenError, StartConfig> {
  return Layer.effect(
    HttpServer.HttpServer,
    Effect.gen(function* () {
      const config = yield* StartConfig;
      return yield* NodeHttpServer.make(() => server, {
        port: config.port,
      }).pipe(
        Effect.mapError(
          (error) =>
            new StartListenError({ cause: error.cause, port: config.port }),
        ),
      );
    }),
  );
}

// Runs after the provided layers are built, so the server is already
// listening and serving; this program just announces it and holds the layer
// scope open until a shutdown signal or an external close.
const serveUntilShutdown = Effect.fn("serveUntilShutdown")(function* (
  started: Deferred.Deferred<Server, StartRuntimeError>,
  server: Server,
) {
  const config = yield* StartConfig;
  const logger = yield* StartLogger;

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
  const server = createServer();

  Effect.runFork(
    serveUntilShutdown(started, server).pipe(
      Effect.provide(
        HttpServer.serve(app).pipe(
          Layer.provideMerge(nodeServerLayer(server)),
          Layer.provideMerge(layer),
        ),
      ),
      // The layers have been torn down (socket released); re-raise the signal
      // so the default handler terminates the process as if we never
      // intercepted it. Deferred a tick so piped stdout can flush first.
      Effect.tap((shutdown) =>
        shutdown === "closed"
          ? Effect.void
          : Effect.sync(() => {
              setImmediate(() => process.kill(process.pid, shutdown));
            }),
      ),
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
