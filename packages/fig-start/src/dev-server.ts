import type { Server } from "node:http";
import type { StartHandlerOptions } from "./server.ts";
import {
  runStartRuntime,
  startRuntimeLayer,
} from "./server-runtime/runtime.ts";

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

// Rejects with StartConfigError / StartListenError on bad config or a failed
// listen. The listening socket is scoped: SIGINT/SIGTERM close it gracefully
// before the process terminates.
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

  return runStartRuntime(
    startRuntimeLayer({
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
    }),
  );
}
