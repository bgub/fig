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
fiber snapshots, commit history, props, hooks, context reads, and host HTML
inspection.

You can also mount it imperatively before the first root render:

```ts
import { installFigDevtools } from "@bgub/fig-devtools";

installFigDevtools();
```
