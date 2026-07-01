import type { FigResource, FigResourceList } from "@bgub/fig";
import type { StartConfig } from "@bgub/fig-start";
import { startDevServer } from "@bgub/fig-start/dev-server";
import {
  resolveClientReferenceAssets,
  resolveServerRouteAssets,
} from "virtual:fig-start/server-manifest";
import { start } from "./start.tsx";

const startConfig: StartConfig = start;
const {
  appName,
  clientReferenceAssets: appClientReferenceAssets,
  onRecoverableError: _onRecoverableError,
  serverRouteAssets: appServerRouteAssets,
  ...serverOptions
} = startConfig;

function clientReferenceAssets(metadata: { id: string }): FigResourceList {
  return mergeAssetResources(
    resolveClientReferenceAssets(metadata),
    appClientReferenceAssets?.(metadata),
  );
}

function serverRouteAssets(metadata: { id: string }): FigResourceList {
  return mergeAssetResources(
    resolveServerRouteAssets(metadata),
    appServerRouteAssets?.(metadata),
  );
}

void startDevServer({
  ...serverOptions,
  appUrl: new URL("./server.js", import.meta.url).href,
  clientReferenceAssets,
  context: () => ({ appName }),
  port: Number(process.env.PORT ?? 3000),
  publicUrl: "https://fig-demo-start.localhost/",
  serverRouteAssets,
});

function mergeAssetResources(
  generated: FigResourceList,
  app: FigResourceList | undefined,
): FigResourceList {
  if (app === undefined) return generated;
  return [...toAssetResourceArray(generated), ...toAssetResourceArray(app)];
}

function toAssetResourceArray(
  resources: FigResourceList,
): readonly FigResource[] {
  return isAssetResourceArray(resources) ? resources : [resources];
}

function isAssetResourceArray(
  resources: FigResourceList,
): resources is readonly FigResource[] {
  return Array.isArray(resources);
}
