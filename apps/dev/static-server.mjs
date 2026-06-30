import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";

const DEFAULT_STATIC_PORT = "4173";

export function startStaticServer(options) {
  const root = resolve(options.root);
  const port = Number(options.port ?? DEFAULT_STATIC_PORT);
  const server = createServer((request, response) => {
    void serveStaticRequest(
      root,
      request.method ?? "GET",
      request.url ?? "/",
      response,
    );
  });
  const exitListeners = new Set();
  let stopped = false;

  const emitExit = (code) => {
    if (stopped) return;
    stopped = true;
    for (const listener of exitListeners) listener(code, null);
  };

  server.listen(port, "127.0.0.1", () => {
    options.logger.line(
      "server",
      `Static demo: ${options.publicUrl ?? `http://127.0.0.1:${port}/`}`,
    );
  });
  server.on("close", () => emitExit(0));
  server.on("error", (error) => {
    options.logger.line("server", String(error), process.stderr);
    emitExit(1);
  });

  return {
    onExit(listener) {
      exitListeners.add(listener);
    },
    stop() {
      if (!stopped) server.close();
    },
  };
}

export async function resolveStaticFile(root, url) {
  const pathname = requestPathname(url);
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const relative = decoded === "/" ? "index.html" : decoded.slice(1);
  const file = resolve(root, relative);

  if (!isInsideRoot(root, file)) return null;
  try {
    const info = await stat(file);
    if (info.isFile()) return file;
    if (!info.isDirectory()) return null;

    const index = resolve(file, "index.html");
    return isInsideRoot(root, index) && (await stat(index)).isFile()
      ? index
      : null;
  } catch {
    return null;
  }
}

export function contentTypeFor(path) {
  return (
    {
      ".css": "text/css; charset=utf-8",
      ".html": "text/html; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".json": "application/json; charset=utf-8",
      ".map": "application/json; charset=utf-8",
      ".svg": "image/svg+xml",
    }[extname(path)] ?? "application/octet-stream"
  );
}

async function serveStaticRequest(root, method, url, response) {
  if (method !== "GET" && method !== "HEAD") {
    response.writeHead(405, { "content-type": "text/plain; charset=utf-8" });
    response.end("Method not allowed");
    return;
  }

  const file = await resolveStaticFile(root, url);
  if (file === null) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }

  response.writeHead(200, {
    "cache-control": "no-store",
    "content-type": contentTypeFor(file),
  });
  if (method === "HEAD") {
    response.end();
    return;
  }
  createReadStream(file).pipe(response);
}

function requestPathname(url) {
  try {
    return new URL(url, "http://localhost").pathname;
  } catch {
    return "/";
  }
}

function isInsideRoot(root, file) {
  const normalizedRoot = root.endsWith(sep) ? root : `${root}${sep}`;
  return file === root || file.startsWith(normalizedRoot);
}
