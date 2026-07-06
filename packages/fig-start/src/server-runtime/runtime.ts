import { createServer, type Server } from "node:http";
import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import { Cause, Deferred, Effect, Exit, Runtime } from "effect";
import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http";
import type { StartHandlerOptions } from "../server.ts";
import { createRequestHandler } from "../server.ts";
import { createClientAssetResolver } from "../server-assets.ts";
import {
  normalizeStartRuntimeConfig,
  type StartRuntimeConfigInput,
} from "./config.ts";
import { type StartConfigError, StartListenError } from "./errors.ts";
import { createStartWebHandler } from "./web-handler.ts";

export type StartRuntimeError = StartConfigError | StartListenError;

export interface StartRuntimeInput {
  config: StartRuntimeConfigInput;
  handlerOptions: Omit<StartHandlerOptions, "clientEntry">;
  log: (message: string) => void;
}

function requestCanHaveBody(method: string): boolean {
  return method !== "GET" && method !== "HEAD";
}

// Runtime boundary: starts the server program as the Node main fiber and hands
// the caller a Promise for the listening server. NodeRuntime owns SIGINT/SIGTERM
// interruption; the platform HTTP layer owns scoped listen/close.
export function runStartRuntime(input: StartRuntimeInput): Promise<Server> {
  const started = Deferred.makeUnsafe<Server, StartRuntimeError>();
  const server = createServer();

  NodeRuntime.runMain(
    Effect.scoped(
      Effect.gen(function* () {
        const config = yield* normalizeStartRuntimeConfig(input.config);
        const appHandler = createStartWebHandler({
          cacheClientAssets: config.cacheClientAssets,
          clientAssets: createClientAssetResolver({
            appUrl: config.appUrl.href,
            cache: config.cacheClientAssets,
            clientEntry: config.clientEntry,
          }),
          handler: createRequestHandler({
            ...input.handlerOptions,
            clientEntry: config.clientEntry,
          }),
        });
        const httpServer = yield* NodeHttpServer.make(() => server, {
          port: config.port,
        }).pipe(
          Effect.mapError(
            (error) =>
              new StartListenError({ cause: error.cause, port: config.port }),
          ),
        );

        yield* httpServer.serve(
          Effect.gen(function* () {
            const request = yield* HttpServerRequest.HttpServerRequest;
            const host = request.headers.host ?? "localhost";
            const body = requestCanHaveBody(request.method)
              ? yield* request.arrayBuffer
              : undefined;
            const response = yield* Effect.promise(() => {
              return appHandler(
                new Request(`http://${host}${request.url}`, {
                  body,
                  headers: request.headers,
                  method: request.method,
                }),
              );
            });
            return HttpServerResponse.fromWeb(response);
          }),
        );

        const name =
          config.mode === "development" ? "Fig Start dev server" : "Fig Start";

        yield* Effect.sync(() =>
          input.log(`${name}: ${config.publicUrl.href}`),
        );
        yield* Deferred.succeed(started, server);
        yield* Effect.callback<void>((resume) => {
          const onClose = (): void => resume(Effect.void);
          server.once("close", onClose);
          return Effect.sync(() => {
            server.off("close", onClose);
          });
        });
      }),
    ).pipe(Effect.onError((cause) => Deferred.failCause(started, cause))),
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
