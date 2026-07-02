import type { FigAssetResource, FigAssetResourceList } from "@bgub/fig";
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

function clientReferenceAssets(metadata: { id: string }): FigAssetResourceList {
  return mergeAssetResources(
    resolveClientReferenceAssets(metadata),
    appClientReferenceAssets?.(metadata),
  );
}

function serverRouteAssets(metadata: { id: string }): FigAssetResourceList {
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
  generated: FigAssetResourceList,
  app: FigAssetResourceList | undefined,
): FigAssetResourceList {
  if (app === undefined) return generated;
  return [...toAssetResourceArray(generated), ...toAssetResourceArray(app)];
}

function toAssetResourceArray(
  resources: FigAssetResourceList,
): readonly FigAssetResource[] {
  return isAssetResourceArray(resources) ? resources : [resources];
}

function isAssetResourceArray(
  resources: FigAssetResourceList,
): resources is readonly FigAssetResource[] {
  return Array.isArray(resources);
}
