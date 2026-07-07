import { readFile } from "node:fs/promises";
import { isServableAssetPath, requestPathname } from "../server-assets.ts";
import { contentTypeFor } from "./content-type.ts";

export function isClientAssetRequest(
  method: string,
  pathname: string,
): boolean {
  if (method !== "GET" && method !== "HEAD") return false;
  const path = requestPathname(pathname);
  const name = path.slice(path.lastIndexOf("/") + 1);
  return isServableAssetPath(name);
}

export async function serveClientAsset(input: {
  cache: boolean;
  headOnly: boolean;
  url: URL;
}): Promise<Response> {
  let code: Uint8Array<ArrayBuffer>;
  try {
    // Copy out of Node's shared Buffer pool so the body is a plain
    // ArrayBuffer-backed Uint8Array, as BodyInit requires.
    code = new Uint8Array(await readFile(input.url));
  } catch {
    return new Response(input.headOnly ? null : "client bundle not built", {
      status: 404,
    });
  }

  return new Response(input.headOnly ? null : code, {
    headers: {
      "cache-control": input.cache
        ? "public, max-age=31536000, immutable"
        : "no-store",
      "content-type": contentTypeFor(input.url.pathname),
    },
    status: 200,
  });
}
