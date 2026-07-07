import { fileURLToPath } from "node:url";
import { startViteDevServer } from "@bgub/fig-start/dev-server";

void startViteDevServer({
  port: Number(process.env.PORT ?? 3000),
  publicUrl: "https://fig-demo-start.localhost/",
  root: fileURLToPath(new URL("..", import.meta.url)),
  tailwind: true,
});
