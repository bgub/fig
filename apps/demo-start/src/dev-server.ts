import { startDevServer } from "@bgub/fig-start/dev-server";
import { start } from "./start.tsx";

const {
  appName,
  onRecoverableError: _onRecoverableError,
  ...serverOptions
} = start;

void startDevServer({
  ...serverOptions,
  appUrl: new URL("./server.js", import.meta.url).href,
  context: () => ({ appName }),
  port: Number(process.env.PORT ?? 3000),
  publicUrl: "https://fig-demo-start.localhost/",
});
