import type { RouterLocation } from "./types.ts";

// Build an href from a path plus optional search/hash, tolerating values with or
// without their leading "?"/"#". Shared by the router and <Link>.
export function hrefFrom(to: string, search?: string, hash?: string): string {
  let href = to;
  if (search !== undefined && search !== "") {
    href += search.startsWith("?") ? search : `?${search}`;
  }
  if (hash !== undefined && hash !== "") {
    href += hash.startsWith("#") ? hash : `#${hash}`;
  }
  return href;
}

export function parseLocation(href: string): RouterLocation {
  const url = new URL(href, "http://fig.local");
  return {
    hash: url.hash,
    href: url.pathname + url.search + url.hash,
    pathname: url.pathname,
    search: url.search,
  };
}
