import { serverDataResource } from "@bgub/fig-data/server";
import {
  serverInfoKey,
  serverOnlyInfoKey,
  type ServerDataContext,
  type ServerInfo,
  type ServerOnlyInfo,
} from "./app.tsx";

export const serverInfoResource = serverDataResource<
  [],
  ServerInfo,
  ServerDataContext
>({
  remote: true,
  key: serverInfoKey,
  load: ({ context }) =>
    context.info ?? {
      region: "unknown",
      renderedAt: new Date().toLocaleTimeString(),
      runtime: `Node ${process.version}`,
    },
});

export const serverOnlyInfoResource = serverDataResource<
  [],
  ServerOnlyInfo,
  ServerDataContext
>({
  key: serverOnlyInfoKey,
  load: ({ context }) => ({
    region: context.info?.region ?? "unknown",
    requestId: context.requestId ?? "unknown",
    runtime: `Node ${process.version}`,
  }),
});
