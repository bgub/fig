// Register the app's router context type once, app-wide. Route beforeLoad/loader
// args then see this typed context with no codegen.
declare namespace FigStart {
  interface Register {
    context: { appName: string };
  }
}

// Register the app's data-resource context type once too. This is separate
// from the router context at runtime.
declare namespace FigData {
  interface Register {
    context: { posts: import("./data.ts").PostService };
  }
}

declare module "*.module.css" {
  const classes: Record<string, string>;
  export default classes;
}

declare module "*.css";

declare module "*.svg" {
  const href: string;
  export default href;
}

declare module "virtual:fig-start/client-manifest" {
  export function loadClientReference(metadata: {
    id: string;
  }): Promise<unknown>;
}

declare module "virtual:fig-start/server-manifest" {
  export function resolveClientReferenceAssets(metadata: {
    id: string;
  }): import("@bgub/fig").FigAssetResourceList;
  export function resolveServerRouteAssets(metadata: {
    id: string;
  }): import("@bgub/fig").FigAssetResourceList;
}

declare module "virtual:fig-start/server-data-resources" {
  export const serverDataResources: Record<string, unknown>;
}
