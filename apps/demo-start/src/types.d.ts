import type { FigNode } from "@bgub/fig";
import "@bgub/fig-start";

declare global {
  namespace JSX {
    type Element = FigNode;

    interface IntrinsicElements {
      [name: string]: Record<string, unknown>;
    }
  }
}

// Register the app's router context type once, app-wide. Route beforeLoad/loader
// args then see this typed context with no codegen.
declare module "@bgub/fig-start" {
  interface Register {
    context: { appName: string };
  }
}
