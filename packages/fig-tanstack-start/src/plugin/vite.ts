import {
  START_ENVIRONMENT_NAMES,
  tanStackStartVite,
  type TanStackStartViteInputConfig,
} from "@tanstack/start-plugin-core/vite";
import { figRefresh } from "@bgub/fig-vite";
import type { PluginOption } from "vite";
import {
  defaultEntryPaths,
  startCompatibilityPlugin,
} from "./compatibility-vite.ts";
import { payloadPlugin, serverPayloadPlugin } from "./payload-vite.ts";
import { tanStackCompatibilityProfile } from "./compatibility-profile.ts";

export function tanstackStart(
  options?: TanStackStartViteInputConfig,
): PluginOption[] {
  return [
    startCompatibilityPlugin(),
    serverPayloadPlugin(),
    payloadPlugin(),
    tanStackStartVite(
      {
        defaultEntryPaths,
        framework: tanStackCompatibilityProfile.framework,
        providerEnvironmentName: START_ENVIRONMENT_NAMES.server,
        ssrIsProvider: true,
        ssrResolverStrategy: { type: "default" },
      },
      options,
    ),
    // Route splitting must run first: it moves component declarations into
    // virtual modules. Refresh then registers the declarations where they
    // actually remain instead of leaving references in the route shell.
    figRefresh(),
  ];
}
