import type { AnyRouteMatch, AnyRouter, Manifest } from "@tanstack/router-core";
import { describe, expect, it } from "vitest";
import { collectRouteAssets } from "./route-assets.ts";

describe("TanStack route asset translation", () => {
  it("collects blocking styles before generated module preloads", () => {
    const router = { options: {} } as unknown as AnyRouter;
    const match = {
      links: [{ href: "/route.css", rel: "stylesheet" }],
      routeId: "/route",
    } as unknown as AnyRouteMatch;
    const manifest: Manifest = {
      routes: {
        "/route": {
          css: ["/manifest.css"],
          preloads: ["/manifest.js"],
        },
      },
    };

    const result = collectRouteAssets(router, match, manifest);

    expect(result.resources).toMatchObject([
      { href: "/route.css", kind: "stylesheet" },
      { href: "/manifest.css", kind: "stylesheet" },
      { href: "/manifest.js", kind: "modulepreload" },
    ]);
  });

  it("separates Fig assets from explicitly positioned tags", () => {
    const router = {
      options: {
        assetCrossOrigin: {
          script: "anonymous",
          stylesheet: "use-credentials",
        },
        ssr: { nonce: "route-nonce" },
      },
    } as unknown as AnyRouter;
    const match = {
      headScripts: [
        { async: true, src: "/head-async.js" },
        { id: "head-ordered", src: "/head-ordered.js" },
      ],
      links: [
        { href: "/route.css", precedence: "route", rel: "stylesheet" },
        { href: "https://assets.example", rel: "preconnect" },
        {
          as: "font",
          crossOrigin: "anonymous",
          href: "/font.woff2",
          rel: "preload",
          type: "font/woff2",
        },
        { href: "/route.js", rel: "modulepreload" },
        { href: "/favicon.ico", rel: "icon" },
      ],
      routeId: "/route",
      scripts: [
        { async: true, src: "/body-async.js" },
        { id: "body-ordered", src: "/body-ordered.js" },
      ],
    } as unknown as AnyRouteMatch;
    const manifest: Manifest = {
      routes: {
        "/route": {
          css: ["/manifest.css"],
          preloads: ["/manifest.js"],
          scripts: [
            { attrs: { async: true, src: "/manifest-async.js" } },
            { attrs: { src: "/manifest-ordered.js" } },
          ],
        },
      },
    };

    const result = collectRouteAssets(router, match, manifest);

    expect(result.resources).toMatchObject([
      { href: "/route.css", kind: "stylesheet", precedence: "route" },
      { href: "https://assets.example", kind: "preconnect" },
      {
        as: "font",
        crossorigin: "anonymous",
        href: "/font.woff2",
        kind: "preload",
        type: "font/woff2",
      },
      { href: "/route.js", kind: "modulepreload" },
      {
        crossorigin: "use-credentials",
        href: "/manifest.css",
        kind: "stylesheet",
      },
      {
        crossorigin: "anonymous",
        href: "/manifest.js",
        kind: "modulepreload",
      },
      { async: true, kind: "script", src: "/head-async.js" },
      { async: true, kind: "script", src: "/body-async.js" },
      { async: true, kind: "script", src: "/manifest-async.js" },
    ]);
    expect(result.links).toEqual([
      {
        attrs: {
          href: "/favicon.ico",
          nonce: "route-nonce",
          rel: "icon",
        },
        tag: "link",
      },
    ]);
    expect(result.headScripts).toEqual([
      {
        attrs: {
          id: "head-ordered",
          nonce: "route-nonce",
          src: "/head-ordered.js",
          suppressHydrationWarning: true,
        },
        children: undefined,
        tag: "script",
      },
    ]);
    expect(result.scripts.map((tag) => tag.attrs?.src)).toEqual([
      "/body-ordered.js",
      "/manifest-ordered.js",
    ]);
  });
});
