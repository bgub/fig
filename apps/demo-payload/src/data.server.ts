import { serverDataResource } from "@bgub/fig-data/server";

export interface PayloadAudit {
  requestId: string;
  seed: number;
  source: "server-only";
}

export interface PayloadDataContext {
  requestId?: string;
}

export const payloadAuditResource = serverDataResource<
  [number],
  PayloadAudit,
  PayloadDataContext
>({
  name: "PayloadAudit",
  key: (seed: number) => ["payload-audit", seed],
  load: (seed: number, { context }) => ({
    requestId: context.requestId ?? "unknown",
    seed,
    source: "server-only",
  }),
});
