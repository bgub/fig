import { Effect } from "effect";
import { StartConfigError } from "./errors.ts";

export type StartServerMode = "development" | "production";

export interface StartRuntimeConfigInput {
  appUrl: string;
  cacheClientAssets?: boolean;
  clientEntry?: string;
  env?: Record<string, string | undefined>;
  mode?: StartServerMode;
  port?: number;
  publicUrl?: string;
  root?: string;
}

export interface StartRuntimeConfig {
  appUrl: URL;
  cacheClientAssets: boolean;
  clientEntry: string;
  mode: StartServerMode;
  port: number;
  publicUrl: URL;
  root: string;
}

export const normalizeStartRuntimeConfig = Effect.fn(
  "normalizeStartRuntimeConfig",
)(function*(input: StartRuntimeConfigInput) {
  const env = input.env ?? process.env;
  const mode = input.mode ?? modeFromEnv(env.NODE_ENV);
  const port = yield* normalizePort(input.port, env.PORT);
  const publicUrl = yield* normalizeUrl(
    "publicUrl",
    input.publicUrl ?? `http://localhost:${port}/`,
  );
  const appUrl = yield* normalizeUrl("appUrl", input.appUrl);

  return {
    appUrl,
    cacheClientAssets: input.cacheClientAssets ?? mode === "production",
    clientEntry: input.clientEntry ?? "/client.js",
    mode,
    port,
    publicUrl,
    root: input.root ?? process.cwd(),
  };
});

function modeFromEnv(nodeEnv: string | undefined): StartServerMode {
  return nodeEnv === "production" ? "production" : "development";
}

function normalizePort(
  explicit: number | undefined,
  envPort: string | undefined,
): Effect.Effect<number, StartConfigError> {
  if (explicit !== undefined) return validatePort("port", explicit);
  if (envPort === undefined || envPort.trim() === "") {
    return Effect.succeed(3000);
  }

  const parsed = Number(envPort);
  return validatePort("PORT", parsed);
}

function validatePort(
  field: string,
  port: number,
): Effect.Effect<number, StartConfigError> {
  return Number.isInteger(port) && port > 0 && port <= 65_535
    ? Effect.succeed(port)
    : Effect.fail(
        new StartConfigError({
          field,
          message: "Expected an integer port between 1 and 65535.",
        }),
      );
}

function normalizeUrl(
  field: string,
  value: string,
): Effect.Effect<URL, StartConfigError> {
  return Effect.try({
    try: () => new URL(value),
    catch: () =>
      new StartConfigError({
        field,
        message: "Expected an absolute URL.",
      }),
  });
}
