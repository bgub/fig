import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import { Cause, Deferred, Effect, Exit, Layer, Runtime } from "effect";
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
// Bodies are not forwarded (parity with the previous Node adapter); the
// framework's routes only serve GET/HEAD today.
const app = Effect.gen(function* () {
  const handler = yield* StartAppHandler;
  const request = yield* HttpServerRequest.HttpServerRequest;
  const host = request.headers.host ?? "localhost";
  const response = yield* Effect.promise(() => {
    return handler(
      new Request(`http://${host}${request.url}`, {
        headers: request.headers,
        method: request.method,
      }),
    );
  });
  return HttpServerResponse.fromWeb(response);
});

// Runtime boundary: starts the server program as the Node main fiber and hands
// the caller a Promise for the listening server. NodeRuntime owns SIGINT/SIGTERM
// interruption; the platform HTTP layer owns scoped listen/close.
export function runStartRuntime(layer: StartRuntimeLayer): Promise<Server> {
  const started = Deferred.makeUnsafe<Server, StartRuntimeError>();
  const server = createServer();
  const httpServerLayer: Layer.Layer<
    HttpServer.HttpServer,
    StartListenError,
    StartConfig
  > = Layer.effect(
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

  NodeRuntime.runMain(
    Effect.gen(function* () {
      const config = yield* StartConfig;
      const logger = yield* StartLogger;
      const name =
        config.mode === "development" ? "Fig Start dev server" : "Fig Start";

      yield* logger.info(`${name}: ${config.publicUrl.href}`);
      yield* Deferred.succeed(started, server);
      yield* Effect.callback<void>((resume) => {
        const onClose = (): void => resume(Effect.void);
        server.once("close", onClose);
        return Effect.sync(() => {
          server.off("close", onClose);
        });
      });
    }).pipe(
      Effect.provide(
        HttpServer.serve(app).pipe(
          Layer.provideMerge(httpServerLayer),
          Layer.provideMerge(layer),
        ),
      ),
      Effect.onError((cause) => Deferred.failCause(started, cause)),
    ),
    {
      disableErrorReporting: true,
      // runMain is an app-entrypoint API adapted here for library use: its
      // onExit only terminates the process when a signal was received or the
      // code is non-zero. Signal interrupts take defaultTeardown (exit 130);
      // every other exit — external close, or failures like StartListenError
      // that surface through the returned promise instead — must pass 0 so
      // the caller's process (and test workers) stay alive. Do not "fix"
      // this to defaultTeardown.
      teardown: (exit, onExit) => {
        if (Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)) {
          Runtime.defaultTeardown(exit, onExit);
        } else {
          onExit(0);
        }
      },
    },
  );

  return Effect.runPromise(Deferred.await(started));
}
