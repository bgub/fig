import { type FigAssetResourceList, stylesheet } from "@bgub/fig";

export const payloadStylesheetsSymbolKey =
  "fig.tanstack-start.payload-stylesheets";

const payloadStylesheetsSymbol = Symbol.for(payloadStylesheetsSymbolKey);

export function compiledPayloadAssets(
  type: unknown,
): FigAssetResourceList | undefined {
  if (typeof type !== "function") return undefined;
  const hrefs = Reflect.get(type, payloadStylesheetsSymbol);
  if (
    !Array.isArray(hrefs) ||
    !hrefs.every((href): href is string => typeof href === "string")
  ) {
    return undefined;
  }
  return hrefs.map((href) => stylesheet(href, { precedence: "payload" }));
}
