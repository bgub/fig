import { serverDataResource } from "@bgub/fig/server";
import {
  serverInfoKey,
  serverOnlyInfoKey,
  type ServerInfo,
  type ServerOnlyInfo,
} from "./app.tsx";

export function createServerInfo(): ServerInfo {
  return {
    region: "us-west (origin)",
    renderedAt: new Date().toLocaleTimeString(),
    runtime: `Node ${process.version}`,
  };
}

export function createServerInfoResource(info = createServerInfo()) {
  return serverDataResource<[], ServerInfo>({
    key: serverInfoKey,
    load: () => info,
  });
}

export function createServerOnlyInfoResource(
  requestId: string,
  info = createServerInfo(),
) {
  return serverDataResource<[], ServerOnlyInfo>({
    key: serverOnlyInfoKey,
    load: () => ({
      region: info.region,
      requestId,
      runtime: `Node ${process.version}`,
    }),
  });
}

export const serverInfoResource = serverDataResource<[], ServerInfo>({
  key: serverInfoKey,
  load: () => createServerInfo(),
});

export const serverOnlyInfoResource = serverDataResource<[], ServerOnlyInfo>({
  key: serverOnlyInfoKey,
  load: () => ({
    region: "unknown",
    requestId: "unknown",
    runtime: `Node ${process.version}`,
  }),
});
