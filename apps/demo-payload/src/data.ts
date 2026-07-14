import { dataResource } from "@bgub/fig";

export interface PostMeta {
  likes: number;
  renders: number;
}

const rendersBySeed = new Map<number, number>();

// Isomorphic resource: the server reads it during the payload render, the
// value streams as a `data` row, and the client store hydrates it — no
// second request. The per-post render counter makes refreshes visible.
export const payloadSummaryResource = dataResource<[number], PostMeta>({
  key: (seed: number) => ["payload-summary", seed],
  load: (seed: number) => {
    const renders = (rendersBySeed.get(seed) ?? 0) + 1;
    rendersBySeed.set(seed, renders);
    return { likes: 41 + seed * 3, renders };
  },
});
