import type { StartRuntimeConfig } from "./config.ts";

export function logStartListening(
  log: (message: string) => void,
  config: StartRuntimeConfig,
): void {
  const name =
    config.mode === "development" ? "Fig Start dev server" : "Fig Start";
  log(`${name}: ${config.publicUrl.href}`);
}
