import { serverDataResource } from "@bgub/fig-data/server";

export interface PayloadAudit {
  requestId: string;
  seed: number;
  source: "server-only";
}

export const payloadAuditResource = serverDataResource<[number], PayloadAudit>({
  key: (seed: number) => ["payload-audit", seed],
  load: (seed: number) => ({
    requestId: `seed-${seed}`,
    seed,
    source: "server-only",
  }),
});
