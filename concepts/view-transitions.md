# View Transitions

Status: exploring

`ViewTransition` marks DOM surfaces that may participate in native browser
view transitions. It is declarative: it renders no wrapper, and it only does
work when a transition/deferred client commit or a streamed server reveal
mutates an annotated surface.

## Public Surface

`ViewTransition` exports from `@bgub/fig` as a branded callable special
element. Props:

- `name?: string` — explicit `view-transition-name`; absent/`"auto"` uses a
  generated internal name.
- `default?: "auto" | "none" | string`
- `enter?: "auto" | "none" | string`
- `exit?: "auto" | "none" | string`
- `share?: "auto" | "none" | string`
- `update?: "auto" | "none" | string`
- `children?: FigNode`

`"auto"` means browser/default styling; `"none"` disables that phase. String
values become `view-transition-class`.

## Client Commit Model

The reconciler treats `ViewTransition` as a structural fiber. Complete-time
sets a static flag so normal commits can skip subtrees without transition
boundaries. During transition/deferred commits, commit builds a surface plan
from the existing mutation/deletion flags:

1. collect old surfaces from affected current/deleted boundaries;
2. collect new surfaces from affected finished/entering boundaries;
3. ask the host to run one view-transition transaction around the existing
   deletion/mutation/visibility work.

The DOM host applies temporary `viewTransitionName` and
`viewTransitionClass` inline styles before the old/new snapshots, then restores
the author-provided style values after the browser has captured the new state.
The initial implementation deliberately avoids layout measurement and
visibility probing; work is proportional to affected annotated surfaces.

## Server Streaming

Server rendering annotates the nearest host surfaces under a `ViewTransition`
with `data-fig-vt-name` and, when present, `data-fig-vt-class`. The inline
Suspense runtime consumes those annotations for `s`, `c`, and `ac` reveal
operations: it collects old fallback surfaces and staged new surfaces, performs
the existing DOM move inside `document.startViewTransition`, applies names to
the moved nodes before the new snapshot, and restores inline styles after the
snapshot is ready. If the browser API is absent, reveals use the existing
non-animated path.
