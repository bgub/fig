declare namespace JSX {
  type Element = import("@bgub/fig").FigNode;

  interface IntrinsicElements {
    [name: string]: Record<string, unknown>;
  }
}

// Register the app's router context type once, app-wide. Route beforeLoad/loader
// args then see this typed context with no codegen.
declare namespace FigStart {
  interface Register {
    context: { appName: string };
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
  }): import("@bgub/fig").FigResourceList;
  export function resolveServerRouteAssets(metadata: {
    id: string;
  }): import("@bgub/fig").FigResourceList;
}
