export const MANIFEST_ID = "virtual:fig-start/client-manifest";
export const SERVER_MANIFEST_ID = "virtual:fig-start/server-manifest";
export const CLIENT_ENTRY_ID = "virtual:fig-start/client-entry";
export const SERVER_ENTRY_ID = "virtual:fig-start/server-entry";
export const DEV_ENV_ID = "virtual:fig-start/dev-env";
export const SERVER_ROUTE_ASSETS_ID = "virtual:fig-start/server-route-assets";
export const SERVER_ROUTE_ASSET_MODULE_PREFIX =
  "virtual:fig-start/server-route-asset-module:";
export const CSS_MODULE_PREFIX = "virtual:fig-start/css-module:";
export const CLIENT_ASSET_MANIFEST_FILE = "fig-start-client-assets.json";

export const ROOT_RELATIVE_VIRTUAL_IDS = [
  MANIFEST_ID,
  CLIENT_ENTRY_ID,
  SERVER_ENTRY_ID,
  SERVER_MANIFEST_ID,
  SERVER_ROUTE_ASSETS_ID,
] as const;

export function resolvedVirtualId(id: string): string {
  return `\0${id}`;
}
