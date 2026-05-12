import { watchFile, unwatchFile } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";

const clients = new Set<ServerResponse>();
const reloadScript = String.raw`
(() => {
  if (typeof EventSource !== "function") return;

  const source = new EventSource("/__fig_dev_reload");
  let reloading = false;

  const reloadWhenReady = () => {
    if (reloading) return;
    reloading = true;

    const retry = () => {
      fetch("/favicon.ico", { cache: "no-store" }).then(
        () => location.reload(),
        () => setTimeout(retry, 250),
      );
    };

    retry();
  };

  source.addEventListener("reload", reloadWhenReady);
  source.addEventListener("error", reloadWhenReady);
})();
`;

export function devReloadScript(nonce?: string): string {
  const nonceAttribute =
    nonce === undefined ? "" : ` nonce="${escapeAttribute(nonce)}"`;

  return `<script${nonceAttribute}>${reloadScript}</script>`;
}

export function handleDevReloadRequest(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
): boolean {
  if (url.pathname !== "/__fig_dev_reload") return false;

  response.writeHead(200, {
    "cache-control": "no-store",
    connection: "keep-alive",
    "content-type": "text/event-stream; charset=utf-8",
  });
  response.write("retry: 250\n\n");
  clients.add(response);

  request.on("close", () => {
    clients.delete(response);
  });

  return true;
}

export function watchDevReloadFile(url: URL): void {
  const path = fileURLToPath(url);

  watchFile(path, { interval: 250 }, (current, previous) => {
    if (current.mtimeMs === previous.mtimeMs) return;
    broadcastReload();
  });

  process.once("exit", () => {
    unwatchFile(path);
  });
}

function broadcastReload(): void {
  for (const client of clients) {
    client.write("event: reload\ndata: now\n\n");
  }
}

function escapeAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;");
}
