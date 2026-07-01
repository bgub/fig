import { Effect } from "effect";
import { createServer, type RequestListener, type Server } from "node:http";
import { StartCloseError, StartListenError } from "./errors.ts";

export type NodeRequestListener = RequestListener;

export interface NodeHttpServerOptions {
  listener: NodeRequestListener;
  port: number;
}

// Node-only listen/close adapter. Keep portable Fig Start rendering in the
// web-standard StartHandler (`Request -> Response`) path so other runtimes can
// supply their own adapter without touching router or RSC code.
export const listenNodeHttpServer = Effect.fn("listenNodeHttpServer")(
  function* (options: NodeHttpServerOptions) {
    return yield* Effect.acquireRelease(
      startNodeHttpServer(options),
      (server) =>
        closeNodeHttpServer(server).pipe(Effect.catch(() => Effect.void)),
    );
  },
);

export function startNodeHttpServer(
  options: NodeHttpServerOptions,
): Effect.Effect<Server, StartListenError> {
  return Effect.callback<Server, StartListenError>((resume) => {
    const server = createServer(options.listener);

    const onError = (cause: Error) => {
      server.off("listening", onListening);
      resume(
        Effect.fail(
          new StartListenError({
            cause,
            port: options.port,
          }),
        ),
      );
    };
    const onListening = () => {
      server.off("error", onError);
      resume(Effect.succeed(server));
    };

    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(options.port);

    return Effect.sync(() => {
      server.off("error", onError);
      server.off("listening", onListening);
      if (server.listening) server.close();
    });
  });
}

export function closeNodeHttpServer(
  server: Server,
): Effect.Effect<void, StartCloseError> {
  return Effect.callback<void, StartCloseError>((resume) => {
    if (!server.listening) {
      resume(Effect.void);
      return;
    }

    server.close((cause) => {
      if (cause === undefined) {
        resume(Effect.void);
        return;
      }

      resume(
        Effect.fail(
          new StartCloseError({
            cause,
          }),
        ),
      );
    });
  });
}
