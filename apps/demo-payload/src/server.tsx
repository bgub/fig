import { readFile } from "node:fs/promises";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { FigNode } from "@bgub/fig";
import { renderToPayloadStream } from "@bgub/fig-server/payload";
import {
  devReloadScript,
  handleDevReloadRequest,
  watchDevReloadFile,
} from "../../dev-reload.ts";
import {
  Dashboard,
  ResourcePost,
  resourceComments,
  WeatherReport,
  type WeatherReading,
} from "./resource-app.tsx";
import { brokenResourceSeed, resourceRootId } from "./resource-shared.ts";
import { styles } from "./styles.ts";

// The standalone serialized-components demo (docs/concepts/payload.md):
// no framework, no boundaries, no refresh protocol — one route serving a payload
// stream, one client consuming it as an ordinary data resource.

const port = Number(process.env.PORT ?? 5174);
const e2eGatesEnabled = process.env.FIG_PAYLOAD_DEMO_E2E === "1";
const payloadDelayScale =
  Number(process.env.FIG_PAYLOAD_DEMO_DELAY_SCALE ?? "1") || 1;
const clientScriptUrl = new URL("../dist/client.js", import.meta.url);
const noStore = { "cache-control": "no-store" } as const;
const textCss = { ...noStore, "content-type": "text/css; charset=utf-8" };
const textJs = {
  ...noStore,
  "content-type": "text/javascript; charset=utf-8",
};
const textPlain = { "content-type": "text/plain; charset=utf-8" };
const textHtml = {
  ...noStore,
  "content-type": "text/html; charset=utf-8",
};

watchDevReloadFile(clientScriptUrl);

createServer((request, response) => {
  void handleRequest(request, response).catch((error: unknown) => {
    if (response.headersSent) {
      response.end();
      return;
    }

    response.writeHead(500, textPlain);
    response.end(error instanceof Error ? error.message : String(error));
  });
}).listen(port, "127.0.0.1", () => {
  console.log(`Fig payload demo: ${publicUrl()}`);
});

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const url = requestUrl(request);
  if (handleDevReloadRequest(request, response, url)) return;

  switch (url.pathname) {
    case "/":
      send(response, 200, resourceDocument, textHtml);
      return;
    case "/dashboard-payload":
      await sendDashboardPayload(response);
      return;
    case "/client.js":
      await sendFile(response, clientScriptUrl, textJs);
      return;
    case "/favicon.ico":
      response.writeHead(204);
      response.end();
      return;
    case "/fig-e2e/release":
      releaseE2eGate(response, url);
      return;
    case "/resource-payload":
      await sendResourcePayload(response, url);
      return;
    case "/style.css":
      send(response, 200, styles, textCss);
      return;
    case "/weather-payload":
      await sendWeatherPayload(response);
      return;
    default:
      send(response, 404, "Not found", textPlain);
  }
}

// Each payload route gets its own deliberate delay so the template's layers
// visibly fill in sequence: app shell instantly, the dashboard frame first,
// then the post, then the weather, then the streamed comments hole.
const DASHBOARD_PAYLOAD_DELAY_MS = 300;
const POST_PAYLOAD_DELAY_MS = 600;
const WEATHER_PAYLOAD_DELAY_MS = 900;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// The surrounding server component's endpoint: it streams the dashboard
// frame with the slot components serialized as client references, so
// refreshing it never re-requests the slots' own streams.
let dashboardRenders = 0;

async function sendDashboardPayload(response: ServerResponse): Promise<void> {
  await delay(scaledPayloadDelay(DASHBOARD_PAYLOAD_DELAY_MS));
  await sendPayload(response, <Dashboard render={++dashboardRenders} />);
}

// The post's endpoint: a plain payload stream per post. The client refreshes
// it with refreshData and navigates by resource key. Seed 500 fails so the
// demo covers pre-root failure and recovery.
async function sendResourcePayload(
  response: ServerResponse,
  url: URL,
): Promise<void> {
  const seed = seedFor(url);
  await delay(scaledPayloadDelay(POST_PAYLOAD_DELAY_MS));
  if (seed === brokenResourceSeed) {
    send(response, 500, "Resource payload unavailable", textPlain);
    return;
  }

  await sendPayload(
    response,
    <ResourcePost comments={commentsForRequest(seed, url)} seed={seed} />,
  );
}

// The weather slot's endpoint: an independent payload stream, so the client
// holds several serialized resources and refreshes them separately. The
// reading is random per render; the counter is what refreshes assert on.
let weatherReadings = 0;
const weatherConditions = ["sunny", "partly cloudy", "rainy", "windy"];

async function sendWeatherPayload(response: ServerResponse): Promise<void> {
  await delay(scaledPayloadDelay(WEATHER_PAYLOAD_DELAY_MS));
  const weather: WeatherReading = {
    condition:
      weatherConditions[Math.floor(Math.random() * weatherConditions.length)],
    reading: ++weatherReadings,
    temperatureC: Math.round(4 + Math.random() * 26),
  };

  await sendPayload(response, <WeatherReport weather={weather} />);
}

function scaledPayloadDelay(ms: number): number {
  return Math.max(1, Math.round(ms * payloadDelayScale));
}

const e2eGateWaiters = new Map<string, () => void>();
const releasedE2eGates = new Set<string>();

function commentsForRequest(seed: number, url: URL): Promise<string[]> {
  const gate = e2eGatesEnabled
    ? url.searchParams.get("fig-e2e-comments-gate")
    : null;
  if (gate === null) return resourceComments(seed);

  return waitForE2eGate(gate).then(() => [
    `First comment ${seed}`,
    `Second comment ${seed}`,
  ]);
}

function waitForE2eGate(gate: string): Promise<void> {
  if (releasedE2eGates.delete(gate)) return Promise.resolve();

  return new Promise((resolve, reject) => {
    if (e2eGateWaiters.has(gate)) {
      reject(new Error(`Duplicate e2e payload gate: ${gate}`));
      return;
    }
    e2eGateWaiters.set(gate, () => resolve());
  });
}

function releaseE2eGate(response: ServerResponse, url: URL): void {
  if (!e2eGatesEnabled) {
    send(response, 404, "Not found", textPlain);
    return;
  }

  const gate = url.searchParams.get("gate");
  if (gate === null) {
    send(response, 400, "Missing gate", textPlain);
    return;
  }

  const resolve = e2eGateWaiters.get(gate);
  if (resolve === undefined) {
    releasedE2eGates.add(gate);
  } else {
    e2eGateWaiters.delete(gate);
    resolve();
  }

  response.writeHead(204, noStore);
  response.end();
}

async function sendPayload(
  response: ServerResponse,
  node: FigNode,
): Promise<void> {
  const result = renderToPayloadStream(node, {
    onError() {
      return { digest: "resource-payload" };
    },
  });

  response.writeHead(200, {
    ...noStore,
    "content-type": result.contentType,
    "x-accel-buffering": "no",
  });
  await pipeStream(result.stream, response);
}

const resourceDocument =
  '<!doctype html><html lang="en"><head>' +
  '<meta charset="utf-8" />' +
  '<meta name="viewport" content="width=device-width, initial-scale=1" />' +
  "<title>Fig serialized components</title>" +
  '<link rel="stylesheet" href="/style.css" />' +
  "</head><body>" +
  `<div id="${resourceRootId}"></div>` +
  devReloadScript() +
  '<script src="/client.js" type="module"></script>' +
  "</body></html>";

function requestUrl(request: IncomingMessage): URL {
  const host = Array.isArray(request.headers.host)
    ? request.headers.host[0]
    : (request.headers.host ?? `127.0.0.1:${port}`);

  return new URL(request.url ?? "/", `http://${host}`);
}

function publicUrl(): string {
  return process.env.PORTLESS_URL ?? `http://127.0.0.1:${port}/`;
}

function seedFor(url: URL): number {
  const explicit = Number(url.searchParams.get("seed"));
  if (Number.isInteger(explicit)) return explicit;
  return 1;
}

async function pipeStream(
  stream: ReadableStream<Uint8Array>,
  response: ServerResponse,
): Promise<void> {
  const reader = stream.getReader();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return;
      await writeResponse(response, value);
    }
  } finally {
    response.end();
  }
}

async function sendFile(
  response: ServerResponse,
  url: URL,
  headers: Record<string, string>,
): Promise<void> {
  send(response, 200, await readFile(url), headers);
}

function send(
  response: ServerResponse,
  status: number,
  body: string | Uint8Array,
  headers: Record<string, string>,
): void {
  response.writeHead(status, headers);
  response.end(body);
}

function writeResponse(
  response: ServerResponse,
  chunk: Uint8Array,
): Promise<void> {
  if (response.destroyed || response.writableEnded) return Promise.resolve();
  if (response.write(chunk)) return Promise.resolve();

  return new Promise((resolve) => {
    const finish = () => {
      response.off("close", finish);
      response.off("drain", finish);
      resolve();
    };

    response.on("close", finish);
    response.on("drain", finish);
  });
}
