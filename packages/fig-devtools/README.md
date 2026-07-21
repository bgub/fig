# @bgub/fig-devtools

In-page DevTools for Fig.

```ts
import { FigDevtools } from "@bgub/fig-devtools";

export function App() {
  return (
    <>
      <MainApp />
      <FigDevtools placement="sidebar" />
    </>
  );
}
```

The component subscribes to the Fig DevTools global hook and renders committed
fiber snapshots, commit history, props, hooks, context reads, data-resource
entries, and host HTML inspection.

You can also mount it imperatively before the first root render:

```ts
import { installFigDevtools } from "@bgub/fig-devtools";

installFigDevtools();
```

## TanStack Devtools

The `./tanstack` subpath exposes Fig as a custom plugin for TanStack's shared
Devtools shell. Install `@tanstack/devtools`, create the Fig hook before the
application's first render, and pass the plugin to the vanilla core:

```ts
import { ensureFigDevtoolsGlobalHook } from "@bgub/fig-devtools";
import { createFigDevtoolsPlugin } from "@bgub/fig-devtools/tanstack";
import { TanStackDevtoolsCore } from "@tanstack/devtools";

ensureFigDevtoolsGlobalHook();

const figPlugin = createFigDevtoolsPlugin();
const devtools = new TanStackDevtoolsCore({ plugins: [figPlugin] });
const host = document.createElement("div");
document.body.appendChild(host);
devtools.mount(host);

function disposeDevtools() {
  figPlugin.dispose();
  devtools.unmount();
  host.remove();
}
```

The plugin mounts an isolated Fig root with DevTools publishing disabled, fills
the TanStack panel, follows its light/dark theme, and portals inspection
highlights outside the shell's transformed and clipped panel while keeping them
beneath its stacking context. It also cleans up detached panel containers used
by host changes such as picture-in-picture. `dispose()` is intentionally
explicit because it must run even when a host removes the shell without calling
the plugin's `destroy` callback.
