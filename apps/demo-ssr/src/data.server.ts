import { dataResource } from "@bgub/fig";
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
  return dataResource<[], ServerInfo>({
    key: serverInfoKey,
    load: () => info,
  });
}

export function createServerOnlyInfoResource(
  requestId: string,
  info = createServerInfo(),
) {
  return dataResource<[], ServerOnlyInfo>({
    key: serverOnlyInfoKey,
    load: () => ({
      region: info.region,
      requestId,
      runtime: `Node ${process.version}`,
    }),
  });
}

export const serverInfoResource = dataResource<[], ServerInfo>({
  key: serverInfoKey,
  load: () => createServerInfo(),
});

export const serverOnlyInfoResource = dataResource<[], ServerOnlyInfo>({
  key: serverOnlyInfoKey,
  load: () => ({
    region: "unknown",
    requestId: "unknown",
    runtime: `Node ${process.version}`,
  }),
});
