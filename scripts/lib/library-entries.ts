/** Public subpaths and source files shared by builds and source-linked tooling.
 * Package exports remain the consumer contract; release tests verify agreement.
 */
interface LibraryDefinition {
  name: string;
  development: boolean;
  browser: boolean;
  entries: Record<string, { source: string; output: string }>;
  /** Built files addressed by the adapter itself, without public subpaths. */
  internalEntries?: Record<string, string>;
}

export const libraries: Record<string, LibraryDefinition> = {
  "packages/fig": {
    name: "@bgub/fig",
    development: true,
    browser: false,
    entries: {
      ".": { source: "./src/index.ts", output: "index" },
      "./internal": { source: "./src/internal.ts", output: "internal" },
      "./payload": { source: "./src/payload.ts", output: "payload" },
      "./jsx-runtime": {
        source: "./src/jsx-runtime.ts",
        output: "jsx-runtime",
      },
      "./jsx-dev-runtime": {
        source: "./src/jsx-runtime.ts",
        output: "jsx-runtime",
      },
    },
  },
  "packages/fig-devtools": {
    name: "@bgub/fig-devtools",
    development: false,
    browser: true,
    entries: {
      ".": { source: "./src/index.ts", output: "index" },
      "./server": { source: "./src/server.ts", output: "server" },
      "./client": { source: "./src/client.ts", output: "client" },
      "./tanstack": { source: "./src/tanstack.ts", output: "tanstack" },
    },
  },
  "packages/fig-dom": {
    name: "@bgub/fig-dom",
    development: true,
    browser: true,
    entries: {
      ".": { source: "./src/index.ts", output: "index" },
      "./view-transitions": {
        source: "./src/view-transitions.ts",
        output: "view-transitions",
      },
      "./refresh": { source: "./src/refresh.ts", output: "refresh" },
      "./test-utils": { source: "./src/act.ts", output: "act" },
      "./jsx-runtime": {
        source: "./src/jsx-runtime.ts",
        output: "jsx-runtime",
      },
      "./jsx-dev-runtime": {
        source: "./src/jsx-runtime.ts",
        output: "jsx-runtime",
      },
    },
  },
  "packages/fig-reconciler": {
    name: "@bgub/fig-reconciler",
    development: true,
    browser: false,
    entries: {
      ".": { source: "./src/index.ts", output: "index" },
      "./commit-coordinator": {
        source: "./src/commit-coordinator.ts",
        output: "commit-coordinator",
      },
      "./view-transitions": {
        source: "./src/view-transitions.ts",
        output: "view-transitions",
      },
      "./devtools": { source: "./src/devtools.ts", output: "devtools" },
      "./refresh": { source: "./src/refresh.ts", output: "refresh" },
      "./test-utils": { source: "./src/act.ts", output: "act" },
    },
  },
  "packages/fig-refresh": {
    name: "@bgub/fig-refresh",
    development: false,
    browser: false,
    entries: {
      ".": { source: "./src/index.ts", output: "index" },
    },
  },
  "packages/fig-vite": {
    name: "@bgub/fig-vite",
    development: false,
    browser: false,
    entries: {
      ".": { source: "./src/index.ts", output: "index" },
    },
  },
  "packages/fig-server": {
    name: "@bgub/fig-server",
    development: true,
    browser: false,
    entries: {
      ".": { source: "./src/index.ts", output: "index" },
      "./payload": { source: "./src/payload.ts", output: "payload" },
      "./html": { source: "./src/html-entry.ts", output: "html-entry" },
    },
  },
  "packages/fig-tanstack-router": {
    name: "@bgub/fig-tanstack-router",
    development: true,
    browser: false,
    entries: {
      ".": { source: "./src/router.tsx", output: "router" },
    },
  },
  "packages/fig-headless": {
    name: "@bgub/fig-headless",
    development: true,
    browser: true,
    entries: {
      "./accordion": {
        source: "./src/accordion/accordion.tsx",
        output: "accordion",
      },
      "./checkbox": {
        source: "./src/checkbox/checkbox.tsx",
        output: "checkbox",
      },
      "./combobox": {
        source: "./src/combobox/combobox.tsx",
        output: "combobox",
      },
      "./command": { source: "./src/command/command.tsx", output: "command" },
      "./dialog": { source: "./src/dialog/dialog.tsx", output: "dialog" },
      "./field": { source: "./src/field/field.tsx", output: "field" },
      "./listbox": { source: "./src/listbox/listbox.tsx", output: "listbox" },
      "./menu": { source: "./src/menu/menu.tsx", output: "menu" },
      "./menu/context-menu": {
        source: "./src/menu/context-menu.tsx",
        output: "menu/context-menu",
      },
      "./menu/submenu": {
        source: "./src/menu/submenu.ts",
        output: "menu/submenu",
      },
      "./popover": { source: "./src/popover/popover.tsx", output: "popover" },
      "./radio-group": {
        source: "./src/radio-group/radio-group.tsx",
        output: "radio-group",
      },
      "./select": { source: "./src/select/select.tsx", output: "select" },
      "./slider": { source: "./src/slider/slider.tsx", output: "slider" },
      "./switch": { source: "./src/switch/switch.tsx", output: "switch" },
      "./tabs": { source: "./src/tabs/tabs.tsx", output: "tabs" },
      "./tabs/indicator": {
        source: "./src/tabs/indicator.ts",
        output: "tabs/indicator",
      },
      "./toast": { source: "./src/toast/toast.tsx", output: "toast" },
      "./toolbar": { source: "./src/toolbar/toolbar.tsx", output: "toolbar" },
      "./tooltip": { source: "./src/tooltip/tooltip.tsx", output: "tooltip" },
    },
  },
  "packages/fig-tanstack-start": {
    name: "@bgub/fig-tanstack-start",
    development: false,
    browser: false,
    internalEntries: {
      "default-entry/client": "./src/default-entry/client.ts",
      "default-entry/server": "./src/default-entry/server.ts",
      "default-entry/start": "./src/default-entry/start.ts",
      "storage-context": "./src/storage-context.ts",
    },
    entries: {
      ".": { source: "./src/data.ts", output: "data" },
      "./client": { source: "./src/client.tsx", output: "client" },
      "./payload": { source: "./src/payload.ts", output: "payload" },
      "./server": { source: "./src/server.tsx", output: "server" },
      "./plugin/vite": {
        source: "./src/plugin/vite.ts",
        output: "plugin/vite",
      },
    },
  },
};

export const libraryEntries: Record<
  string,
  Record<string, string>
> = Object.fromEntries(
  Object.entries(libraries).map(([path, library]) => [
    path,
    {
      ...library.internalEntries,
      ...Object.fromEntries(
        Object.values(library.entries).map(({ source, output }) => [
          output,
          source,
        ]),
      ),
    },
  ]),
);

export const developmentLibraryPaths = Object.keys(libraries).filter(
  (path) => libraries[path]!.development,
);
