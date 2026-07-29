import { fileURLToPath } from "node:url";

const entries = [
  ["@bgub/fig/jsx-runtime", "packages/fig/src/jsx-runtime.ts"],
  ["@bgub/fig/jsx-dev-runtime", "packages/fig/src/jsx-runtime.ts"],
  ["@bgub/fig/internal", "packages/fig/src/internal.ts"],
  ["@bgub/fig/payload", "packages/fig/src/payload.ts"],
  ["@bgub/fig-devtools/server", "packages/fig-devtools/src/server.ts"],
  ["@bgub/fig-devtools/client", "packages/fig-devtools/src/client.ts"],
  ["@bgub/fig-devtools", "packages/fig-devtools/src/index.ts"],
  ["@bgub/fig-dom/test-utils", "packages/fig-dom/src/act.ts"],
  [
    "@bgub/fig-dom/view-transitions",
    "packages/fig-dom/src/view-transitions.ts",
  ],
  ["@bgub/fig-dom/refresh", "packages/fig-dom/src/refresh.ts"],
  ["@bgub/fig-dom/jsx-runtime", "packages/fig-dom/src/jsx-runtime.ts"],
  ["@bgub/fig-dom/jsx-dev-runtime", "packages/fig-dom/src/jsx-runtime.ts"],
  ["@bgub/fig-dom", "packages/fig-dom/src/index.ts"],
  ["@bgub/fig-reconciler/devtools", "packages/fig-reconciler/src/devtools.ts"],
  [
    "@bgub/fig-reconciler/commit-coordinator",
    "packages/fig-reconciler/src/commit-coordinator.ts",
  ],
  [
    "@bgub/fig-reconciler/view-transitions",
    "packages/fig-reconciler/src/view-transitions.ts",
  ],
  ["@bgub/fig-reconciler/refresh", "packages/fig-reconciler/src/refresh.ts"],
  ["@bgub/fig-reconciler/test-utils", "packages/fig-reconciler/src/act.ts"],
  ["@bgub/fig-reconciler", "packages/fig-reconciler/src/index.ts"],
  ["@bgub/fig-refresh", "packages/fig-refresh/src/index.ts"],
  ["@bgub/fig-vite", "packages/fig-vite/src/index.ts"],
  ["@bgub/fig-server/html", "packages/fig-server/src/html-entry.ts"],
  ["@bgub/fig-server/payload", "packages/fig-server/src/payload.ts"],
  ["@bgub/fig-server", "packages/fig-server/src/index.ts"],
  ["@bgub/fig-tanstack-router", "packages/fig-tanstack-router/src/router.tsx"],
  ["@bgub/fig-ui/accordion", "packages/fig-ui/src/accordion/accordion.tsx"],
  ["@bgub/fig-ui/checkbox", "packages/fig-ui/src/checkbox/checkbox.tsx"],
  ["@bgub/fig-ui/combobox", "packages/fig-ui/src/combobox/combobox.tsx"],
  ["@bgub/fig-ui/dialog", "packages/fig-ui/src/dialog/dialog.tsx"],
  ["@bgub/fig-ui/field", "packages/fig-ui/src/field/field.tsx"],
  ["@bgub/fig-ui/listbox", "packages/fig-ui/src/listbox/listbox.tsx"],
  ["@bgub/fig-ui/menu", "packages/fig-ui/src/menu/menu.tsx"],
  ["@bgub/fig-ui/menu/submenu", "packages/fig-ui/src/menu/submenu.ts"],
  ["@bgub/fig-ui/popover", "packages/fig-ui/src/popover/popover.tsx"],
  [
    "@bgub/fig-ui/radio-group",
    "packages/fig-ui/src/radio-group/radio-group.tsx",
  ],
  ["@bgub/fig-ui/select", "packages/fig-ui/src/select/select.tsx"],
  ["@bgub/fig-ui/switch", "packages/fig-ui/src/switch/switch.tsx"],
  ["@bgub/fig-ui/tabs", "packages/fig-ui/src/tabs/tabs.tsx"],
  ["@bgub/fig-ui/tabs/indicator", "packages/fig-ui/src/tabs/indicator.ts"],
  ["@bgub/fig-ui/toast", "packages/fig-ui/src/toast/toast.tsx"],
  ["@bgub/fig-ui/toolbar", "packages/fig-ui/src/toolbar/toolbar.tsx"],
  ["@bgub/fig-ui/tooltip", "packages/fig-ui/src/tooltip/tooltip.tsx"],
  [
    "@bgub/fig-tanstack-start/client",
    "packages/fig-tanstack-start/src/client.tsx",
  ],
  [
    "@bgub/fig-tanstack-start/server",
    "packages/fig-tanstack-start/src/server.tsx",
  ],
  [
    "@bgub/fig-tanstack-start/payload",
    "packages/fig-tanstack-start/src/payload.ts",
  ],
  ["@bgub/fig-tanstack-start", "packages/fig-tanstack-start/src/data.ts"],
  ["@bgub/fig", "packages/fig/src/index.ts"],
] as const;

export function figSourceAliases(): Record<string, string> {
  return Object.fromEntries(
    [...entries]
      .sort(([a], [b]) => b.length - a.length)
      .map(([name, path]) => [name, workspacePath(path)]),
  );
}

export function figSourceResolveAliases(): Array<{
  find: RegExp;
  replacement: string;
}> {
  return entries.map(([name, path]) => ({
    find: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`),
    replacement: workspacePath(path),
  }));
}

export function workspacePath(path: string): string {
  return fileURLToPath(new URL(`../../${path}`, import.meta.url));
}
