import type { Server } from "node:http";
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import { Cause, Deferred, Effect, Exit, Runtime } from "effect";
import type { StartHandler, StartHandlerOptions } from "../server.ts";
import { createRequestHandler } from "../server.ts";
import { createClientAssetResolver } from "../server-assets.ts";
import {
  normalizeStartRuntimeConfig,
  type StartRuntimeConfig,
  type StartRuntimeConfigInput,
} from "./config.ts";
import { type StartConfigError, StartListenError } from "./errors.ts";
import { logStartListening } from "./logging.ts";
import {
  awaitServerClose,
  createStartNodeServer,
  serveStartNodeHttp,
} from "./node-http.ts";
import { createStartWebHandler } from "./web-handler.ts";

export type StartRuntimeError = StartConfigError | StartListenError;

export interface StartRuntimeInput {
  config: StartRuntimeConfigInput;
  handlerOptions: Omit<StartHandlerOptions, "clientEntry">;
  log: (message: string) => void;
}

export interface StartNodeRuntimeInput {
  config: StartRuntimeConfigInput;
  createHandler: (
    config: StartRuntimeConfig,
  ) => StartHandler | Promise<StartHandler>;
  log: (message: string) => void;
  server?: Server;
}

export function createBuiltStartHandler(
  config: StartRuntimeConfig,
  handlerOptions: Omit<StartHandlerOptions, "clientEntry">,
): StartHandler {
  return createStartWebHandler({
    cacheClientAssets: config.cacheClientAssets,
    clientAssets: createClientAssetResolver({
      appUrl: config.appUrl.href,
      cache: config.cacheClientAssets,
      clientEntry: config.clientEntry,
    }),
    handler: createRequestHandler({
      ...handlerOptions,
      clientEntry: config.clientEntry,
    }),
  });
}

// Runtime boundary: starts the server program as the Node main fiber and hands
// the caller a Promise for the listening server. NodeRuntime owns SIGINT/SIGTERM
// interruption; the platform HTTP layer owns scoped listen/close.
export function runStartRuntime(input: StartRuntimeInput): Promise<Server> {
  return runStartNodeRuntime({
    config: input.config,
    createHandler: (config) =>
      createBuiltStartHandler(config, input.handlerOptions),
    log: input.log,
  });
}

export function runStartNodeRuntime(
  input: StartNodeRuntimeInput,
): Promise<Server> {
  const started = Deferred.makeUnsafe<Server, StartRuntimeError>();
  const server = input.server ?? createStartNodeServer();

  NodeRuntime.runMain(
    Effect.scoped(
      Effect.gen(function* () {
        const config = yield* normalizeStartRuntimeConfig(input.config);
        const appHandler = yield* Effect.promise(() =>
          Promise.resolve(input.createHandler(config)),
        );
        yield* serveStartNodeHttp({
          handler: appHandler,
          port: config.port,
          server,
        });
        yield* Effect.sync(() => logStartListening(input.log, config));
        yield* Deferred.succeed(started, server);
        yield* awaitServerClose(server);
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
