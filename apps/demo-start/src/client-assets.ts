import {
  preload,
  type FigResourceList,
} from "@bgub/fig";
import type { StartStaticAssetInput } from "@bgub/fig-start/server";
import { islandMarkHref } from "./routes/Island.assets.ts";

const islandReferenceId = "/src/routes/Island.tsx#Island";

const islandMarkSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" role="img" aria-label="Fig island">
  <rect width="48" height="48" rx="10" fill="#ecfdf5"/>
  <path d="M13 31c5-8 14-12 25-11-7 2-12 6-15 12" fill="none" stroke="#0f766e" stroke-width="4" stroke-linecap="round"/>
  <circle cx="18" cy="17" r="4" fill="#f59e0b"/>
  <path d="M10 35h28" stroke="#173f37" stroke-width="3" stroke-linecap="round"/>
</svg>`;

export const demoAssets: Record<string, StartStaticAssetInput> = {
  [islandMarkHref]: {
    content: islandMarkSvg,
    contentType: "image/svg+xml",
  },
};

export function clientReferenceAssets(metadata: { id: string }): FigResourceList {
  if (metadata.id !== islandReferenceId) return [];

  return preload(islandMarkHref, "image", { type: "image/svg+xml" });
}
