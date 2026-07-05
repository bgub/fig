import { dataResource } from "@bgub/fig-data";

export interface PayloadSummary {
  bucket: string;
  reads: number;
  source: "shared";
}

let summaryReads = 0;

export const payloadSummaryResource = dataResource<[number], PayloadSummary>({
  key: (seed: number) => ["payload-summary", seed],
  load: (seed: number) => ({
    bucket: `bucket-${Math.abs(seed) % 4}`,
    reads: ++summaryReads,
    source: "shared",
  }),
});
