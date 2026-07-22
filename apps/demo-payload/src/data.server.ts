import { dataResource } from "@bgub/fig";

export interface PostStats {
  source: "server-only";
  views: number;
}

// Server-only data: the loader lives in a .server.ts module, runs during the
// payload render, and never ships to the client bundle.
export const payloadAuditResource = dataResource<[number], PostStats>({
  key: (seed: number) => ["payload-audit", seed],
  load: (seed: number) => ({
    source: "server-only",
    views: 1204 + seed * 37,
  }),
});
