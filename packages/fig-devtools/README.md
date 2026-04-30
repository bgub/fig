# @bgub/fig-devtools

In-page DevTools for Fig.

```ts
import { installFigDevtools } from "@bgub/fig-devtools";

installFigDevtools();
```

Install the panel before the first root render so the reconciler can publish
committed fiber snapshots.
