import { createServer as createHttpServer } from "node:http";
import { fileURLToPath } from "node:url";
import { createServer as createViteServer } from "vite-plus";

const port = Number(process.env.PORT ?? 4310);

const vite = await createViteServer({
  configFile: fileURLToPath(new URL("./vite.config.ts", import.meta.url)),
  appType: "custom",
  server: { middlewareMode: true },
});

async function loadHandler() {
  // Load the SSR entry through Vite so its TS/JSX + source aliases are applied.
  const mod = await vite.ssrLoadModule("/src/entry-server.ts");
  return mod.handler;
}

createHttpServer((req, res) => {
  vite.middlewares(req, res, () => {
    void handlePage(req, res);
  });
}).listen(port, () => {
  console.log(`demo-start-rsc: http://localhost:${port}/`);
});

async function handlePage(req, res) {
  try {
    const handler = await loadHandler();
    const url = `http://${req.headers.host ?? "localhost"}${req.url ?? "/"}`;
    const request = new Request(url, {
      method: req.method ?? "GET",
      headers: toHeaders(req.headers),
    });
    const response = await handler(request);

    if (response.body === null) {
      res.statusCode = response.status;
      response.headers.forEach((value, name) => res.setHeader(name, value));
      res.end();
      return;
    }

    let html = await response.text();
    html = await vite.transformIndexHtml(req.url ?? "/", html);
    res.statusCode = response.status;
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.end(html);
  } catch (error) {
    vite.ssrFixStacktrace?.(error);
    res.statusCode = 500;
    res.setHeader("content-type", "text/plain; charset=utf-8");
    res.end(
      error instanceof Error ? (error.stack ?? error.message) : String(error),
    );
  }
}

function toHeaders(nodeHeaders) {
  const headers = new Headers();
  for (const [name, value] of Object.entries(nodeHeaders)) {
    if (value === undefined) continue;
    if (Array.isArray(value))
      for (const item of value) headers.append(name, item);
    else headers.set(name, value);
  }
  return headers;
}
