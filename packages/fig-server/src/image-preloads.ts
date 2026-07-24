import type { PreloadResource, Props } from "@bgub/fig";

export function imagePreloadFromHostProps(
  type: string,
  props: Props,
  suppressed: boolean,
): PreloadResource | null {
  if (suppressed || type.toLowerCase() !== "img") return null;
  if (props.loading === "lazy" || props.fetchpriority === "low") return null;

  const src = stringProp(props.src);
  const srcset = stringProp(props.srcset);
  if (
    (props.src != null && typeof props.src !== "string") ||
    (props.srcset != null && typeof props.srcset !== "string") ||
    (!src && !srcset) ||
    isDataUrl(src) ||
    isDataUrl(srcset)
  ) {
    return null;
  }

  return {
    as: "image",
    crossorigin: imageCrossorigin(props.crossorigin),
    fetchpriority: imageFetchpriority(props.fetchpriority),
    href: src || undefined,
    imagesizes: srcset ? stringProp(props.sizes) : undefined,
    imagesrcset: srcset || undefined,
    kind: "preload",
    referrerpolicy: stringProp(props.referrerpolicy),
    type: stringProp(props.type),
  };
}

export function suppressesImagePreloads(type: string): boolean {
  const normalizedType = type.toLowerCase();
  return normalizedType === "picture" || normalizedType === "noscript";
}

function stringProp(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function isDataUrl(value: string | undefined): boolean {
  return value?.slice(0, 5).toLowerCase() === "data:";
}

function imageCrossorigin(value: unknown): PreloadResource["crossorigin"] {
  if (typeof value !== "string") return undefined;
  if (value === "anonymous" || value === "use-credentials" || value === "") {
    return value;
  }
  return "";
}

function imageFetchpriority(value: unknown): PreloadResource["fetchpriority"] {
  return value === "high" || value === "auto" ? value : undefined;
}
